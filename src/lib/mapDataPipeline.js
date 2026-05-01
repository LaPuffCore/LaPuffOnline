// mapDataPipeline — pure data pipeline functions + Phase 2A executor.
// All geometry helpers are COPIED from MapView.jsx so this module can run
// independently inside MapLoadingScreen without importing the component.
// MapView.jsx retains its own copies so its render code is unchanged.

import { deserialize as fgbDeserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import mapCacheStore from './mapCacheStore';

// ── Constants ────────────────────────────────────────────────────────────────
export const GEOJSON_URL        = './data/MODZCTA_2010_WGS1984.geo.json';
export const BOROUGH_GEOJSON_URL = './data/borough.geo.json';
export const BUILDING_FGB_URL   = './data/final_building.fgb';
export const ROAD_FGB_URL       = './data/roads_buffered.fgb';
export const FGB_CACHE_NAME     = 'lapuff-fgb-v4';
export const FGB_CACHE_KEY      = 'final_building.fgb';
export const ROADS_FGB_CACHE_NAME = 'lapuff-roads-v4';
export const ROADS_FGB_CACHE_KEY  = 'roads_buffered.fgb';
export const MAP_CACHE_DONE_KEY     = 'lapuff_map_cache_v1';
export const MAP_CACHE_BUILDING_KEY = 'lapuff_map_cache_building';

export const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

const FGB_YIELD_CHUNK = 10000;
const PIP_YIELD_CHUNK  = 2000;  // smaller chunks for PiP so the main thread breathes more often
const FGB_ESTIMATED_TOTAL = 381000;

// ── Ring / winding helpers ────────────────────────────────────────────────────

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function dedupeRing(ring) {
  if (!ring || ring.length === 0) return [];
  const cleaned = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = ring[i];
    const [px, py] = cleaned[cleaned.length - 1];
    if (Math.abs(x - px) > 1e-8 || Math.abs(y - py) > 1e-8) cleaned.push(ring[i]);
  }
  if (cleaned.length > 1) {
    const [x, y] = cleaned[0];
    const [lx, ly] = cleaned[cleaned.length - 1];
    if (Math.abs(x - lx) < 1e-8 && Math.abs(y - ly) < 1e-8) cleaned.pop();
  }
  return cleaned;
}

function isNearlyCollinear(a, b, c) {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(cross) < 1e-12;
}

function closeRing(ring) {
  return ring.length === 0 || (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
    ? ring
    : [...ring, ring[0]];
}

function simplifyRing(ring) {
  if (ring.length < 4) return ring;
  const simplified = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = ring[i];
    const next = ring[i + 1];
    if (!isNearlyCollinear(prev, curr, next)) simplified.push(curr);
  }
  simplified.push(ring[ring.length - 1]);
  return simplified.length >= 4 ? simplified : ring;
}

function subdivideRing(ring, minPoints = 8) {
  const closed = closeRing(ring);
  const baseCount = closed.length - 1;
  if (baseCount >= minPoints) return closed;
  const segments = baseCount;
  const insertCount = Math.max(1, Math.ceil((minPoints - baseCount) / segments));
  const subdivided = [];
  for (let i = 0; i < segments; i++) {
    const current = closed[i];
    const next = closed[i + 1];
    subdivided.push(current);
    for (let step = 1; step <= insertCount; step++) {
      const t = step / (insertCount + 1);
      subdivided.push([current[0] + (next[0] - current[0]) * t, current[1] + (next[1] - current[1]) * t]);
    }
  }
  return closeRing(subdivided);
}

function smoothRing(ring, passes = 1) {
  let current = closeRing(ring).slice(0, -1);
  for (let pass = 0; pass < passes; pass++) {
    if (current.length < 3) break;
    const next = [];
    for (let i = 0; i < current.length; i++) {
      const p = current[i];
      const q = current[(i + 1) % current.length];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    current = next;
  }
  return closeRing(current);
}

function normalizeRing(ring) {
  const closed = closeRing(ring);
  const deduped = dedupeRing(closed);
  if (deduped.length < 4) return null;
  return closeRing(simplifyRing(deduped));
}

function normalizePolygonCoords(coords) {
  return coords
    .map(normalizeRing)
    .filter(ring => ring && ring.length >= 4)
    .map(ring => closeRing(ring))
    .filter(Boolean);
}

function normalizeFeatureGeometry(feature) {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    const rings = normalizePolygonCoords(geom.coordinates);
    if (rings.length === 0) return null;
    return { type: 'Polygon', coordinates: rings };
  }
  if (geom.type === 'MultiPolygon') {
    const polygons = geom.coordinates.map(normalizePolygonCoords).filter(rings => rings.length);
    if (polygons.length === 0) return null;
    return { type: 'MultiPolygon', coordinates: polygons };
  }
  return null;
}

function enforceGeoJSONWinding(feature) {
  if (!feature || !feature.geometry) return feature;
  const { type, coordinates } = feature.geometry;
  if (type !== 'Polygon' && type !== 'MultiPolygon') return feature;
  const fixRings = rings => rings.map((ring, i) => {
    const area = signedArea([...ring, ring[0]]);
    const shouldBePositive = i === 0;
    if ((shouldBePositive && area < 0) || (!shouldBePositive && area > 0)) return [...ring].reverse();
    return ring;
  });
  const fixedCoords = type === 'Polygon' ? fixRings(coordinates) : coordinates.map(fixRings);
  return { ...feature, geometry: { ...feature.geometry, coordinates: fixedCoords } };
}

// ── Meter / vector helpers ────────────────────────────────────────────────────

function lngLatToMeters([lng, lat], refLat) {
  const latRad = refLat * Math.PI / 180;
  return [lng * 111320 * Math.cos(latRad), lat * 111132];
}

function metersToLngLat([x, y], refLat) {
  const latRad = refLat * Math.PI / 180;
  return [x / (111320 * Math.cos(latRad)), y / 111132];
}

function normalize([x, y]) {
  const len = Math.hypot(x, y);
  return len === 0 ? [0, 0] : [x / len, y / len];
}

function lineIntersection(p0, p1, q0, q1) {
  const s1x = p1[0] - p0[0], s1y = p1[1] - p0[1];
  const s2x = q1[0] - q0[0], s2y = q1[1] - q0[1];
  const denom = -s2x * s1y + s1x * s2y;
  if (Math.abs(denom) < 1e-9) return null;
  const s = (-s1y * (p0[0] - q0[0]) + s1x * (p0[1] - q0[1])) / denom;
  return [q0[0] + s * s2x, q0[1] + s * s2y];
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

function isSpecialZip(zip) {
  return !zip || zip === '' || zip === '99999' || parseInt(zip) > 11697 || (typeof zip === 'string' && zip.startsWith('SAFEZONE'));
}

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function getGeomCentroid(geometry) {
  const ring = geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] : geometry.coordinates[0];
  if (!ring || ring.length === 0) return [0, 0];
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  return [sx / ring.length, sy / ring.length];
}

// ── Skeleton builders ─────────────────────────────────────────────────────────

const SKEL_MITER_LIMIT = 2.5;

function buildRingSkeleton(rawRing, direction) {
  const normalized = normalizeRing(rawRing);
  if (!normalized || normalized.length < 4) return null;
  const ring = normalized[0][0] === normalized[normalized.length - 1][0] && normalized[0][1] === normalized[normalized.length - 1][1]
    ? normalized.slice(0, -1) : normalized;
  if (ring.length < 3) return null;

  const refLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const pts = ring.map(coord => lngLatToMeters(coord, refLat));
  const orientation = signedArea([...pts, pts[0]]) >= 0 ? 1 : -1;

  const normals = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    const dx = next[0] - p[0], dy = next[1] - p[1];
    return direction === 'inward'
      ? normalize(orientation > 0 ? [-dy, dx] : [dy, -dx])
      : normalize(orientation > 0 ? [dy, -dx] : [-dy, dx]);
  });

  const unitEdges = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length], n = normals[i];
    return { p0: [p[0] + n[0], p[1] + n[1]], p1: [next[0] + n[0], next[1] + n[1]] };
  });

  const unitOffsetVecs = pts.map((_, i) => {
    const prev = unitEdges[(i - 1 + unitEdges.length) % unitEdges.length];
    const curr = unitEdges[i];
    const avgNorm = normalize([
      normals[(i - 1 + normals.length) % normals.length][0] + normals[i][0],
      normals[(i - 1 + normals.length) % normals.length][1] + normals[i][1],
    ]);
    const intersection = lineIntersection(prev.p0, prev.p1, curr.p0, curr.p1);
    if (intersection) {
      const dx = intersection[0] - pts[i][0], dy = intersection[1] - pts[i][1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > SKEL_MITER_LIMIT) return [avgNorm[0] * SKEL_MITER_LIMIT, avgNorm[1] * SKEL_MITER_LIMIT];
      return [dx, dy];
    }
    return [avgNorm[0], avgNorm[1]];
  });

  return { ring, refLat, pts, unitOffsetVecs };
}

function buildZctaSkeleton(sourceGeoJSON) {
  return sourceGeoJSON.features.map(feature => {
    if (feature.properties?._special) return null;
    const geom = feature.geometry;
    const props = feature.properties || {};
    if (geom.type === 'Polygon') {
      const skel = buildRingSkeleton(geom.coordinates[0], 'inward');
      return skel ? { props, rings: [skel] } : null;
    }
    if (geom.type === 'MultiPolygon') {
      const rings = geom.coordinates.map(p => buildRingSkeleton(p[0], 'inward')).filter(Boolean);
      return rings.length ? { props, rings } : null;
    }
    return null;
  }).filter(Boolean);
}

function buildBoroughSkeleton(sourceGeoJSON) {
  return sourceGeoJSON.features.map(feature => {
    const normalizedGeom = normalizeFeatureGeometry(feature) || feature.geometry;
    if (!normalizedGeom) return null;
    const props = feature.properties || {};
    if (normalizedGeom.type === 'Polygon') {
      const skel = buildRingSkeleton(normalizedGeom.coordinates[0], 'outward');
      return skel ? { props, rings: [skel] } : null;
    }
    if (normalizedGeom.type === 'MultiPolygon') {
      const rings = normalizedGeom.coordinates.map(p => buildRingSkeleton(p[0], 'outward')).filter(Boolean);
      return rings.length ? { props, rings } : null;
    }
    return null;
  }).filter(Boolean);
}

// ── Heatmap / tier computation ────────────────────────────────────────────────

function buildZipEventMap(events, days) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const maxDate = new Date(now.getTime() + days * 86400000);
  const zipMap = {};
  events.forEach(e => {
    if (e._auto) return;
    const ed = new Date(e.event_date + 'T00:00:00');
    if (ed < now || ed > maxDate) return;
    const zip = (e.location_data?.zipcode || '').trim().replace(/\D/g, '').padStart(5, '0').slice(0, 5);
    if (!zip) return;
    if (!zipMap[zip]) zipMap[zip] = [];
    zipMap[zip].push(e);
  });
  const counts = Object.values(zipMap).map(a => a.length);
  const maxCount = counts.length > 0 ? Math.max(...counts) : 1;
  return { zipMap, maxCount };
}

function normalizeHeat(count, maxCount) {
  if (count === 0) return 0;
  if (maxCount <= 1) return 1;
  return Math.log(count + 1) / Math.log(maxCount + 1);
}

function buildAdjacency(features) {
  const bboxes = features.map(f => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rings = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat(1) : f.geometry.coordinates;
    rings.forEach(ring => ring.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));
    return { minX, minY, maxX, maxY };
  });
  return features.map((_, i) => {
    const neighbors = [];
    const buf = 0.008;
    const a = bboxes[i];
    for (let j = 0; j < features.length; j++) {
      if (j === i) continue;
      const b = bboxes[j];
      if (a.maxX + buf >= b.minX && b.maxX + buf >= a.minX && a.maxY + buf >= b.minY && b.maxY + buf >= a.minY)
        neighbors.push(j);
    }
    return neighbors;
  });
}

function computeTiers(features, zipMap, maxCount, adjacency) {
  const rawTiers = features.map(f => {
    if (f.properties._special) return -1;
    const zip = String(f.properties.MODZCTA || '');
    const count = zipMap[zip]?.length || 0;
    const heat = normalizeHeat(count, maxCount);
    if (count === 0) return 0;
    if (heat >= 0.80) return 4;
    if (heat >= 0.55) return 3;
    if (heat >= 0.30) return 2;
    return 1;
  });
  const tiers = [...rawTiers];
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < features.length; i++) {
      if (tiers[i] < 0) continue;
      (adjacency[i] || []).forEach(j => {
        if (tiers[j] < 0) return;
        const d = tiers[i] - 1;
        if (d > tiers[j]) tiers[j] = d;
      });
    }
  }
  return tiers;
}

function computeZipBoroughMap(zctaFeatures, boroughFeatures) {
  const result = {};
  zctaFeatures.forEach((f, i) => {
    if (f.properties._special) return;
    const [cx, cy] = getGeomCentroid(f.geometry);
    for (let bi = 0; bi < boroughFeatures.length; bi++) {
      const bGeom = boroughFeatures[bi].geometry;
      const polys = bGeom.type === 'MultiPolygon' ? bGeom.coordinates : [bGeom.coordinates];
      let found = false;
      for (const poly of polys) {
        if (pointInRing(cx, cy, poly[0])) { found = true; break; }
      }
      if (found) { result[i] = bi; break; }
    }
  });
  return result;
}

function computeZctaBboxes(geoData) {
  return geoData.features.map(f => {
    if (!f.geometry) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    return { minX, minY, maxX, maxY };
  });
}

// ── FGB pipeline ─────────────────────────────────────────────────────────────

function normalizeFGBProps(props, i) {
  const hr = parseFloat(props?.HEIGHT_ROOF ?? props?.height_roof);
  return {
    height_roof: isNaN(hr) ? 8 : hr,
    _s5: i % 5,
    _s7: i % 7,
    _tier_0: 0, _tier_1: 0, _tier_2: 0, _tier_3: 0, _tier_4: 0,
  };
}

async function parseFGBBuffer(buf, onProgress) {
  const features = [];
  let count = 0;
  for await (const feature of fgbDeserialize(buf)) {
    if (!feature?.geometry?.coordinates) continue;
    feature.properties = normalizeFGBProps(feature.properties, count);
    features.push(feature);
    count++;
    if (count % FGB_YIELD_CHUNK === 0) {
      if (onProgress) onProgress(count);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (onProgress) onProgress(count);
  return { type: 'FeatureCollection', features };
}

// Modified: takes zctaFeatures as first param instead of reading from a ref.
async function buildZctaIndexMap(zctaFeatures, buildingFeatures, onProgress) {
  if (!zctaFeatures?.length) return null;
  const idxMap = new Int16Array(buildingFeatures.length).fill(-1);
  for (let i = 0; i < buildingFeatures.length; i++) {
    const centroid = getGeomCentroid(buildingFeatures[i].geometry);
    for (let j = 0; j < zctaFeatures.length; j++) {
      if (zctaFeatures[j].properties?._special) continue;
      const geom = zctaFeatures[j].geometry;
      const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
      for (const poly of polys) {
        if (pointInRing(centroid[0], centroid[1], poly[0])) { idxMap[i] = j; break; }
      }
      if (idxMap[i] >= 0) break;
    }
    if (i % PIP_YIELD_CHUNK === 0 && i > 0) {
      if (onProgress) onProgress(i);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (onProgress) onProgress(buildingFeatures.length);
  return idxMap;
}

// Standalone baking — writes _tier_0.._tier_4 into buildingFGB properties.
// Async with yielding so the main thread doesn't freeze.
async function bakeAllTiersIntoBuildingsData(buildingFGB, zctaIndexMap, precomputedTiers, onProgress) {
  const features = buildingFGB.features;
  for (let start = 0; start < features.length; start += FGB_YIELD_CHUNK) {
    const end = Math.min(start + FGB_YIELD_CHUNK, features.length);
    for (let i = start; i < end; i++) {
      const zIdx = zctaIndexMap[i];
      const props = features[i].properties;
      for (let t = 0; t < TIMESPAN_STEPS.length; t++) {
        const tiers = precomputedTiers[t]?.tiers;
        props[`_tier_${t}`] = (zIdx >= 0 && tiers && tiers.length > zIdx) ? (tiers[zIdx] ?? 0) : 0;
      }
    }
    if (onProgress) onProgress(start + FGB_YIELD_CHUNK);
    await new Promise(r => setTimeout(r, 0));
  }
  return buildingFGB;
}

// ── Road FGB cache (both mobile + desktop in Phase 2A: bytes only, no parse) ─
async function cacheRoadFGB() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(ROADS_FGB_CACHE_NAME);
    // Already cached — skip
    if (await cache.match(ROADS_FGB_CACHE_KEY)) return;
    const resp = await fetch(ROAD_FGB_URL);
    if (!resp.ok) return;
    const ab = await resp.arrayBuffer();
    await cache.put(ROADS_FGB_CACHE_KEY, new Response(ab, {
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
  } catch (e) { /* silent — MapView will fall back to direct fetch */ }
}

// ── FGB sub-pipeline (desktop only) ──────────────────────────────────────────

async function runFGBPipeline(zctaFeatures, precomputedTiers, P, onProgress) {
  const report = (pct, msg) => onProgress?.(pct, msg);

  // Check for cached ZCTA index (skip expensive PiP on warm loads)
  let cachedZctaIndex = null;
  if ('caches' in window) {
    try {
      const cache = await caches.open(FGB_CACHE_NAME);
      const idxResp = await cache.match('building_zcta_index.bin');
      if (idxResp) cachedZctaIndex = new Int16Array(await idxResp.arrayBuffer());
    } catch (e) { /* ignore */ }
  }

  // Step 7: FGB raw bytes (cache or network)
  report(P.fgbFetch[0], 'Loading building data...');
  let buf = null;
  if ('caches' in window) {
    try {
      const cache = await caches.open(FGB_CACHE_NAME);
      const cached = await cache.match(FGB_CACHE_KEY);
      if (cached) buf = new Uint8Array(await cached.arrayBuffer());
    } catch (e) { /* ignore */ }
  }
  if (!buf) {
    const resp = await fetch(BUILDING_FGB_URL);
    if (!resp.ok) throw new Error(`FGB fetch failed: ${resp.status}`);
    const arrayBuf = await resp.arrayBuffer();
    buf = new Uint8Array(arrayBuf);
    if ('caches' in window) {
      try {
        const cache = await caches.open(FGB_CACHE_NAME);
        await cache.put(FGB_CACHE_KEY, new Response(arrayBuf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
      } catch (e) { /* ignore */ }
    }
  }
  report(P.fgbFetch[1], 'Building data cached');

  // Step 8: Parse FGB binary → GeoJSON
  report(P.fgbParse[0], 'Parsing building geometry...');
  const span8 = P.fgbParse[1] - P.fgbParse[0];
  const geojson = await parseFGBBuffer(buf, count => {
    report(Math.min(P.fgbParse[0] + Math.round((count / FGB_ESTIMATED_TOTAL) * span8), P.fgbParse[1]), 'Parsing building geometry...');
  });
  mapCacheStore.buildingFGB = geojson;
  report(P.fgbParse[1], 'Building geometry parsed');

  // Step 9: ZCTA index PiP (or warm-load from cache)
  report(P.pip[0], 'Indexing buildings to zones...');
  let idxMap = cachedZctaIndex;
  if (idxMap && idxMap.length === geojson.features.length) {
    mapCacheStore.buildingZctaIndex = idxMap;
    report(P.pip[1], 'Zone index loaded from cache');
  } else {
    const span9 = P.pip[1] - P.pip[0];
    idxMap = await buildZctaIndexMap(zctaFeatures, geojson.features, count => {
      report(Math.min(P.pip[0] + Math.round((count / FGB_ESTIMATED_TOTAL) * span9), P.pip[1]), 'Indexing buildings...');
    });
    mapCacheStore.buildingZctaIndex = idxMap;
    if (idxMap && 'caches' in window) {
      try {
        const cache = await caches.open(FGB_CACHE_NAME);
        await cache.put('building_zcta_index.bin', new Response(idxMap.buffer.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
      } catch (e) { /* ignore */ }
    }
    report(P.pip[1], 'Buildings indexed');
  }

  // Step 10: Bake all 5 tier columns into building properties
  report(P.bake[0], 'Baking tier data into buildings...');
  const span10 = P.bake[1] - P.bake[0];
  await bakeAllTiersIntoBuildingsData(geojson, idxMap, precomputedTiers, count => {
    report(Math.min(P.bake[0] + Math.round((count / FGB_ESTIMATED_TOTAL) * span10), P.bake[1]), 'Baking tier data...');
  });
  mapCacheStore.buildingTiersBaked = true;
  report(P.bake[1], 'Tier data baked');
}

// ── Phase 2A entry point ─────────────────────────────────────────────────────

/**
 * Run Phase 2A: pure data pipeline. All results stored in mapCacheStore.
 * @param {Array} events - app event array (for tier computation)
 * @param {boolean} isMobile - if true, skips FGB pipeline (mobile uses JIT chunking)
 * @param {Function} onProgress - (pct: number, msg: string) => void
 */
export async function runPhase2A(events, isMobile, onProgress) {
  // Corruption guard: incomplete previous build → wipe and force full rebuild
  const wasBuilding = localStorage.getItem(MAP_CACHE_BUILDING_KEY);
  const isDoneFlag  = localStorage.getItem(MAP_CACHE_DONE_KEY);
  if (wasBuilding && !isDoneFlag) {
    localStorage.removeItem(MAP_CACHE_BUILDING_KEY);
    localStorage.removeItem(MAP_CACHE_DONE_KEY);
    if ('caches' in window) caches.delete(FGB_CACHE_NAME).catch(() => {});
  }
  localStorage.setItem(MAP_CACHE_BUILDING_KEY, '1');

  const startTime = Date.now();

  // Progress ranges per platform
  // Desktop: 13 steps total (2A: 0→93%, 2B: 93→100%)
  // Mobile:  8 steps total  (2A: 0→85%, 2B: 85→100%)
  const P = isMobile ? {
    zcta:      [0,  20],
    adj:       [20, 35],
    skel:      [35, 43],
    boro:      [43, 57],
    boroSkel:  [57, 67],
    tiers:     [67, 83],
    roadCache: [83, 85],
  } : {
    zcta:      [0,  12],
    adj:       [12, 20],
    skel:      [20, 24],
    boro:      [24, 30],
    boroSkel:  [30, 34],
    tiers:     [34, 42],
    roadCache: [42, 44],
    fgbFetch:  [44, 56],
    fgbParse:  [56, 72],
    pip:       [72, 85],
    bake:      [85, 93],
  };

  const report = (pct, msg) => onProgress?.(pct, msg);

  // ── Step 1: ZCTA GeoJSON fetch + safezone parse ──────────────────────────
  report(P.zcta[0], 'Fetching zone boundaries...');
  const rawGeo = await fetch(GEOJSON_URL).then(r => r.json());
  const features = [];
  let safezoneCounter = 0;

  rawGeo.features.forEach((f, i) => {
    let zip = String(f.properties.MODZCTA || f.properties.modzcta || '');
    if (isSpecialZip(zip) && f.geometry?.type === 'MultiPolygon') {
      f.geometry.coordinates.forEach((polyCoords, pi) => {
        const szNum = ++safezoneCounter;
        const modzcta = `SAFEZONE_${szNum}`;
        let szFeature = {
          ...f,
          geometry: { type: 'Polygon', coordinates: polyCoords },
          properties: { ...f.properties, MODZCTA: modzcta, _special: true, _safezoneNum: szNum, label: `Safezone ${szNum}` },
        };
        szFeature = enforceGeoJSONWinding(szFeature);
        features.push({ ...szFeature, id: i * 1000 + pi });
      });
    } else {
      if (isSpecialZip(zip) && !zip.startsWith('SAFEZONE')) {
        const szNum = ++safezoneCounter;
        const modzcta = `SAFEZONE_${szNum}`;
        f = { ...f, properties: { ...f.properties, MODZCTA: modzcta, _special: true, _safezoneNum: szNum, label: `Safezone ${szNum}` } };
      }
      f = enforceGeoJSONWinding(f);
      features.push({ ...f, id: i });
    }
  });

  const geoData = { ...rawGeo, features };
  report(P.zcta[1], 'Zone boundaries loaded');

  // ── Step 2: Adjacency ────────────────────────────────────────────────────
  report(P.adj[0], 'Computing adjacency graph...');
  await new Promise(r => setTimeout(r, 0));
  const adjacency = buildAdjacency(features);
  report(P.adj[1], 'Adjacency complete');

  // ── Step 3: ZCTA skeleton + bboxes ──────────────────────────────────────
  report(P.skel[0], 'Building outline skeleton...');
  await new Promise(r => setTimeout(r, 0));
  const zctaSkeleton = buildZctaSkeleton(geoData);
  const zctaBboxes = computeZctaBboxes(geoData);
  report(P.skel[1], 'Skeleton built');

  // ── Step 4: Borough GeoJSON ──────────────────────────────────────────────
  report(P.boro[0], 'Fetching borough data...');
  const boroughGeoData = await fetch(BOROUGH_GEOJSON_URL).then(r => r.json());
  report(P.boro[1], 'Borough data loaded');

  // ── Step 5: Borough skeleton + zip-borough map ───────────────────────────
  report(P.boroSkel[0], 'Building borough geometry...');
  await new Promise(r => setTimeout(r, 0));
  const boroughSkeleton = buildBoroughSkeleton(boroughGeoData);
  const zipBoroughMap = computeZipBoroughMap(geoData.features, boroughGeoData.features);
  report(P.boroSkel[1], 'Borough geometry done');

  // ── Step 6: Pre-compute all 5 timespan tiers ─────────────────────────────
  report(P.tiers[0], 'Computing event heat data...');
  const precomputedTiers = {};
  for (let idx = 0; idx < TIMESPAN_STEPS.length; idx++) {
    const { zipMap, maxCount } = buildZipEventMap(events || [], TIMESPAN_STEPS[idx].days);
    const tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
    precomputedTiers[idx] = { tiers, zipMap, maxCount };
    await new Promise(r => setTimeout(r, 0));
  }
  report(P.tiers[1], 'Heat data ready');

  // ── Write all 2A data to store ────────────────────────────────────────────
  mapCacheStore.geoData        = geoData;
  mapCacheStore.adjacency      = adjacency;
  mapCacheStore.zctaSkeleton   = zctaSkeleton;
  mapCacheStore.zctaBboxes     = zctaBboxes;
  mapCacheStore.boroughGeoData = boroughGeoData;
  mapCacheStore.boroughSkeleton = boroughSkeleton;
  mapCacheStore.zipBoroughMap  = zipBoroughMap;
  mapCacheStore.precomputedTiers = precomputedTiers;

  // ── Road FGB bytes → Cache API (both mobile + desktop) ───────────────────
  // Phase 2A caches the raw bytes so MapView can skip the network fetch at
  // Real3D activation time. Parsing happens later on-demand.
  report(P.roadCache[0], 'Caching road geometry...');
  await cacheRoadFGB();
  report(P.roadCache[1], 'Road data cached');

  // ── Steps 7-10: Desktop FGB pipeline ─────────────────────────────────────
  if (!isMobile) {
    await runFGBPipeline(geoData.features, precomputedTiers, P, onProgress);
  }

  // Enforce minimum 1s display time on first load so user sees the loading screen
  const elapsed = Date.now() - startTime;
  if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));

  localStorage.setItem(MAP_CACHE_DONE_KEY, '1');
  localStorage.removeItem(MAP_CACHE_BUILDING_KEY);
}
