/**
 * generate-road-slabs.cjs
 *
 * Downloads NYC road LineStrings from Overpass API, converts them to thin
 * flat polygon "slabs" (fill-extrusion compatible), writes output as FlatGeobuf.
 *
 * WHY THIS EXISTS:
 * MapLibre renders `line` layers in a separate 2D GPU pass with no depth testing
 * against fill-extrusion (3D) layers. Roads drawn as lines always appear on top of
 * 3D buildings, even when a building should be blocking them from view. Converting
 * roads to flat polygon ribbons (0.5m tall fill-extrusions) puts them into the same
 * 3D depth-test pass as buildings, so buildings correctly hide road geometry behind
 * them when viewed at a pitched angle.
 *
 * Usage:  node scripts/generate-road-slabs.cjs
 * Output: public/data/roads_buffered.fgb
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { geojson: { serialize } } = require('flatgeobuf');

// NYC bounding box
const BBOX = { minLat: 40.47, minLng: -74.27, maxLat: 40.93, maxLng: -73.68 };

// Buffer widths in meters per road class (half-width = distance from centerline to edge)
const BUFFER_METERS = {
  motorway:       42,  // 84m total → z14 = 11.6px (old: 11.7px ✅)
  trunk:          42,
  primary:        26,  // 52m total → z14 = 7.2px  (old: 7.3px ✅)
  secondary:      20,  // 40m total
  tertiary:       16,  // 32m total → z14 = 4.4px  (old: 4.3px ✅)
  residential:    13,  // 26m total
  unclassified:   11,  // 22m total
};

// Road classes to include (skip service/path/cycleway — too many, too narrow to matter)
const ROAD_CLASSES = Object.keys(BUFFER_METERS);

const LAT_M = 111320; // meters per degree latitude (constant)

/**
 * Buffer a LineString into a Polygon ribbon by computing offset vertices.
 * Uses a miter join at interior nodes (no gaps along the road).
 * @param {number[][]} coords - [[lng, lat], ...]
 * @param {number} bufMeters - buffer half-width in meters
 * @returns {number[][][]|null} GeoJSON polygon coordinates ring, or null if too short
 */
function bufferLineString(coords, bufMeters) {
  if (coords.length < 2) return null;

  // Compute degrees per meter at the centroid latitude
  const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const lngM = LAT_M * cosLat; // meters per degree longitude at this latitude

  // Convert to local meter space (cx, cy as origin)
  const cx = coords[0][0];
  const cy = coords[0][1];
  const pts = coords.map(([lng, lat]) => [
    (lng - cx) * lngM,
    (lat - cy) * LAT_M,
  ]);

  const n = pts.length;

  // Compute unit normal (perpendicular, left side) for each segment
  const segNormals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) {
      segNormals.push(i > 0 ? segNormals[i - 1] : [0, 1]);
    } else {
      segNormals.push([-dy / len, dx / len]); // rotate 90° left
    }
  }

  // At each node, compute the miter: average of adjacent segment normals, normalized
  const offsets = [];
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (i === 0) {
      [nx, ny] = segNormals[0];
    } else if (i === n - 1) {
      [nx, ny] = segNormals[n - 2];
    } else {
      nx = segNormals[i - 1][0] + segNormals[i][0];
      ny = segNormals[i - 1][1] + segNormals[i][1];
      const len = Math.sqrt(nx * nx + ny * ny);
      if (len > 0.001) { nx /= len; ny /= len; }
    }
    // Clamp miter to 3× buffer to avoid spikes at sharp turns
    const miterLen = Math.min(3, 1 / Math.max(0.1, nx * segNormals[Math.min(i, n - 2)][0] + ny * segNormals[Math.min(i, n - 2)][1]));
    offsets.push([nx * bufMeters * miterLen, ny * bufMeters * miterLen]);
  }

  // Build polygon: right side forward (+ offset), left side backward (- offset)
  const rightSide = pts.map((p, i) => [p[0] + offsets[i][0], p[1] + offsets[i][1]]);
  const leftSide  = pts.map((p, i) => [p[0] - offsets[i][0], p[1] - offsets[i][1]]).reverse();

  // Convert back to lng/lat
  const ring = [...rightSide, ...leftSide].map(([mx, my]) => [
    cx + mx / lngM,
    cy + my / LAT_M,
  ]);
  ring.push(ring[0]); // close the ring

  return [ring];
}

/**
 * Simplify a LineString using Douglas-Peucker (reduces point count before buffering).
 * tolerance in degrees (~0.00003 ≈ 3m — enough to cut points by ~50% on straight roads)
 */
function dpSimplify(pts, tol) {
  if (pts.length <= 2) return pts;
  let maxDist = 0, maxIdx = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    let d;
    if (lenSq === 0) {
      d = Math.hypot(px - x1, py - y1);
    } else {
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
      d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tol) {
    const l = dpSimplify(pts.slice(0, maxIdx + 1), tol);
    const r = dpSimplify(pts.slice(maxIdx), tol);
    return [...l.slice(0, -1), ...r];
  }
  return [pts[0], pts[pts.length - 1]];
}

async function downloadRoads() {
  const highwayFilter = ROAD_CLASSES.map(c => `["highway"="${c}"]`).join('|');
  const query =
    `[out:json][timeout:180][bbox:${BBOX.minLat},${BBOX.minLng},${BBOX.maxLat},${BBOX.maxLng}];` +
    `(way[highway~"^(${ROAD_CLASSES.join('|')})$"];);` +
    `out geom;`;

  console.log('Fetching NYC road data from Overpass API…');
  console.log('(This may take 15–30 seconds)');

  // Use GET with proper User-Agent — some mirrors reject POST from cloud IPs
  const MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
  ];

  const UA = 'LaPuffOnline/1.0 (nyc-map-data-processing; contact@lapuff.online)';

  let json = null;
  for (const mirror of MIRRORS) {
    const url = `${mirror}?data=${encodeURIComponent(query)}`;
    console.log(`  Trying ${mirror}…`);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) { console.log(`  ✗ HTTP ${res.status}`); continue; }
      json = await res.json();
      console.log(`  ✓ Got ${json.elements?.length ?? 0} elements`);
      break;
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
    }
  }
  if (!json) throw new Error('All Overpass mirrors failed.');

  console.log(`Downloaded ${json.elements.length} road ways.`);
  return json.elements;
}

async function main() {
  const outPath = path.resolve(__dirname, '../public/data/roads_buffered.fgb');

  // ── 1. Download ───────────────────────────────────────────────────────────
  const ways = await downloadRoads();

  // ── 2. Convert to buffered GeoJSON features ───────────────────────────────
  console.log('Buffering road LineStrings into polygon slabs…');

  const features = [];
  let skipped = 0;

  for (const way of ways) {
    if (!way.geometry || way.geometry.length < 2) { skipped++; continue; }

    const highway = way.tags?.highway;
    const bufM = BUFFER_METERS[highway];
    if (!bufM) { skipped++; continue; }

    // Convert Overpass geom ([{lat,lon}]) to GeoJSON [lng, lat]
    const rawCoords = way.geometry.map(pt => [pt.lon, pt.lat]);

    // Simplify before buffering (tolerance ≈ 3m in degrees)
    const coords = dpSimplify(rawCoords, 0.00003);
    if (coords.length < 2) { skipped++; continue; }

    const rings = bufferLineString(coords, bufM);
    if (!rings) { skipped++; continue; }

    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: rings },
      properties: {
        highway,
        bufM,
        wayId: way.id,
      },
    });
  }

  console.log(`Buffered ${features.length} ways (skipped ${skipped} invalid/short).`);

  // Filter out any features with degenerate rings (< 4 points = uncloseable polygon)
  const validFeatures = features.filter(f => f.geometry.coordinates[0].length >= 4);
  if (validFeatures.length < features.length) {
    console.log(`  (filtered ${features.length - validFeatures.length} degenerate polygons)`);
  }

  // ── 3. Serialize to FlatGeobuf ────────────────────────────────────────────
  console.log('Serializing to FlatGeobuf…');

  const featureCollection = { type: 'FeatureCollection', features: validFeatures };

  // flatgeobuf serialize yields individual bytes — batch into 64KB chunks before writing
  const ws = fs.createWriteStream(outPath);
  const BATCH = 65536;
  let batch = [];
  let bytesWritten = 0;
  for await (const byte of serialize(featureCollection)) {
    batch.push(byte);
    if (batch.length >= BATCH) {
      ws.write(Buffer.from(batch));
      bytesWritten += batch.length;
      batch = [];
      if (bytesWritten % (BATCH * 64) === 0) {
        process.stdout.write(`  ${(bytesWritten / 1024 / 1024).toFixed(1)} MB written…\r`);
      }
    }
  }
  if (batch.length) { ws.write(Buffer.from(batch)); bytesWritten += batch.length; }
  await new Promise((res, rej) => ws.end(err => err ? rej(err) : res()));
  process.stdout.write('\n');

  console.log(`\n✓ Written to ${outPath}`);
  console.log(`  File size: ${(bytesWritten / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Features: ${validFeatures.length}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
