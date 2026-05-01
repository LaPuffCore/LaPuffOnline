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

// Buffer half-widths in meters per road class, per zoom range.
// 3 merged tiers (each sub-class gets the same buffer as the tier's primary class):
//   Tier 0: motorway + trunk + _links   → motorway size
//   Tier 1: primary + secondary + _links → primary size
//   Tier 2: tertiary + residential + unclassified + _links + living_street → tertiary size
// NEAR (z12+) is 30% smaller than what would otherwise be used.
const BUFFER_METERS_NEAR = {
  motorway:         14,   // 23 × 0.60 ≈ 14
  trunk:            14,
  motorway_link:    11,   // ramps narrower than parent
  trunk_link:       11,
  primary:           8,   // 14 × 0.60 ≈ 8
  secondary:         8,
  primary_link:      7,
  secondary_link:    7,
  tertiary:          5,   // 8 × 0.60 ≈ 5
  residential:       5,
  unclassified:      5,
  tertiary_link:     4,
  living_street:     4,
};
const BUFFER_METERS_FAR = {
  motorway:         46,
  trunk:            46,
  motorway_link:    38,
  trunk_link:       38,
  primary:          40,
  secondary:        40,
  primary_link:     32,
  secondary_link:   32,
  tertiary:         22,
  residential:      22,
  unclassified:     22,
  tertiary_link:    17,
  living_street:    15,
};

// Baked tier index (integer property) for GPU-side filter in MapLibre:
//   0 = motorway tier
//   1 = primary tier
//   2 = tertiary tier
const ROAD_TIER = {
  motorway: 0, trunk: 0, motorway_link: 0, trunk_link: 0,
  primary: 1, secondary: 1, primary_link: 1, secondary_link: 1,
  tertiary: 2, residential: 2, unclassified: 2, tertiary_link: 2, living_street: 2,
};

// Roads that use "any vertex in borough polygon" check (cross-borough roads need this).
// motorway/trunk/_links use BBOX check (bridges cross water, polygon would drop them).
const BOROUGH_ANY_VERTEX = new Set(['primary', 'secondary', 'primary_link', 'secondary_link']);
// Roads that use midpoint PiP (denser classes — midpoint avoids NJ/CT clutter).
const BOROUGH_MIDPOINT = new Set(['tertiary', 'residential', 'unclassified', 'tertiary_link', 'living_street']);

// Road classes to include (skip service/path/cycleway — too many, too narrow to matter)
const ROAD_CLASSES = Object.keys(BUFFER_METERS_NEAR);

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
  const boroughPath = path.resolve(__dirname, '../public/data/borough.geo.json');

  // ── 0. Load borough geometry for confinement filter ───────────────────────
  console.log('Loading borough.geo.json for confinement filter…');
  const boroughGeo = JSON.parse(fs.readFileSync(boroughPath, 'utf8'));
  // Flatten to a list of {ring, holes} polygons (one per outer ring across all MultiPolygons)
  const boroughPolys = [];
  for (const f of boroughGeo.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      boroughPolys.push({ outer: g.coordinates[0], holes: g.coordinates.slice(1) });
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        boroughPolys.push({ outer: poly[0], holes: poly.slice(1) });
      }
    }
  }
  // Pre-compute each polygon's bbox for early-exit
  for (const p of boroughPolys) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of p.outer) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    p.bbox = [minX, minY, maxX, maxY];
  }
  console.log(`  Loaded ${boroughPolys.length} borough sub-polygons.`);

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function pointInBoroughs(lng, lat) {
    for (const p of boroughPolys) {
      const [minX, minY, maxX, maxY] = p.bbox;
      if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
      if (!pointInRing(lng, lat, p.outer)) continue;
      let inHole = false;
      for (const h of p.holes) { if (pointInRing(lng, lat, h)) { inHole = true; break; } }
      if (!inHole) return true;
    }
    return false;
  }

  /**
   * For motorway/trunk: keep the road if ANY vertex lies within the NYC BBOX.
   * We use BBOX (not borough polygons) because bridges run over water, so their
   * vertices may not be inside any borough polygon. BBOX is permissive enough
   * to include all NYC-area highways without dropping bridges.
   */
  function anyVertexInBbox(coords) {
    return coords.some(([lng, lat]) =>
      lng >= BBOX.minLng && lng <= BBOX.maxLng &&
      lat >= BBOX.minLat && lat <= BBOX.maxLat
    );
  }

  // ── 1. Download ───────────────────────────────────────────────────────────
  const ways = await downloadRoads();

  // Each road way produces TWO polygon features:
  //   _z='f' (far): 2x wider buffer, shown at z9-z12
  //   _z='n' (near): calibrated buffer, shown at z12+
  // Motorway/trunk are clipped to borough boundary (not excluded like other roads).
  // _z uses strings ('f'/'n') not integers to avoid MapLibre filter falsy-zero issues.
  console.log('Buffering road LineStrings into polygon slabs (far + near versions)…');

  const features = [];
  let skipped = 0;
  let droppedOutsideBoroughs = 0;

  for (const way of ways) {
    if (!way.geometry || way.geometry.length < 2) { skipped++; continue; }

    const highway = way.tags?.highway;
    if (!BUFFER_METERS_NEAR[highway]) { skipped++; continue; }

    // Convert Overpass geom ([{lat,lon}]) to GeoJSON [lng, lat]
    const rawCoords = way.geometry.map(pt => [pt.lon, pt.lat]);

    // Determine which linestring segments to buffer.
    // - Borough-confined roads (primary/secondary/tertiary/residential): drop if midpoint outside.
    // - Motorway/trunk: clip to borough boundary, producing multiple sub-linestrings.
    let coordSets; // array of [lng,lat][] to buffer
    if (BOROUGH_ANY_VERTEX.has(highway)) {
      // primary/secondary and their _links: keep if any vertex is inside any borough polygon.
      // This preserves cross-borough roads (bridges between Manhattan–Brooklyn, etc.)
      // without letting NJ/CT primary roads bleed in (they have no vertices inside boroughs).
      const anyInBorough = rawCoords.some(([lng, lat]) => pointInBoroughs(lng, lat));
      if (!anyInBorough) { droppedOutsideBoroughs++; continue; }
      const simplified = dpSimplify(rawCoords, 0.00003);
      if (simplified.length < 2) { skipped++; continue; }
      coordSets = [simplified];
    } else if (BOROUGH_MIDPOINT.has(highway)) {
      // tertiary+ classes: midpoint PiP keeps denser local streets without NJ/CT spillover.
      const mid = rawCoords[Math.floor(rawCoords.length / 2)];
      if (!pointInBoroughs(mid[0], mid[1])) { droppedOutsideBoroughs++; continue; }
      const simplified = dpSimplify(rawCoords, 0.00003);
      if (simplified.length < 2) { skipped++; continue; }
      coordSets = [simplified];
    } else {
      // Motorway/trunk and their _links: keep if ANY vertex is within the NYC BBOX.
      // BBOX (not borough PiP) preserves bridges that run over water/between boroughs.
      if (!anyVertexInBbox(rawCoords)) { droppedOutsideBoroughs++; continue; }
      const simplified = dpSimplify(rawCoords, 0.00003);
      if (simplified.length < 2) { skipped++; continue; }
      coordSets = [simplified];
    }

    // Emit far (_z='f') and near (_z='n') versions for each segment
    for (const coords of coordSets) {
      for (const [_z, bufM] of [['f', BUFFER_METERS_FAR[highway]], ['n', BUFFER_METERS_NEAR[highway]]]) {
        const rings = bufferLineString(coords, bufM);
        if (!rings) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: rings },
          properties: { highway, bufM, wayId: way.id, _z, _tier: ROAD_TIER[highway] },
        });
      }
    }
  }

  console.log(`Buffered ${features.length} features from ${(features.length / 2) | 0} road segments (skipped ${skipped} invalid, dropped ${droppedOutsideBoroughs} outside boroughs).`);

  // ── 2b. Simplify polygons (Douglas-Peucker, ≈1m tolerance) ──────────────
  // Reduces vertex count on road ribbons without changing visible shape at z9–z14.
  const SIMPLIFY_TOLERANCE = 0.000009; // ~1m in degrees at NYC latitude

  function perpDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function dpSimplify(pts, tol) {
    if (pts.length <= 2) return pts;
    let maxD = 0, maxI = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpDist(pts[i][0], pts[i][1], pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol) {
      const L = dpSimplify(pts.slice(0, maxI + 1), tol);
      const R = dpSimplify(pts.slice(maxI), tol);
      return [...L.slice(0, -1), ...R];
    }
    return [pts[0], pts[pts.length - 1]];
  }

  let simplifiedCount = 0;
  features.forEach(f => {
    const ring = f.geometry.coordinates[0];
    const pts = ring.slice(0, -1); // drop closing point before simplify
    const simp = dpSimplify(pts, SIMPLIFY_TOLERANCE);
    if (simp.length >= 3 && simp.length < pts.length) {
      f.geometry.coordinates[0] = [...simp, simp[0]]; // re-close ring
      simplifiedCount++;
    }
  });
  console.log(`  Simplified ${simplifiedCount} polygons.`);

  // Filter out any features with degenerate rings (< 4 points = uncloseable polygon)
  const validFeatures = features.filter(f => f.geometry.coordinates[0].length >= 4);
  if (validFeatures.length < features.length) {
    console.log(`  (filtered ${features.length - validFeatures.length} degenerate polygons)`);
  }

  // ── 3. Serialize to FlatGeobuf (with Hilbert R-tree spatial index) ────────
  console.log('Serializing to FlatGeobuf (with spatial index)…');

  const featureCollection = { type: 'FeatureCollection', features: validFeatures };

  // flatgeobuf serialize yields individual bytes — batch into 64KB chunks before writing
  // true = create Hilbert R-tree spatial index (enables fast HTTP Range bbox queries on mobile)
  const ws = fs.createWriteStream(outPath);
  const BATCH = 65536;
  let batch = [];
  let bytesWritten = 0;
  for await (const byte of serialize(featureCollection, true)) {
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
