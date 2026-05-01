/**
 * dissolve-road-slabs.cjs
 *
 * Reads roads_buffered.fgb and geometrically Unions (dissolves) overlapping
 * road polygons within each (_tier, _z) group. This eliminates the "wireframe
 * explosion" caused by thousands of overlapping individual buffered segments
 * Z-fighting at intersections.
 *
 * STRATEGY:
 *  1. Read all features.
 *  2. Group by (_tier, _z) — each tier × zoom variant unions independently.
 *  3. To avoid one giant 100K-polygon union call (which would hang Node.js
 *     for 10+ minutes), we sub-bucket each group by a coarse spatial grid
 *     (~0.04° cells ≈ 4km). Union each cell separately, then emit each
 *     dissolved cell as ONE MultiPolygon feature.
 *  4. This keeps the FGB spatial index useful (multiple features → R-tree
 *     range queries still work for mobile viewport fetch).
 *
 * Uses polygon-clipping (Martinez-Rueda) — pure JS, no native deps, handles
 * large inputs reasonably (chunked here to keep each union call < ~5K polys).
 *
 * Usage:  node scripts/dissolve-road-slabs.cjs
 * Output: public/data/roads_buffered.fgb (replaces existing)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { geojson: { serialize, deserialize } } = require('flatgeobuf');
const polygonClipping = require('polygon-clipping');

const INPUT  = path.resolve(__dirname, '../public/data/roads_buffered.fgb');
const OUTPUT = path.resolve(__dirname, '../public/data/roads_buffered.fgb');

// Spatial grid cell size in degrees (~4km at NYC latitude).
// Smaller = more output features but faster union per cell.
// Larger = fewer features but slower union (and risk of hang).
const CELL_SIZE = 0.04;

function ringBbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function bboxCenter(bb) {
  return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
}

function cellKey(x, y) {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`;
}

async function main() {
  console.log('Reading', INPUT);
  const buf = fs.readFileSync(INPUT);
  console.log(`  Input size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const all = [];
  for await (const f of deserialize(buf)) {
    if (f?.geometry?.coordinates?.length) all.push(f);
  }
  console.log(`  Total input features: ${all.length}`);

  // Group by (tier, z) → spatial cell → array of polygon coord arrays
  // Each polygon-clipping input is [[outerRing, hole1, hole2, ...]]
  // For our buffered ribbons there are no holes, so it's just [[ring]]
  /** @type {Map<string, Map<string, Array<number[][][]>>>} */
  const groups = new Map();

  for (const f of all) {
    const tier = f.properties?._tier;
    const z    = f.properties?._z;
    if (tier === undefined || z === undefined) continue;
    const ring = f.geometry.coordinates[0];
    if (!ring || ring.length < 4) continue;

    const bb = ringBbox(ring);
    const [cx, cy] = bboxCenter(bb);
    const ck = cellKey(cx, cy);
    const gk = `${tier}|${z}`;

    if (!groups.has(gk)) groups.set(gk, new Map());
    const cellMap = groups.get(gk);
    if (!cellMap.has(ck)) cellMap.set(ck, []);
    // polygon-clipping wants Polygon as [[outer, ...holes]]
    cellMap.get(ck).push([ring]);
  }

  console.log(`  Groups (tier|z): ${groups.size}`);
  let totalCells = 0;
  for (const [, cellMap] of groups) totalCells += cellMap.size;
  console.log(`  Total spatial cells: ${totalCells}`);

  // Dissolve each cell, emit one MultiPolygon feature per cell.
  const outFeatures = [];
  let processedCells = 0;
  let totalOutPolys = 0;
  const t0 = Date.now();

  for (const [groupKey, cellMap] of groups) {
    const [tierStr, z] = groupKey.split('|');
    const tier = parseInt(tierStr, 10);
    let cellsInGroup = 0;
    let inputPolys = 0;
    let outputPolys = 0;

    for (const [, polys] of cellMap) {
      inputPolys += polys.length;
      let unioned;
      try {
        // polygonClipping.union accepts (...geoms) or arrays
        // For 1 polygon: trivially output it. Skip union to save CPU.
        if (polys.length === 1) {
          unioned = [polys[0]]; // already a Polygon → wrap as MultiPolygon
        } else {
          unioned = polygonClipping.union(...polys);
        }
      } catch (e) {
        console.warn(`  cell union failed (group ${groupKey}, ${polys.length} polys): ${e.message} — emitting individually`);
        // Fall back to emitting input polys individually
        for (const p of polys) {
          outFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: p },
            properties: { _tier: tier, _z: z },
          });
        }
        outputPolys += polys.length;
        processedCells++;
        cellsInGroup++;
        continue;
      }
      // unioned is MultiPolygon coordinates: [polygon, polygon, ...]
      // where each polygon is [[outer, ...holes]]
      outputPolys += unioned.length;
      outFeatures.push({
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: unioned },
        properties: { _tier: tier, _z: z },
      });
      processedCells++;
      cellsInGroup++;

      if (processedCells % 25 === 0) {
        const pct = ((processedCells / totalCells) * 100).toFixed(1);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`  [${pct}%] cells processed: ${processedCells}/${totalCells} (${elapsed}s)\r`);
      }
    }
    totalOutPolys += outputPolys;
    console.log(`  group ${groupKey}: ${cellsInGroup} cells, ${inputPolys} → ${outputPolys} polys`);
  }
  process.stdout.write('\n');

  console.log(`\nUnion complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  Input features: ${all.length}`);
  console.log(`  Output MultiPolygon features: ${outFeatures.length}`);
  console.log(`  Total polygons inside (sum of MultiPolygon members): ${totalOutPolys}`);

  // Serialize
  console.log('Serializing FlatGeobuf with Hilbert R-tree spatial index…');
  const fc = { type: 'FeatureCollection', features: outFeatures };
  const tmpPath = OUTPUT + '.tmp';
  const ws = fs.createWriteStream(tmpPath);
  const BATCH = 65536;
  let batch = [], bytesWritten = 0;
  for await (const byte of serialize(fc, true)) {
    batch.push(byte);
    if (batch.length >= BATCH) {
      ws.write(Buffer.from(batch));
      bytesWritten += batch.length;
      batch = [];
    }
  }
  if (batch.length) { ws.write(Buffer.from(batch)); bytesWritten += batch.length; }
  await new Promise((res, rej) => ws.end(err => err ? rej(err) : res()));
  fs.renameSync(tmpPath, OUTPUT);
  console.log(`\n✓ Written to ${OUTPUT}`);
  console.log(`  File size: ${(bytesWritten / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(err => { console.error('Error:', err.message); console.error(err.stack); process.exit(1); });
