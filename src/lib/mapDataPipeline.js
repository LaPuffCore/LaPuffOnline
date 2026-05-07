// mapDataPipeline — pure data pipeline functions + Phase 2A executor.
// All geometry helpers are COPIED from MapView.jsx so this module can run
// independently inside MapLoadingScreen without importing the component.
// MapView.jsx retains its own copies so its render code is unchanged.

import mapCacheStore from './mapCacheStore';

// ── Constants ────────────────────────────────────────────────────────────────
export const GEOJSON_URL        = './data/MODZCTA_2010_WGS1984.geo.json';
export const BOROUGH_GEOJSON_URL = './data/borough.geo.json';
// v4: PMTiles buildings (no more FGB) — bumped to invalidate stale FGB IDB on existing clients
export const MAP_CACHE_DONE_KEY     = 'lapuff_map_cache_v4';
export const MAP_CACHE_BUILDING_KEY = 'lapuff_map_cache_building';

export const ROADS_PMTILES_URL = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/yGTOMC4N2uc1uIGkliFRgP51VbnPm96W8vebh_sOqeoGil3PErp8dvWmy74pEH70/n/idfnjqqb9g0p/b/nyc-map-data/o/realfinaldeciroads.pmtiles';

export const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];


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
  // 3-tier satellite precache (matches MapView sat-source-* layers):
  //   z9-z10  → ArcGIS World Imagery
  //   z11-z12 → Esri Wayback release 13045 (2018-01-18 timestamp-locked mosaic)
  //   z13-z15 → Clarity (high-res NYC mosaic — primary high-zoom quality tier)
  // NYC tight bbox only (no NJ/CT) — trades non-NYC outer-area coverage for z15 NYC z14/z15 coverage.
  // Tiles are stored in a dedicated SW Cache API cache (lapuff-satellite-v1) so they
  // persist across sessions (browser HTTP cache is volatile and gets evicted aggressively).
  const ARCGIS  = (z, y, x) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const WAYBACK = (z, y, x) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13045/${z}/${y}/${x}`;
  const CLARITY = (z, y, x) => `https://clarity.maptiles.arcgis.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const urls = [];
  const NYC = { lng1: -74.27, lat1: 40.47, lng2: -73.68, lat2: 40.93 };

  for (const z of [9, 10]) {
    const a = lngLatToTile(NYC.lng1, NYC.lat2, z), b = lngLatToTile(NYC.lng2, NYC.lat1, z);
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++)
        urls.push(ARCGIS(z, y, x));
  }
  for (const z of [11, 12]) {
    const a = lngLatToTile(NYC.lng1, NYC.lat2, z), b = lngLatToTile(NYC.lng2, NYC.lat1, z);
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++)
        urls.push(WAYBACK(z, y, x));
  }
  // Clarity z13–z14 only (Stage 7: balanced approach — z15/z16 left to pan-prefetch
  // by MapLibre on user interaction; reduces cache footprint by ~75% vs full z9–z16).
  for (const z of [13, 14]) {
    const a = lngLatToTile(NYC.lng1, NYC.lat2, z), b = lngLatToTile(NYC.lng2, NYC.lat1, z);
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++)
        urls.push(CLARITY(z, y, x));
  }

  // Balanced approach for both desktop and mobile: z9–z14 precache (per-platform tuning later).
  const finalUrls = urls;

  // Send to SW for cache.put (persists across sessions). SW handles parallel fetch with concurrency cap.
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_SATELLITE', urls: finalUrls });
    return;
  }
  // SW unavailable fallback: HTTP cache fire-and-forget.
  let active = 0, idx = 0;
  const MAX = 6;
  function next() {
    while (active < MAX && idx < finalUrls.length) {
      active++;
      const u = finalUrls[idx++];
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

// ── FGB pipeline removed ─────────────────────────────────────────────────────
// Buildings are now served via PMTiles (nyc_buildings_z12.pmtiles) directly by
// MapLibre's pmtiles:// protocol. No FGB parsing, no worker, no IDB hydrate.

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
  }
  localStorage.setItem(MAP_CACHE_BUILDING_KEY, '1');

  const startTime = Date.now();

  // Progress ranges per platform — recalibrated to actual step costs.
  // Heaviest steps: ZCTA fetch+parse, tier compute, satellite precache (background but accounted for).
  // Mobile: 11 steps total (2A: 0→85%, 2B: 85→100%) — mobile now also runs warmup sweep.
  // Desktop: 13 steps total (2A: 0→93%, 2B: 93→100%)
  const P = isMobile ? {
    zcta:      [0,  20],
    adj:       [20, 28],
    skel:      [28, 36],
    boro:      [36, 46],
    boroSkel:  [46, 54],
    tiers:     [54, 70],
    roadCache: [70, 73],
    waterCache:[73, 76],
    bldgCache: [76, 80],
    satCache:  [80, 85],
  } : {
    zcta:      [0,  12],
    adj:       [12, 18],
    skel:      [18, 24],
    boro:      [24, 32],
    boroSkel:  [32, 38],
    tiers:     [38, 58],
    roadCache: [58, 62],
    waterCache:[62, 65],
    bldgCache: [65, 72],
    satCache:  [72, 93],
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
  // Strong fingerprint: hash of sorted event IDs catches adds/removes/reorders.
  // Same tab session with identical events ⇒ instant restore from sessionStorage.
  let _h = 5381 ^ (events?.length || 0);
  const _ids = (events || []).map(e => String(e?.id ?? '')).sort();
  for (let _k = 0; _k < _ids.length; _k++) {
    const _s = _ids[_k];
    for (let _j = 0; _j < _s.length; _j++) _h = ((_h << 5) + _h) ^ _s.charCodeAt(_j);
  }
  const eventFingerprint = `${(events || []).length}:${(_h >>> 0).toString(36)}`;
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

  // ── Satellite tile pre-cache scheduled (background, non-blocking) ────────
  // Now uses SW Cache API (lapuff-satellite-v1) for cross-session persistence.
  // ArcGIS z9-z10 + Wayback z11-z12 + Clarity z13-z15 NYC bbox only (~45MB desktop, ~10MB mobile).
  // Fired at end of 2A so it doesn't block initial pipeline steps.
  // Note: dead loadCentroidsBin() call removed — building zip is baked into PMTiles features.

  // ── Buildings PMTiles: header pre-warm ONLY (no full-file precache) ──────
  // Stage 1 OOM fix: nyc_buildings_z12.pmtiles (~74MB) is NOT precached as a full file.
  // The SW slice path used to alloc a fresh 74MB ArrayBuffer per Range request → multi-GB
  // transient peak → desktop OOM. Buildings now flow through the per-Range cache exclusively
  // (lapuff-pmtiles-sw-v4) with an LRU cap (80MB) inside the SW. Header pre-warm primes the
  // PMTiles directory parser so first toggle is instant.
  report(P.bldgCache[0], 'Pre-warming building tiles...');
  const BUILDINGS_PMTILES_URL = (typeof window !== 'undefined')
    ? `${window.location.origin}${import.meta.env.BASE_URL}data/nyc_buildings_z12.pmtiles`
    : '/data/nyc_buildings_z12.pmtiles';
  fetch(BUILDINGS_PMTILES_URL, { headers: { Range: 'bytes=0-16383' } }).catch(() => {});
  // Intentionally NO PRECACHE_PMTILES post for buildings — that triggered the 74MB alloc storm.
  report(P.bldgCache[1], 'Building tiles ready');

  // ── Satellite SW precache (NYC bbox z9-z15) — last step, non-blocking ────
  report(P.satCache[0], 'Pre-warming satellite tiles...');
  precacheSatelliteTiles();
  report(P.satCache[1], 'Satellite tiles queued');

  // Enforce minimum 1s display time on first load so user sees the loading screen
  const elapsed = Date.now() - startTime;
  if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));

  localStorage.setItem(MAP_CACHE_DONE_KEY, '1');
  localStorage.removeItem(MAP_CACHE_BUILDING_KEY);
}
