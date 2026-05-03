// mapDataPipeline — pure data pipeline functions + Phase 2A executor.
// All geometry helpers are COPIED from MapView.jsx so this module can run
// independently inside MapLoadingScreen without importing the component.
// MapView.jsx retains its own copies so its render code is unchanged.

import { deserialize as fgbDeserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import mapCacheStore from './mapCacheStore';

// ── Constants ────────────────────────────────────────────────────────────────
export const GEOJSON_URL        = './data/MODZCTA_2010_WGS1984.geo.json';
export const BOROUGH_GEOJSON_URL = './data/borough.geo.json';
export const BOROUGH_FGBS = [
  { name: 'BronxAndSafezones', url: './data/BronxAndSafezones_r.fgb', cacheKey: 'BronxAndSafezones_r.fgb' },
  { name: 'Brooklyn',          url: './data/Brooklyn_r.fgb',          cacheKey: 'Brooklyn_r.fgb' },
  { name: 'Manhattan',         url: './data/Manhattan_r.fgb',         cacheKey: 'Manhattan_r.fgb' },
  { name: 'Queens',            url: './data/Queens_r.fgb',            cacheKey: 'Queens_r.fgb' },
  { name: 'Staten Island',     url: './data/Staten Island_r.fgb',     cacheKey: 'Staten Island_r.fgb' },
];
export const FGB_CACHE_NAME     = 'lapuff-fgb-v8';     // v8: HEIGHT_ROOF feet→meters fix + stack-overflow fix
export const MAP_CACHE_DONE_KEY     = 'lapuff_map_cache_v2';
export const MAP_CACHE_BUILDING_KEY = 'lapuff_map_cache_building';

export const ROADS_PMTILES_URL = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/yGTOMC4N2uc1uIGkliFRgP51VbnPm96W8vebh_sOqeoGil3PErp8dvWmy74pEH70/n/idfnjqqb9g0p/b/nyc-map-data/o/realfinaldeciroads.pmtiles';

// Precomputed building centroid binary (Float32Array of [lng,lat] pairs).
// Generated at build time by scripts/build_centroids.mjs. Order matches BOROUGH_FGBS
// + per-borough FGB iteration order (deterministic). Used to skip ~80ms of PiP work
// on desktop and to give mobile viewport queries a fast spatial pre-filter.
export const CENTROIDS_BIN_URL = (typeof window !== 'undefined')
  ? `${window.location.origin}${import.meta.env.BASE_URL}data/building_centroids.bin`
  : '/data/building_centroids.bin';
export const CENTROIDS_META_URL = (typeof window !== 'undefined')
  ? `${window.location.origin}${import.meta.env.BASE_URL}data/building_centroids.meta.json`
  : '/data/building_centroids.meta.json';

async function loadCentroidsBin() {
  try {
    const [binResp, metaResp] = await Promise.all([
      fetch(CENTROIDS_BIN_URL, { cache: 'force-cache' }),
      fetch(CENTROIDS_META_URL, { cache: 'force-cache' }),
    ]);
    if (!binResp.ok || !metaResp.ok) return null;
    const ab = await binResp.arrayBuffer();
    const meta = await metaResp.json();
    return { centroids: new Float32Array(ab), meta };
  } catch (e) { return null; }
}

export const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

const FGB_YIELD_CHUNK = 10000;

// ── Satellite tile precache ─────────────────────────────────────────────────
// Esri World Imagery tiles for NYC bounds at z10-12.
// Fire-and-forget: warms browser HTTP cache so first satellite toggle is instant.
// NYC bbox: lng [-74.27, -73.68], lat [40.47, 40.93]
function lngLatToTile(lng, lat, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}
function precacheSatelliteTiles() {
  if (typeof window === 'undefined') return;
  // Satellite tile strategy (3 zoom levels):
  //   z10: full viewport bbox — ocean baseplate, ~50 tiles
  //   z11: NYC bounds — borough-level detail, ~30 tiles
  //   z12: inner NYC — block-level detail for typical map zoom, ~50 tiles
  // maxzoom in MapView sat source is now 12; MapLibre requests z10/11/12 depending
  // on viewport zoom. Pre-caching all three prevents first-toggle stutter.
  const ARCGIS_TILE = (z, y, x) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const urls = [];

  // z10: full MapLibre maxBounds
  {
    const z = 10, lng1 = -75.50, lat1 = 40.00, lng2 = -72.50, lat2 = 41.50;
    const a = lngLatToTile(lng1, lat2, z), b = lngLatToTile(lng2, lat1, z);
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++)
        urls.push(ARCGIS_TILE(z, y, x));
  }
  // z11: NYC tight bbox
  {
    const z = 11, lng1 = -74.27, lat1 = 40.47, lng2 = -73.68, lat2 = 40.93;
    const a = lngLatToTile(lng1, lat2, z), b = lngLatToTile(lng2, lat1, z);
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++)
        urls.push(ARCGIS_TILE(z, y, x));
  }
  // z12: NYC tight bbox (~4× tile count vs z11, ~50 tiles)
  {
    const z = 12, lng1 = -74.27, lat1 = 40.47, lng2 = -73.68, lat2 = 40.93;
    const a = lngLatToTile(lng1, lat2, z), b = lngLatToTile(lng2, lat1, z);
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++)
        urls.push(ARCGIS_TILE(z, y, x));
  }
  // ~130 tiles total, ~5MB. Throttled at 4 concurrent (polite, no rate-limit risk).
  let active = 0, idx = 0;
  const MAX = 4;
  function next() {
    while (active < MAX && idx < urls.length) {
      active++;
      const u = urls[idx++];
      fetch(u, { mode: 'no-cors', cache: 'force-cache' }).catch(() => {}).finally(() => { active--; next(); });
    }
  }
  next();
}

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
    height_roof: isNaN(hr) ? 8 : hr / 3.28084,  // convert feet → meters
    MODZCTA: props?.MODZCTA ?? null,  // preserve for tier baking
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
    if (i % FGB_YIELD_CHUNK === 0 && i > 0) {
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

// ── FGB sub-pipeline (desktop, worker-based) ─────────────────────────────────
// Parses + bakes all 5 borough FGBs in a Web Worker. Main thread stays free
// during the ~2-4 second FGB parse, only paying the structured-clone cost
// when each borough completes (~50-300ms per borough, sequential).
async function runFGBPipelineWithWorker(zctaFeatures, precomputedTiers, P, onProgress) {
  const report = (pct, msg) => onProgress?.(pct, msg);

  // Step 7: Fetch all borough buffers (Cache API or network) — done on main thread
  // so we can transfer ArrayBuffers into the worker zero-copy.
  report(P.fgbFetch[0], 'Loading building data...');
  const rawBufs = await Promise.all(BOROUGH_FGBS.map(async (borough) => {
    if ('caches' in window) {
      try {
        const cache = await caches.open(FGB_CACHE_NAME);
        const cached = await cache.match(borough.cacheKey);
        if (cached) return await cached.arrayBuffer();
      } catch (e) { /* ignore */ }
    }
    const resp = await fetch(borough.url);
    if (!resp.ok) throw new Error(`FGB fetch failed for ${borough.name}: ${resp.status}`);
    const ab = await resp.arrayBuffer();
    if ('caches' in window) {
      try {
        const cache = await caches.open(FGB_CACHE_NAME);
        await cache.put(borough.cacheKey, new Response(ab.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
      } catch (e) { /* ignore */ }
    }
    return ab;
  }));
  report(P.fgbFetch[1], 'Building data cached');

  // Step 8-10: Worker handles parse + index + bake in one pass.
  return await new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./fgbWorker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }

    const allFeatures = [];
    const idxMaps = [];
    mapCacheStore.buildingFGBStream = [];
    const reportSpan = P.bake[1] - P.fgbParse[0];

    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'PROGRESS') {
        const pct = Math.min(P.fgbParse[0] + Math.round((m.pct / 100) * reportSpan), P.bake[1] - 1);
        report(pct, m.msg);
      } else if (m.type === 'BOROUGH_DONE') {
        // Safe large-array merge — spread push causes stack overflow on 200K+ arrays
        for (let _fi = 0; _fi < m.features.length; _fi++) allFeatures.push(m.features[_fi]);
        idxMaps.push(m.idxMap);
        mapCacheStore.buildingFGBStream.push({ borough: m.borough, features: m.features });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lapuff:fgb-borough-ready', { detail: { borough: m.borough } }));
        }
      } else if (m.type === 'ALL_DONE') {
        // Merge per-borough idxMaps into one Int16Array
        const totalLen = idxMaps.reduce((s, a) => s + a.length, 0);
        const merged = new Int16Array(totalLen);
        let off = 0;
        for (const a of idxMaps) { merged.set(a, off); off += a.length; }

        const geojson = { type: 'FeatureCollection', features: allFeatures };
        mapCacheStore.buildingFGB = geojson;
        mapCacheStore.buildingZctaIndex = merged;
        mapCacheStore.buildingTiersBaked = true;
        report(P.bake[1], 'Tier data baked');
        worker.terminate();
        resolve();
      } else if (m.type === 'ERROR') {
        worker.terminate();
        reject(new Error(m.message));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    // Send buffers as transferable
    const boroughs = BOROUGH_FGBS.map((b, i) => ({
      name: b.name, url: b.url, cacheKey: b.cacheKey, buf: rawBufs[i],
    }));
    const transferList = rawBufs.filter(b => b);
    const zctaFeaturesProps = zctaFeatures.map(f => ({
      MODZCTA: f.properties?.MODZCTA, _special: f.properties?._special,
    }));
    worker.postMessage(
      { type: 'PARSE_AND_BAKE', boroughs, precomputedTiers, zctaFeaturesProps },
      transferList
    );
  });
}

// ── FGB sub-pipeline (desktop fallback if worker fails) ──────────────────────

async function runFGBPipeline(zctaFeatures, precomputedTiers, P, onProgress) {
  const report = (pct, msg) => onProgress?.(pct, msg);

  // Build MODZCTA → ZCTA feature index lookup (O(1) per building — no PiP needed).
  // New borough FGBs have MODZCTA baked in per building feature.
  const zipToZctaIdx = {};
  for (let i = 0; i < zctaFeatures.length; i++) {
    const z = zctaFeatures[i].properties?.MODZCTA;
    if (z) zipToZctaIdx[String(z)] = i;
  }

  // Step 7: Fetch all borough FGBs in parallel (Cache API or network per borough)
  report(P.fgbFetch[0], 'Loading building data...');
  const rawBufs = await Promise.all(BOROUGH_FGBS.map(async (borough) => {
    if ('caches' in window) {
      try {
        const cache = await caches.open(FGB_CACHE_NAME);
        const cached = await cache.match(borough.cacheKey);
        if (cached) return new Uint8Array(await cached.arrayBuffer());
      } catch (e) { /* ignore */ }
    }
    const resp = await fetch(borough.url);
    if (!resp.ok) throw new Error(`FGB fetch failed for ${borough.name}: ${resp.status}`);
    const ab = await resp.arrayBuffer();
    if ('caches' in window) {
      try {
        const cache = await caches.open(FGB_CACHE_NAME);
        await cache.put(borough.cacheKey, new Response(ab.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
      } catch (e) { /* ignore */ }
    }
    return new Uint8Array(ab);
  }));
  report(P.fgbFetch[1], 'Building data cached');

  // Step 8: Parse all boroughs sequentially → merge into one FeatureCollection.
  // Stream each borough into mapCacheStore.buildingFGBStream as it's parsed so
  // MapView can incrementally setData while the rest still parses (Q6).
  report(P.fgbParse[0], 'Parsing building geometry...');
  const allFeatures = [];
  mapCacheStore.buildingFGBStream = []; // array of borough chunks; consumers append
  for (let bi = 0; bi < rawBufs.length; bi++) {
    const sub = await parseFGBBuffer(rawBufs[bi], count => {
      const approxPct = Math.round(((bi * 100000 + count) / (BOROUGH_FGBS.length * 100000)) * (P.fgbParse[1] - P.fgbParse[0]));
      report(Math.min(P.fgbParse[0] + approxPct, P.fgbParse[1] - 1), 'Parsing building geometry...');
    });
    // Safe large-array merge — spread push causes stack overflow on 200K+ arrays
    for (let _fi = 0; _fi < sub.features.length; _fi++) allFeatures.push(sub.features[_fi]);
    mapCacheStore.buildingFGBStream.push({ borough: BOROUGH_FGBS[bi].name, features: sub.features });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lapuff:fgb-borough-ready', { detail: { borough: BOROUGH_FGBS[bi].name, index: bi } }));
    }
    rawBufs[bi] = null; // release buffer after parse
  }
  const geojson = { type: 'FeatureCollection', features: allFeatures };
  mapCacheStore.buildingFGB = geojson;
  report(P.fgbParse[1], 'Building geometry parsed');

  // Step 9: Build ZCTA index from baked MODZCTA — O(n), near-instant.
  report(P.pip[0], 'Indexing buildings to zones...');
  const idxMap = new Int16Array(allFeatures.length);
  for (let i = 0; i < allFeatures.length; i++) {
    const z = allFeatures[i].properties?.MODZCTA;
    idxMap[i] = z ? (zipToZctaIdx[String(z)] ?? -1) : -1;
  }
  mapCacheStore.buildingZctaIndex = idxMap;
  report(P.pip[1], 'Buildings indexed');

  // Step 10: Bake all 5 tier columns into building properties
  report(P.bake[0], 'Baking tier data into buildings...');
  const span10 = P.bake[1] - P.bake[0];
  await bakeAllTiersIntoBuildingsData(geojson, idxMap, precomputedTiers, count => {
    report(Math.min(P.bake[0] + Math.round((count / allFeatures.length) * span10), P.bake[1]), 'Baking tier data...');
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
    tiers:     [67, 81],
    roadCache: [81, 83],
    waterCache:[83, 85],
  } : {
    zcta:      [0,  10],
    adj:       [10, 16],
    skel:      [16, 20],
    boro:      [20, 26],
    boroSkel:  [26, 30],
    tiers:     [30, 38],
    roadCache: [38, 40],
    waterCache:[40, 42],
    fgbFetch:  [42, 56],
    fgbParse:  [56, 72],
    pip:       [72, 80],
    bake:      [80, 93],
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

  // ── Step 2: Adjacency (use precomputed static JSON if present, else compute) ─
  report(P.adj[0], 'Computing adjacency graph...');
  await new Promise(r => setTimeout(r, 0));
  let adjacency = null;
  try {
    const r = await fetch('./data/zcta_adjacency.json', { cache: 'force-cache' });
    if (r.ok) {
      const json = await r.json();
      // Sanity check: must match feature count
      if (Array.isArray(json) && json.length === features.length) adjacency = json;
    }
  } catch (_e) { /* fall through to runtime compute */ }
  if (!adjacency) adjacency = buildAdjacency(features);
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
  // Fingerprint based on event count + most-recent event ID so a site reload with
  // new/changed events always forces a full recompute. Same tab session = fast restore.
  const eventFingerprint = `${(events || []).length}:${events?.[0]?.id ?? ''}:${events?.[events?.length - 1]?.id ?? ''}`;
  const TIERS_SS_KEY = 'lapuff_precomputed_tiers';
  const TIERS_FINGER_KEY = 'lapuff_precomputed_tiers_fp';
  let precomputedTiers = null;
  try {
    const storedFP = sessionStorage.getItem(TIERS_FINGER_KEY);
    if (storedFP === eventFingerprint) {
      const raw = sessionStorage.getItem(TIERS_SS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Object.keys(parsed).length === TIMESPAN_STEPS.length) {
          precomputedTiers = parsed;
        }
      }
    }
  } catch (_e) { /* sessionStorage unavailable — compute fresh */ }

  if (!precomputedTiers) {
    precomputedTiers = {};
    for (let idx = 0; idx < TIMESPAN_STEPS.length; idx++) {
      const { zipMap, maxCount } = buildZipEventMap(events || [], TIMESPAN_STEPS[idx].days);
      const tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
      precomputedTiers[idx] = { tiers, zipMap, maxCount };
      await new Promise(r => setTimeout(r, 0));
    }
    // Persist for remainder of this tab session (cleared on tab close / hard reload).
    try {
      sessionStorage.setItem(TIERS_SS_KEY, JSON.stringify(precomputedTiers));
      sessionStorage.setItem(TIERS_FINGER_KEY, eventFingerprint);
    } catch (_e) { /* quota exceeded or unavailable — skip */ }
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

// ── Road header pre-warm + full-file SW pre-cache ───────────────────────
  // SW receives PRECACHE_PMTILES → fetches full file once → serves Range slices in-memory.
  // Header pre-warm (Range bytes=0-16383) primes the PMTiles directory parser.
  report(P.roadCache[0], 'Pre-warming road tiles...');
  fetch(ROADS_PMTILES_URL, { headers: { Range: 'bytes=0-16383' } }).catch(() => {});
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_PMTILES', url: ROADS_PMTILES_URL });
  }
  report(P.roadCache[1], 'Road tiles ready');

  // ── Water static GeoJSON pre-cache ──────────────────────────────────────
  report(P.waterCache[0], 'Pre-warming water layer...');
  const WATER_STATIC_URL = (typeof window !== 'undefined')
    ? `${window.location.origin}${import.meta.env.BASE_URL}data/water_static.geojson`
    : '/data/water_static.geojson';
  fetch(WATER_STATIC_URL, { cache: 'force-cache' }).catch(() => {});
  report(P.waterCache[1], 'Water layer ready');

  // ── Satellite tile pre-cache (background, non-blocking) ──────────────────
  // Esri ArcGIS World Imagery tiles for NYC z10-13 (~500 tiles, ~20MB).
  // Browser HTTP cache stores them. Fire-and-forget — first satellite toggle is instant.
  precacheSatelliteTiles();

  // Load precomputed centroid binary (background) — saves PiP work on desktop and
  // makes mobile viewport bbox queries instant. Non-blocking; pipeline checks
  // mapCacheStore.buildingCentroids before falling back to runtime PiP.
  loadCentroidsBin().then(c => {
    if (c) {
      mapCacheStore.buildingCentroids = c.centroids;
      mapCacheStore.buildingCentroidsMeta = c.meta;
    }
  }).catch(() => {});

  // ── Steps 7-10: Desktop FGB building pipeline (borough-split spatial FGBs) ─
  // Skipped on mobile — buildings loaded JIT via spatial Range queries in 3rd Gear.
  // Skipped on 2nd+ load — building data is already in Cache API; MapView's
  // buildFGBCache effect loads it in background after the map is visible (saves ~3-4s).
  if (!isMobile && !isDoneFlag) {
    // NOTE (regression debug): worker path temporarily disabled while we trace why
    // building setData was not reaching the Real3D layers. Main-thread pipeline is
    // the proven baseline. To re-enable worker, set USE_FGB_WORKER=true.
    const USE_FGB_WORKER = true;
    if (USE_FGB_WORKER) {
      try {
        await runFGBPipelineWithWorker(geoData.features, precomputedTiers, P, onProgress);
      } catch (workerErr) {
        console.warn('[Pipeline] Worker FGB path failed, falling back to main thread:', workerErr?.message || workerErr);
        await runFGBPipeline(geoData.features, precomputedTiers, P, onProgress);
      }
    } else {
      await runFGBPipeline(geoData.features, precomputedTiers, P, onProgress);
    }
  }

  // Enforce minimum 1s display time on first load so user sees the loading screen
  const elapsed = Date.now() - startTime;
  if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));

  localStorage.setItem(MAP_CACHE_DONE_KEY, '1');
  localStorage.removeItem(MAP_CACHE_BUILDING_KEY);
}
