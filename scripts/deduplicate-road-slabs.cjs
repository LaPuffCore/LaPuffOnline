/**
 * deduplicate-road-slabs.cjs
 *
 * Reads the existing roads_buffered.fgb and removes lower-tier road polygons
 * whose centroids fall inside higher-tier polygons. This eliminates the hundreds
 * of stacked overlapping polygons (motorway slab under primary under tertiary)
 * that waste GPU resources while contributing nothing visually.
 *
 * Hierarchy (higher tier occludes lower):
 *   Tier 0: motorway + trunk
 *   Tier 1: primary + secondary
 *   Tier 2: tertiary + residential + etc.
 *
 * A tier-1 polygon whose centroid is inside a tier-0 polygon is discarded.
 * A tier-2 polygon whose centroid is inside a tier-0 or tier-1 polygon is discarded.
 * Far (_z='f') and near (_z='n') are processed independently — a far slab
 * only occludes another far slab, and near only occludes near.
 *
 * Usage:  node scripts/deduplicate-road-slabs.cjs
 * Output: public/data/roads_buffered.fgb  (replaces existing file)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { geojson: { serialize, deserialize } } = require('flatgeobuf');

const INPUT  = path.resolve(__dirname, '../public/data/roads_buffered.fgb');
const OUTPUT = path.resolve(__dirname, '../public/data/roads_buffered.fgb');

// ── Geometry helpers ──────────────────────────────────────────────────────────

function ringCentroid(ring) {
  // Simple average of vertices (fast, sufficient for convex road ribbons)
  let sx = 0, sy = 0;
  const n = ring.length - 1; // skip closing duplicate
  for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
  return [sx / n, sy / n];
}

function pointInRing(px, py, ring) {
  // Ray-casting algorithm
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Spatial grid index ────────────────────────────────────────────────────────

const CELL_SIZE = 0.003; // ~330m per cell — coarse enough for fast grouping

function gridKey(x, y) {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`;
}

function buildGrid(features) {
  const grid = new Map();
  for (let fi = 0; fi < features.length; fi++) {
    const f = features[fi];
    const ring = f.geometry.coordinates[0];
    // Compute bbox of this polygon
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    // Insert into all grid cells the bbox overlaps
    const x0 = Math.floor(minX / CELL_SIZE), x1 = Math.floor(maxX / CELL_SIZE);
    const y0 = Math.floor(minY / CELL_SIZE), y1 = Math.floor(maxY / CELL_SIZE);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = `${cx},${cy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(fi);
      }
    }
  }
  return grid;
}

function isCentroidInAny(cx, cy, candidates, features) {
  const seen = new Set();
  for (const fi of candidates) {
    if (seen.has(fi)) continue;
    seen.add(fi);
    const ring = features[fi].geometry.coordinates[0];
    if (pointInRing(cx, cy, ring)) return true;
  }
  return false;
}

function getCandidates(cx, cy, grid) {
  const k = gridKey(cx, cy);
  return grid.get(k) || [];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Reading', INPUT);
  const buf = fs.readFileSync(INPUT);
  console.log(`  Input size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // Deserialize all features
  const allFeatures = [];
  for await (const f of deserialize(buf)) {
    if (f?.geometry?.coordinates?.length) allFeatures.push(f);
  }
  console.log(`  Total features: ${allFeatures.length}`);

  // Split by _z variant AND tier
  // We process far and near separately so a far slab only suppresses another far slab.
  const groups = { f: { 0: [], 1: [], 2: [] }, n: { 0: [], 1: [], 2: [] } };
  for (const f of allFeatures) {
    const z    = f.properties._z    ?? 'f';
    const tier = f.properties._tier ?? 0;
    if (groups[z] && groups[z][tier]) groups[z][tier].push(f);
    else allFeatures; // unknown tier/z — kept implicitly
  }

  const kept = [];
  let dropped = 0;

  for (const zKey of ['f', 'n']) {
    const tier0 = groups[zKey][0];
    const tier1 = groups[zKey][1];
    const tier2 = groups[zKey][2];

    console.log(`\n_z='${zKey}': tier0=${tier0.length}, tier1=${tier1.length}, tier2=${tier2.length}`);

    // Tier 0 — always kept
    kept.push(...tier0);

    // Tier 1 — discard if centroid inside any tier-0 polygon
    const grid0 = buildGrid(tier0);
    let kept1 = 0, drop1 = 0;
    for (const f of tier1) {
      const ring = f.geometry.coordinates[0];
      const [cx, cy] = ringCentroid(ring);
      const candidates = getCandidates(cx, cy, grid0);
      if (candidates.length && isCentroidInAny(cx, cy, candidates, tier0)) {
        drop1++;
      } else {
        kept.push(f);
        kept1++;
      }
    }
    console.log(`  Tier 1: kept ${kept1}, dropped ${drop1} (${((drop1 / tier1.length) * 100).toFixed(0)}%)`);
    dropped += drop1;

    // Tier 2 — discard if centroid inside any tier-0 OR surviving tier-1 polygon
    // Build combined grid for tier0 + surviving tier1
    const survivingTier1 = tier1.filter((f, i) => {
      const ring = f.geometry.coordinates[0];
      const [cx, cy] = ringCentroid(ring);
      const candidates = getCandidates(cx, cy, grid0);
      return !(candidates.length && isCentroidInAny(cx, cy, candidates, tier0));
    });
    const higherFeatures = [...tier0, ...survivingTier1];
    const gridHigher = buildGrid(higherFeatures);
    let kept2 = 0, drop2 = 0;
    for (const f of tier2) {
      const ring = f.geometry.coordinates[0];
      const [cx, cy] = ringCentroid(ring);
      const candidates = getCandidates(cx, cy, gridHigher);
      if (candidates.length && isCentroidInAny(cx, cy, candidates, higherFeatures)) {
        drop2++;
      } else {
        kept.push(f);
        kept2++;
      }
    }
    console.log(`  Tier 2: kept ${kept2}, dropped ${drop2} (${((drop2 / tier2.length) * 100).toFixed(0)}%)`);
    dropped += drop2;
  }

  // Any features with unknown tier/z — keep them
  for (const f of allFeatures) {
    const z    = f.properties._z;
    const tier = f.properties._tier;
    if (!['f', 'n'].includes(z) || ![0, 1, 2].includes(tier)) kept.push(f);
  }

  console.log(`\nTotal: ${allFeatures.length} → ${kept.length} (dropped ${dropped}, ${((dropped / allFeatures.length) * 100).toFixed(0)}% reduction)`);

  // Serialize to FlatGeobuf with Hilbert R-tree spatial index
  console.log('Serializing…');
  const fc = { type: 'FeatureCollection', features: kept };
  const outPath = OUTPUT + '.tmp';
  const ws = fs.createWriteStream(outPath);
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

  // Atomic replace
  fs.renameSync(outPath, OUTPUT);
  console.log(`\n✓ Written to ${OUTPUT}`);
  console.log(`  File size: ${(bytesWritten / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Features: ${kept.length}`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
