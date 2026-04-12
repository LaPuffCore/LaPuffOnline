import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { generateAutoTags } from '../lib/autoTags';
import EventDetailPopup from './EventDetailPopup';
import MapIntro from './MapIntro';
import CRTEffect from './CRTEffect';
import { getZipColonists } from '../lib/pointsSystem';
import { pingNYCLocation, getLastLocation } from '../lib/locationService';

const GEOJSON_URL = './data/MODZCTA_2010_WGS1984.geo.json';
const BOROUGH_GEOJSON_URL = './data/borough.geo.json';
const MAPTILER_KEY = 'VjoJJ0mSCXFo9kFGYGxJ';

const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

// Fill colors slightly muted so the bright neon outline always reads brighter
const HEAT_COLORS = {
  cold:   '#00ccdd',
  cool:   '#00dd66',
  warm:   '#aadd00',
  orange: '#dd6600',
  hot:    '#cc0d00',
};

// Full-saturation neon for outlines — always visually dominant over fills
const OUTLINE_COLOR = '#ff2200';
const OUTLINE_GLOW  = '#ff0000';

// Darkened heatmap tier colors for upper 3D border and borough outlines.
// Distinct enough from the bright fill colors to read as "themed but different".
const HEAT_DARK_COLORS = {
  cold:   '#005566',
  cool:   '#006630',
  warm:   '#667700',
  orange: '#773300',
  hot:    '#660600',
};

// Tonal shades per tier (legacy, kept for compatibility)
const HEAT_TONES = {
  cold:   ['#003344', '#006688', '#00ccdd'],
  cool:   ['#003311', '#007733', '#00dd66'],
  warm:   ['#334400', '#778800', '#aadd00'],
  orange: ['#441100', '#882200', '#dd6600'],
  hot:    ['#440400', '#880800', '#cc0d00'],
};

// FIX REAL3D: 5 wide-range shades per heatmap tier for building cluster coloring.
// Neighbors get different shades (via featureId % 5). Range is light→dark for differentiation.
const HEAT_BUILDING_TONES = {
  cold:   ['#001824', '#003d5c', '#007a8c', '#00b8c8', '#a0eeff'],
  cool:   ['#001408', '#003d1c', '#007a38', '#00b854', '#a0ffb8'],
  warm:   ['#1a1400', '#4d3d00', '#8c7000', '#c8a000', '#ffe060'],
  orange: ['#1a0500', '#4d1200', '#8c3300', '#c86000', '#ff9040'],
  hot:    ['#1a0000', '#4d0000', '#8c0000', '#c80000', '#ff4040'],
};

function tierColor(tier) {
  if (tier >= 4) return HEAT_COLORS.hot;
  if (tier >= 3) return HEAT_COLORS.orange;
  if (tier >= 2) return HEAT_COLORS.warm;
  if (tier >= 1) return HEAT_COLORS.cool;
  return HEAT_COLORS.cold;
}

function darkTierColor(tier) {
  if (tier >= 4) return HEAT_DARK_COLORS.hot;
  if (tier >= 3) return HEAT_DARK_COLORS.orange;
  if (tier >= 2) return HEAT_DARK_COLORS.warm;
  if (tier >= 1) return HEAT_DARK_COLORS.cool;
  return HEAT_DARK_COLORS.cold;
}

function isSpecialZip(zip) {
  return !zip || zip === '' || zip === '99999' || parseInt(zip) > 11697;
}

function buildZipEventMap(events, days) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const maxDate = new Date(now.getTime() + days * 86400000);
  const zipMap = {};
  events.forEach(e => {
    // Auto-scraped events do NOT affect heatmap — only user-submitted events count
    if (e._auto || e._sample) return;
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

function lngLatToMeters([lng, lat], refLat) {
  const latRad = refLat * Math.PI / 180;
  const metersPerDegLat = 111132;
  const metersPerDegLng = 111320 * Math.cos(latRad);
  return [lng * metersPerDegLng, lat * metersPerDegLat];
}

function metersToLngLat([x, y], refLat) {
  const latRad = refLat * Math.PI / 180;
  const metersPerDegLat = 111132;
  const metersPerDegLng = 111320 * Math.cos(latRad);
  return [x / metersPerDegLng, y / metersPerDegLat];
}

function normalize([x, y]) {
  const len = Math.hypot(x, y);
  return len === 0 ? [0, 0] : [x / len, y / len];
}

function lineIntersection(p0, p1, q0, q1) {
  const s1x = p1[0] - p0[0];
  const s1y = p1[1] - p0[1];
  const s2x = q1[0] - q0[0];
  const s2y = q1[1] - q0[1];
  const denom = (-s2x * s1y + s1x * s2y);
  if (Math.abs(denom) < 1e-9) return null;
  const s = (-s1y * (p0[0] - q0[0]) + s1x * (p0[1] - q0[1])) / denom;
  return [q0[0] + (s * s2x), q0[1] + (s * s2y)];
}

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
  for (let i = 1; i < ring.length; i += 1) {
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
  // T4 FIX: threshold was 1e-8, which collapsed valid coastal curvature vertices
  // (pier-edge cross products are ~1e-10). Use 1e-12 to preserve all real geometry.
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(cross) < 1e-12;
}

function simplifyRing(ring) {
  if (ring.length < 4) return ring;
  const simplified = [ring[0]];
  for (let i = 1; i < ring.length - 1; i += 1) {
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
  for (let i = 0; i < segments; i += 1) {
    const current = closed[i];
    const next = closed[i + 1];
    subdivided.push(current);
    for (let step = 1; step <= insertCount; step += 1) {
      const t = step / (insertCount + 1);
      subdivided.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
      ]);
    }
  }
  return closeRing(subdivided);
}

function smoothRing(ring, passes = 1) {
  let current = closeRing(ring).slice(0, -1);
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length < 3) break;
    const next = [];
    for (let i = 0; i < current.length; i += 1) {
      const p = current[i];
      const q = current[(i + 1) % current.length];
      next.push([
        p[0] * 0.75 + q[0] * 0.25,
        p[1] * 0.75 + q[1] * 0.25,
      ]);
      next.push([
        p[0] * 0.25 + q[0] * 0.75,
        p[1] * 0.25 + q[1] * 0.75,
      ]);
    }
    current = next;
  }
  return closeRing(current);
}

function closeRing(ring) {
  return ring.length === 0 || (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
    ? ring
    : [...ring, ring[0]];
}

function normalizeRing(ring) {
  const closed = closeRing(ring);
  const deduped = dedupeRing(closed);
  if (deduped.length < 4) return null;
  return closeRing(simplifyRing(deduped));
}

function normalizePolygonCoords(coords) {
  const normalized = coords
    .map(normalizeRing)
    .filter(ring => ring && ring.length >= 4);
  return normalized.map(ring => {
    const closed = closeRing(ring);
    return closed && closed.length >= 4 ? closed : null;
  }).filter(Boolean);
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

// T3 3D PIXELIZATION: Zoom + pitch aware width scaling.
// Our map is locked minZoom:9 (max zoom-out, all of NYC) to maxZoom:16 (street level).
// Base width applies at zoom 13+ (close-in). Quadratic ramp kicks in as we zoom out:
// zoom 13: +0m | 12: +5m | 11: +20m | 10: +45m | 9: +80m | (8: +125m, 7: +180m safety)
// The steps anchor at 13 so mid-zoom stays gentle, then accelerates toward zoom 9.
// pitchFactor boosts width at tilt — compensates horizontal compression on far-field geometry.
function getZoomAwareOutlineWidth(map, baseMeters = 14) {
  if (!map || typeof map.getZoom !== 'function') return baseMeters;
  const zoom = map.getZoom();
  const steps = Math.max(0, 13 - zoom);
  const extra = steps * steps * 5; // quadratic: 0,5,20,45,80,125,180 for steps 0-6
  const pitch = map.getPitch ? map.getPitch() : 0;
  const pitchFactor = 1 + (pitch / 90) * 0.55;
  return (baseMeters + extra) * pitchFactor;
}

function offsetRing(outerRing, widthMeters) {
  const normalized = normalizeRing(outerRing);
  if (!normalized || normalized.length < 4) return null;
  let ring = normalized[0][0] === normalized[normalized.length - 1][0] && normalized[0][1] === normalized[normalized.length - 1][1]
    ? normalized.slice(0, -1)
    : normalized;
  if (ring.length < 3) return null;

  ring = subdivideRing(ring, 10);
  const smoothPasses = Math.min(2, Math.max(1, Math.floor(widthMeters / 24)));
  ring = smoothRing(ring, smoothPasses);

  const refLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const pts = ring.map(coord => lngLatToMeters(coord, refLat));
  const orientation = signedArea([...pts, pts[0]]) >= 0 ? 1 : -1;
  const halfWidth = widthMeters / 2;

  const normals = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    const dx = next[0] - p[0];
    const dy = next[1] - p[1];
    return normalize(orientation > 0 ? [dy, -dx] : [-dy, dx]);
  });

  const outerEdges = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    const norm = normals[i];
    return {
      p0: [p[0] + norm[0] * halfWidth, p[1] + norm[1] * halfWidth],
      p1: [next[0] + norm[0] * halfWidth, next[1] + norm[1] * halfWidth],
    };
  });
  const innerEdges = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    const norm = normals[i];
    return {
      p0: [p[0] - norm[0] * halfWidth, p[1] - norm[1] * halfWidth],
      p1: [next[0] - norm[0] * halfWidth, next[1] - norm[1] * halfWidth],
    };
  });

  const outer = pts.map((_, i) => {
    const prev = outerEdges[(i - 1 + outerEdges.length) % outerEdges.length];
    const curr = outerEdges[i];
    const intersection = lineIntersection(prev.p0, prev.p1, curr.p0, curr.p1);
    if (intersection) return intersection;
    const avg = normalize([normals[(i - 1 + normals.length) % normals.length][0] + normals[i][0], normals[(i - 1 + normals.length) % normals.length][1] + normals[i][1]]);
    return [pts[i][0] + avg[0] * halfWidth, pts[i][1] + avg[1] * halfWidth];
  });

  const inner = pts.map((_, i) => {
    const prev = innerEdges[(i - 1 + innerEdges.length) % innerEdges.length];
    const curr = innerEdges[i];
    const intersection = lineIntersection(prev.p0, prev.p1, curr.p0, curr.p1);
    if (intersection) return intersection;
    const avg = normalize([normals[(i - 1 + normals.length) % normals.length][0] + normals[i][0], normals[(i - 1 + normals.length) % normals.length][1] + normals[i][1]]);
    return [pts[i][0] - avg[0] * halfWidth, pts[i][1] - avg[1] * halfWidth];
  });

  const outerGeo = closeRing(outer).map(coord => metersToLngLat(coord, refLat));
  const innerGeo = closeRing(inner.reverse()).map(coord => metersToLngLat(coord, refLat));

  if (outerGeo.length < 8 || innerGeo.length < 8) return null;

  return [outerGeo, innerGeo];
}

// Extract inner rings from an outline GeoJSON (annular ring polygons) as standalone fill polygons.
// Each annular ring has coordinates[0]=outerRing and coordinates[1]=innerRing(hole).
// The inner ring, reversed to CCW winding, defines the "inside" face of the upper 3D border.
// This is used as the zcta-cap source — giving the cap the shape of the inner boundary of
// the upper 3D outline extrusion, NOT the zip block's own top face.
function createCapGeoJSON(outlineGeoJSON) {
  return {
    type: 'FeatureCollection',
    features: outlineGeoJSON.features.map(feature => {
      const geom = feature.geometry;
      if (geom.type === 'Polygon') {
        if (geom.coordinates.length < 2) return null;
        // coordinates[1] = inner ring (CW hole) — reverse to CCW for outer ring
        const innerRing = geom.coordinates[1].slice().reverse();
        if (innerRing.length < 4) return null;
        return { ...feature, geometry: { type: 'Polygon', coordinates: [innerRing] } };
      }
      if (geom.type === 'MultiPolygon') {
        const polys = geom.coordinates
          .filter(p => p.length >= 2)
          .map(p => {
            const innerRing = p[1].slice().reverse();
            return innerRing.length >= 4 ? [innerRing] : null;
          })
          .filter(Boolean);
        if (polys.length === 0) return null;
        return { ...feature, geometry: { type: 'MultiPolygon', coordinates: polys } };
      }
      return null;
    }).filter(Boolean),
  };
}

function createOutlineGeoJSON(sourceGeoJSON, widthMeters = 12) {
  return {
    type: 'FeatureCollection',
    features: sourceGeoJSON.features.map(feature => {
      const normalizedGeom = normalizeFeatureGeometry(feature) || feature.geometry;
      if (!normalizedGeom) return null;
      if (normalizedGeom.type === 'Polygon') {
        const outline = offsetRing(normalizedGeom.coordinates[0], widthMeters);
        if (!outline) return null;
        return { ...feature, geometry: { type: 'Polygon', coordinates: outline } };
      }
      if (normalizedGeom.type === 'MultiPolygon') {
        const polygons = [];
        normalizedGeom.coordinates.forEach(polygon => {
          const outline = offsetRing(polygon[0], widthMeters);
          if (outline) polygons.push(outline);
        });
        if (polygons.length === 0) return null;
        return { ...feature, geometry: { type: 'MultiPolygon', coordinates: polygons } };
      }
      return null;
    }).filter(Boolean),
  };
}

function darkMapStyle() {
  return { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d0000' } }] };
}
function satelliteMapStyle() {
  return { version: 8, sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 } }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] };
}

// FIX REAL3D: Point-in-polygon (ray casting) for building→zip spatial assignment
function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Centroid of first ring (fast approximation for placement)
function getGeomCentroid(geometry) {
  const ring = geometry.type === 'MultiPolygon'
    ? geometry.coordinates[0][0]
    : geometry.coordinates[0];
  if (!ring || ring.length === 0) return [0, 0];
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  return [sx / ring.length, sy / ring.length];
}

// Find which zcta tier a point falls in (returns 0 if not found / special)
function findTierForPoint([px, py], features, tiers) {
  for (let i = 0; i < features.length; i++) {
    if (features[i].properties._special) continue;
    const geom = features[i].geometry;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polys) {
      if (pointInRing(px, py, poly[0])) return Math.max(0, tiers[i]);
    }
  }
  return 0;
}

// Map each ZCTA feature index → borough feature index via centroid PiP.
// Called once when both geoData and boroughGeoData are loaded.
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

// Compute average tier per borough (rounded). Returns array indexed by borough feature index.
function computeBoroughAvgTiers(tiers, zipBoroughMap, boroughCount) {
  const sums = new Array(boroughCount).fill(0);
  const counts = new Array(boroughCount).fill(0);
  Object.entries(zipBoroughMap).forEach(([idx, bi]) => {
    const tier = tiers[parseInt(idx)];
    if (tier >= 0) { sums[bi] += tier; counts[bi]++; }
  });
  return sums.map((s, i) => counts[i] > 0 ? Math.round(s / counts[i]) : 0);
}

// Inject a _color property onto each borough feature based on heatmap state + avg tier.
function buildColoredBoroughFeatures(boroughGeoData, avgTiers, isHeatmap) {
  return {
    ...boroughGeoData,
    features: boroughGeoData.features.map((f, i) => ({
      ...f,
      properties: {
        ...f.properties,
        _color: isHeatmap ? darkTierColor(avgTiers[i] ?? 0) : OUTLINE_COLOR,
      },
    })),
  };
}

const MEDALS = ['🥇', '🥈', '🥉'];
const PAGE_SIZE = 6;

// ── Paginated list section ─────────────────────────────────────────────
function PaginatedSection({ items, renderItem, emptyMsg, headerLabel, headerColor = 'text-white/30' }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const visible = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return (
    <div className="flex flex-col min-h-0">
      <p className={`px-4 py-2 text-xs font-black uppercase tracking-widest sticky top-0 bg-gray-950/90 flex-shrink-0 ${headerColor}`}>{headerLabel}</p>
      {items.length === 0
        ? <p className="px-4 py-6 text-white/20 text-sm text-center">{emptyMsg}</p>
        : visible.map((item, i) => renderItem(item, page * PAGE_SIZE + i))
      }
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/10 flex-shrink-0">
          <span className="text-white/20 text-[10px] font-black">{page + 1} / {totalPages}</span>
          <div className="flex gap-2">
            {page > 0 && <button onClick={() => setPage(p => p - 1)} className="text-white/40 hover:text-white text-xs font-black px-2 py-0.5 rounded hover:bg-white/10">▲</button>}
            {page < totalPages - 1 && <button onClick={() => setPage(p => p + 1)} className="text-white/40 hover:text-white text-xs font-black px-2 py-0.5 rounded hover:bg-white/10">▼</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ZipHologram desktop ───────────────────────────────────────────────────────
function ZipHologram({ feature, color, onClose }) {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const timeRef   = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const allRings = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates.flat(1) : feature.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }));
    const geoW = maxX - minX, geoH = maxY - minY, padding = 0.15;
    const scale = Math.min(W * (1 - padding * 2) / geoW, H * (1 - padding * 2) / geoH);
    const offX = W / 2 - (minX + geoW / 2) * scale;
    const offY = H / 2 + (minY + geoH / 2) * scale;
    function project(lng, lat) { return [lng * scale + offX, -lat * scale + offY]; }
    function drawShape(dx, dy, alpha, strokeOnly) {
      ctx.save(); ctx.translate(dx, dy);
      allRings.forEach(ring => {
        ctx.beginPath();
        ring.forEach(([x, y], i) => { const [px, py] = project(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        ctx.closePath();
        if (!strokeOnly) { ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0'); ctx.fill(); }
        ctx.strokeStyle = color; ctx.lineWidth = strokeOnly ? 1.5 : 2; ctx.globalAlpha = alpha; ctx.stroke();
      });
      ctx.restore();
    }
    function frame() {
      timeRef.current += 0.018;
      const t = timeRef.current, rotY = Math.sin(t) * 0.35;
      ctx.clearRect(0, 0, W, H);
      const depth = 18;
      for (let d = depth; d >= 0; d--) drawShape(Math.sin(rotY) * d * 1.8, -d * 0.7, 0.08 + (1 - d / depth) * 0.18, d > 0);
      const ts = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1; drawShape(ts, -depth * 0.7, 0.55, false);
      if (Math.random() < 0.04) { for (let g = 0; g < Math.floor(Math.random() * 5) + 2; g++) { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.fillRect((Math.random() - 0.5) * 20, Math.random() * H, W, Math.random() * 6 + 2); ctx.restore(); } }
      ctx.save(); ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2; ctx.shadowColor = color; ctx.shadowBlur = 20; drawShape(ts, -depth * 0.7, 0.9, true); ctx.restore();
      if (Math.sin(t * 7) > 0.92) { ctx.fillStyle = color + '22'; ctx.fillRect(0, 0, W, H); }
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color]);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const zipLabel = feature?.properties?.MODZCTA;
  return (
    <div className="absolute z-40 pointer-events-none" style={{ left: 0, right: 400, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} />
      <div className="relative pointer-events-auto flex flex-col items-center" style={{ width: 480, maxWidth: '90%', zIndex: 1 }}>
        <div className="flex items-center justify-between w-full mb-3 px-1">
          <div style={{ color, textShadow: `0 0 12px ${color}` }} className="font-black text-lg tracking-widest uppercase">ZIP {zipLabel} — ISOLATED</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full border-2 font-black text-sm flex items-center justify-center hover:bg-white/20" style={{ borderColor: color, color }}>✕</button>
        </div>
        <canvas ref={canvasRef} width={460} height={340} style={{ width: '100%', height: 340, borderRadius: 18, border: `2px solid ${color}`, boxShadow: `0 0 40px ${color}66, 0 0 80px ${color}33`, background: '#000000cc' }} />
        <div className="absolute pointer-events-none" style={{ top: 44, left: 0, right: 0, height: 340, background: 'repeating-linear-gradient(transparent, transparent 3px, rgba(0,0,0,0.25) 3px, rgba(0,0,0,0.25) 4px)', borderRadius: 18 }} />
        <div className="mt-3 text-xs font-black tracking-widest opacity-50 uppercase" style={{ color }}>◈ Holographic Extrusion Mode ◈</div>
      </div>
    </div>
  );
}

// ── ZipHologramMobile — constrained to top 50% of MapView container ─────
function ZipHologramMobile({ feature, color, onClose }) {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const timeRef   = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const allRings = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates.flat(1) : feature.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }));
    const geoW = maxX - minX, geoH = maxY - minY, padding = 0.15;
    const scale = Math.min(W * (1 - padding * 2) / geoW, H * (1 - padding * 2) / geoH);
    const offX = W / 2 - (minX + geoW / 2) * scale;
    const offY = H / 2 + (minY + geoH / 2) * scale;
    function project(lng, lat) { return [lng * scale + offX, -lat * scale + offY]; }
    function drawShape(dx, dy, alpha, strokeOnly) {
      ctx.save(); ctx.translate(dx, dy);
      allRings.forEach(ring => {
        ctx.beginPath();
        ring.forEach(([x, y], i) => { const [px, py] = project(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        ctx.closePath();
        if (!strokeOnly) { ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0'); ctx.fill(); }
        ctx.strokeStyle = color; ctx.lineWidth = strokeOnly ? 1.5 : 2; ctx.globalAlpha = alpha; ctx.stroke();
      });
      ctx.restore();
    }
    function frame() {
      timeRef.current += 0.018;
      const t = timeRef.current, rotY = Math.sin(t) * 0.35;
      ctx.clearRect(0, 0, W, H);
      const depth = 14;
      for (let d = depth; d >= 0; d--) drawShape(Math.sin(rotY) * d * 1.8, -d * 0.7, 0.08 + (1 - d / depth) * 0.18, d > 0);
      const ts = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1; drawShape(ts, -depth * 0.7, 0.55, false);
      if (Math.random() < 0.04) { for (let g = 0; g < 3; g++) { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.fillRect((Math.random() - 0.5) * 20, Math.random() * H, W, Math.random() * 6 + 2); ctx.restore(); } }
      ctx.save(); ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2; ctx.shadowColor = color; ctx.shadowBlur = 20; drawShape(ts, -depth * 0.7, 0.9, true); ctx.restore();
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color]);

  const zipLabel = feature?.properties?.MODZCTA;
  return (
    <div className="absolute inset-x-0 top-0 z-40 flex flex-col" style={{ height: '50%', background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)' }}>
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
        <div style={{ color, textShadow: `0 0 12px ${color}` }} className="font-black text-sm tracking-widest uppercase">ZIP {zipLabel} — ISOLATED</div>
        <button onClick={onClose} className="w-8 h-8 rounded-full border font-black text-xs flex items-center justify-center hover:bg-white/20" style={{ borderColor: color, color }}>✕</button>
      </div>
      <canvas ref={canvasRef} width={400} height={260} style={{ width: '100%', flex: 1, minHeight: 0, borderTop: `1px solid ${color}44`, background: '#000000bb' }} />
      <div className="text-center py-1 text-[10px] font-black tracking-widest opacity-40 uppercase flex-shrink-0" style={{ color }}>◈ Hologram ◈</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MapView({ events }) {
  const containerRef    = useRef(null);
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const hoveredIdRef    = useRef(null);
  const locationMarkerRef = useRef(null);
  const heatmapRef      = useRef(false);
  const threeDRef       = useRef(false);
  const tiersRef        = useRef([]);
  const geoDataRef      = useRef(null);
  const layerHandlersRef = useRef({ handleZctaHover: null, handleZctaLeave: null, handleZctaClick: null });
  // FIX ADDITIVE STATE: refs for satellite and real3D for use in async callbacks
  const real3DRef       = useRef(false);
  const satelliteRef    = useRef(false);
  // FIX REAL3D: store computed withHeat GeoJSON for zoom-based outline re-generation
  const withHeatRef     = useRef(null);
  // FIX REAL3D: cleanup handle for building tier assignment event listeners
  const buildingAssignCleanupRef = useRef(null);
  // Borough outline refs
  const boroughGeoDataRef  = useRef(null);
  const zipBoroughMapRef   = useRef({});
  const boroughWithColorRef = useRef(null);

  const [timespanIdx,   setTimespanIdx]   = useState(4);
  const [heatmap,       setHeatmap]       = useState(false);
  const [satellite,     setSatellite]     = useState(false);
  const [threeD,        setThreeD]        = useState(false);
  const [real3D,        setReal3D]        = useState(false);
  const [geoData,       setGeoData]       = useState(null);
  const [boroughGeoData, setBoroughGeoData] = useState(null);
  const [adjacency,     setAdjacency]     = useState([]);
  const [mapReady,      setMapReady]      = useState(false);
  const [entered,       setEntered]       = useState(false);
  const [hoveredZip,    setHoveredZip]    = useState(null);
  const [hoveredEvents, setHoveredEvents] = useState([]);
  const [hoveredColonists, setHoveredColonists] = useState(null);
  const [tooltipPos,    setTooltipPos]    = useState(null);
  const [sideZip,       setSideZip]       = useState(null);
  const [sideEvents,    setSideEvents]    = useState([]);
  const [sideColonists, setSideColonists] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [userLocation,  setUserLocation]  = useState(getLastLocation());
  const [notInNYC,      setNotInNYC]      = useState(false);
  const [locLoading,    setLocLoading]    = useState(false);
  const [holoFeature,   setHoloFeature]   = useState(null);
  const [holoColor,     setHoloColor]     = useState(HEAT_COLORS.cold);
  const [isMobile,      setIsMobile]      = useState(false);
  const [isOffline,     setIsOffline]     = useState(() => !navigator.onLine);
  const [connectionNotice, setConnectionNotice] = useState('');
  // FIX ADDITIVE STATE: bump this after style swap so the main heatmap effect
  // re-runs and re-applies all paint properties to the freshly added layers.
  const [styleVersion,  setStyleVersion]  = useState(0);

  heatmapRef.current   = heatmap;
  threeDRef.current    = threeD;
  real3DRef.current    = real3D;
  satelliteRef.current = satellite;
  geoDataRef.current   = geoData;
  boroughGeoDataRef.current = boroughGeoData;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setIsOffline(false);
      setConnectionNotice('');
    };
    const onOffline = () => {
      setIsOffline(true);
      // 3D features require live map/tile connection.
      setThreeD(false);
      setReal3D(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // GeoJSON
  useEffect(() => {
    fetch(GEOJSON_URL).then(r => r.json()).then(data => {
      const features = data.features.map((f, i) => {
        let zip = String(f.properties.MODZCTA || f.properties.modzcta || '');
        if (isSpecialZip(zip)) f = { ...f, properties: { ...f.properties, MODZCTA: 'SAFEZONE', _special: true } };
        return { ...f, id: i };
      });
      setGeoData({ ...data, features });
      setAdjacency(buildAdjacency(features));
    });
  }, []);

  // Borough GeoJSON — load once
  useEffect(() => {
    fetch(BOROUGH_GEOJSON_URL).then(r => r.json()).then(data => {
      setBoroughGeoData(data);
    }).catch(err => console.warn('Borough GeoJSON load failed:', err));
  }, []);

  // Compute zip→borough mapping once both datasets are ready
  useEffect(() => {
    if (!geoData || !boroughGeoData) return;
    zipBoroughMapRef.current = computeZipBoroughMap(geoData.features, boroughGeoData.features);
  }, [geoData, boroughGeoData]);

  // Map init — make canvas background transparent so CRT can show on edges
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: darkMapStyle(),
      center: [-73.94, 40.71],
      zoom: 10.5,
      minZoom: 9,
      maxZoom: 16,
      maxBounds: [[-75.5, 40.0], [-72.5, 41.5]],
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;
    map.on('load', () => {
      map.getCanvas().style.backgroundColor = 'transparent';
      setMapReady(true);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Layer setup ────────────────────────────────────────────────────────────
  function addLayers(map, data, sat) {
    if (!map || !data || map.getSource('zcta')) return;
    // Read current 3D state so initial paint values are correct even on re-add (satellite swap)
    const is3D = threeDRef.current;
    map.addSource('zcta', { type: 'geojson', data, generateId: false });

    // Extrusion base — fully opaque, blocks everything below
    map.addLayer({
      id: 'zcta-extrude', type: 'fill-extrusion', source: 'zcta',
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['get', '_special'], false], '#222222', '#1a0505'],
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0,
      },
    });

    // Flat fill — slightly transparent dark red to differentiate regions from bg without solid fill
    map.addLayer({
      id: 'zcta-fill', type: 'fill', source: 'zcta',
      paint: {
        'fill-color': ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505'],
        'fill-opacity': sat ? 0.38 : 0.55,
      },
    });

    // Hover — electric purple (2D fill overlay)
    map.addLayer({
      id: 'zcta-hover', type: 'fill', source: 'zcta',
      paint: { 'fill-color': '#7C3AED', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.5, 0] },
    });

    // Cap — invisible flat slab shaped like the INNER ring of the zcta-outline annular ring.
    // NOT the zip block top face — slightly inset, matching the inner boundary of the upper 3D border.
    // In 3D mode: glows purple on hover, visually bridging the gap between the border extrusion
    // and the underlying zip block extrusion. Heights set dynamically to match zcta-extrude.
    map.addLayer({
      id: 'zcta-cap', type: 'fill-extrusion', source: 'zcta-cap-source',
      paint: {
        'fill-extrusion-color': '#9F67FF',
        'fill-extrusion-height': 1,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,
        'fill-extrusion-vertical-gradient': false,
      },
    });

    // Safe zone outline — hidden in 3D mode
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': 2, 'line-opacity': is3D ? 0 : 1 },
    });

    // Ground boundary glows (non-special) — hidden in 3D mode
    map.addLayer({
      id: 'zcta-line-glow2', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_GLOW, 'line-width': 3, 'line-opacity': is3D ? 0 : (sat ? 0.25 : 0.35), 'line-blur': 10 },
    });
    map.addLayer({
      id: 'zcta-line-glow', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_COLOR, 'line-width': 1, 'line-opacity': is3D ? 0 : (sat ? 0.55 : 0.75), 'line-blur': 3 },
    });
    map.addLayer({
      id: 'zcta-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_COLOR, 'line-width': 0.5, 'line-opacity': is3D ? 0 : 1 },
    });

    map.addSource('zcta-outline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: false });
    // Cap source: inner-ring polygons of the zcta-outline annular rings.
    // Shape = the inward face of the upper 3D border, NOT the zip block top face.
    map.addSource('zcta-cap-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: false });
    map.addLayer({
      id: 'zcta-outline', type: 'fill-extrusion', source: 'zcta-outline',
      paint: {
        'fill-extrusion-color': OUTLINE_COLOR,
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,
        'fill-extrusion-vertical-gradient': false,
      },
    });
    map.addLayer({
      id: 'zcta-outline-line', type: 'line', source: 'zcta-outline',
      paint: {
        'line-color': OUTLINE_COLOR,
        'line-width': 1.5,
        'line-opacity': 0,
        'line-blur': 0.5,
      },
    });

    // Borough outline — fill-extrusion annular rings at 22m height (below cold tier 30m).
    // Base outline width uses baseMeters=40 so outer perimeter is prominent.
    // Only visible at the outer NYC perimeter; zip blocks occlude internal borough borders.
    // Color is data-driven via _color property set on each feature before source update.
    if (!map.getSource('borough-source')) {
      map.addSource('borough-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: false });
      map.addLayer({
        id: 'borough-outline', type: 'fill-extrusion', source: 'borough-source',
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', '_color'], OUTLINE_COLOR],
          'fill-extrusion-height': 22,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0,
          'fill-extrusion-vertical-gradient': false,
        },
      });
    }
    const handleZctaHover = e => {
      if (!e.features.length) return;
      const f = e.features[0];
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== f.id) {
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
        if (map.getSource('zcta-cap-source')) map.setFeatureState({ source: 'zcta-cap-source', id: hoveredIdRef.current }, { hovered: false });
      }
      hoveredIdRef.current = f.id;
      map.setFeatureState({ source: 'zcta', id: f.id }, { hovered: true });
      if (map.getSource('zcta-cap-source')) map.setFeatureState({ source: 'zcta-cap-source', id: f.id }, { hovered: true });
      map.getCanvas().style.cursor = 'pointer';
      setHoveredZip(String(f.properties.MODZCTA || ''));
      setTooltipPos({ x: e.point.x, y: e.point.y });
    };

    const handleZctaLeave = () => {
      if (hoveredIdRef.current !== null) {
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
        if (map.getSource('zcta-cap-source')) map.setFeatureState({ source: 'zcta-cap-source', id: hoveredIdRef.current }, { hovered: false });
        hoveredIdRef.current = null;
      }
      map.getCanvas().style.cursor = '';
      setHoveredZip(null); setTooltipPos(null);
    };

    const handleZctaClick = e => {
      if (!e.features.length) return;
      openSidePanel(String(e.features[0].properties.MODZCTA || ''));
      openHologram(e.features[0]);
    };

    layerHandlersRef.current = { handleZctaHover, handleZctaLeave, handleZctaClick };

    map.on('mousemove', 'zcta-fill', handleZctaHover);
    map.on('mouseleave', 'zcta-fill', handleZctaLeave);
    map.on('click', 'zcta-fill', handleZctaClick);
  }

  function openHologram(clickedFeature) {
    const data = geoDataRef.current;
    if (!data) return;
    const feat = data.features.find(f => f.id === clickedFeature.id) || clickedFeature;
    const idx = data.features.findIndex(f => f.id === clickedFeature.id);
    const tier = tiersRef.current[idx] ?? 0;
    setHoloFeature(feat);
    setHoloColor(tier < 0 ? '#888888' : tierColor(tier));
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData) return;
    addLayers(map, geoData, satellite);
  }, [mapReady, geoData]);

  // Manage hover layer based on 3D state — switch from fill to extrude when 3D is on
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer('zcta-fill')) return;
    
    const { handleZctaHover, handleZctaLeave, handleZctaClick } = layerHandlersRef.current;
    if (!handleZctaHover) return;

    if (threeD) {
      map.off('mousemove', 'zcta-fill', handleZctaHover);
      map.off('mouseleave', 'zcta-fill', handleZctaLeave);
      map.off('click', 'zcta-fill', handleZctaClick);
      
      map.on('mousemove', 'zcta-extrude', handleZctaHover);
      map.on('mouseleave', 'zcta-extrude', handleZctaLeave);
      map.on('click', 'zcta-extrude', handleZctaClick);
    } else {
      map.off('mousemove', 'zcta-extrude', handleZctaHover);
      map.off('mouseleave', 'zcta-extrude', handleZctaLeave);
      map.off('click', 'zcta-extrude', handleZctaClick);
      
      map.on('mousemove', 'zcta-fill', handleZctaHover);
      map.on('mouseleave', 'zcta-fill', handleZctaLeave);
      map.on('click', 'zcta-fill', handleZctaClick);
    }
  }, [threeD, mapReady]);

  // ── Main heatmap + 3D update ──────────────────────────────────────────────
  // FIX ADDITIVE STATE: added `styleVersion` and `real3D` to deps so this re-runs
  // after satellite style swap (which increments styleVersion) and after real3D changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData || !map.getLayer('zcta-fill')) return;

    const { zipMap, maxCount } = buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days);
    const tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
    tiersRef.current = tiers;

    const withHeat = {
      ...geoData,
      features: geoData.features.map((f, i) => {
        const tier = tiers[i];
        const zip = String(f.properties.MODZCTA || '');
        const rawHeat = f.properties._special ? 0 : normalizeHeat(zipMap[zip]?.length || 0, maxCount);
        return { ...f, properties: { ...f.properties, _heat: rawHeat, _tier: tier < 0 ? 0 : tier } };
      }),
    };
    if (map.getSource('zcta')) map.getSource('zcta').setData(withHeat);
    // FIX REAL3D: store so zoom listener can regenerate outline width without full recompute
    withHeatRef.current = withHeat;
    if (map.getSource('zcta-outline')) {
      const outlineData = createOutlineGeoJSON(withHeat, getZoomAwareOutlineWidth(map));
      map.getSource('zcta-outline').setData(outlineData);
      if (map.getSource('zcta-cap-source')) map.getSource('zcta-cap-source').setData(createCapGeoJSON(outlineData));
    }

    const heatColorExpr = [
      'case', ['boolean', ['get', '_special'], false], '#ffffff',
      ['step', ['get', '_tier'], HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm, 3, HEAT_COLORS.orange, 4, HEAT_COLORS.hot],
    ];

    // Wrap color expression with hover state check for 3D mode
    const withHoverColor = (baseExpr) => {
      return ['case', ['boolean', ['feature-state', 'hovered'], false], '#7C3AED', baseExpr];
    };

    // Height expressions — heatmap 3D
    const extrudeH = ['case', ['boolean', ['get', '_special'], false], 30, ['step', ['get', '_tier'], 30, 1, 200, 2, 700, 3, 1600, 4, 2800]];
    // Cap sits 1m above the block top — same tiers +1
    const extrudeHCap = ['case', ['boolean', ['get', '_special'], false], 31, ['step', ['get', '_tier'], 31, 1, 201, 2, 701, 3, 1601, 4, 2801]];
    // Flat 3D
    const flatH    = ['case', ['boolean', ['get', '_special'], false], 30, 400];
    const flatHCap = ['case', ['boolean', ['get', '_special'], false], 31, 401];
    // Cap opacity expression — visible (glow purple) only on hover in 3D mode
    const capHoverOpacity = ['case', ['boolean', ['feature-state', 'hovered'], false], 0.72, 0];

    if (heatmap) {
      map.setPaintProperty('zcta-fill', 'fill-color', heatColorExpr);
      // FIX ADDITIVE STATE: heatmap fill — 0 when 3D is on (extrusion takes over),
      // semi-transparent when satellite on, solid otherwise.
      map.setPaintProperty('zcta-fill', 'fill-opacity', threeD ? 0 : (satellite ? 0.5 : 0.9));

      if (threeD) {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 0);

        const extrudeColorExpr = [
          'case', ['boolean', ['get', '_special'], false], '#111111',
          ['step', ['get', '_tier'], HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm, 3, HEAT_COLORS.orange, 4, HEAT_COLORS.hot],
        ];
        // FIX SATELLITE: 3D+heatmap extrusion stays solid (1.0) even when satellite is on
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', withHoverColor(extrudeColorExpr));
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', extrudeH);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 1.0);

        // Cap: flat slab 1m above block top — glows purple on hover, aligns with zcta-outline boundary
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', extrudeHCap);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', extrudeH);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', capHoverOpacity);

        // Hide all 2D zip lines in 3D mode — no depth test against fill-extrusions (x-ray fix)
        map.setPaintProperty('zcta-line',       'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow',  'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 1);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color',
          ['case', ['boolean', ['get', '_special'], false], '#222222', '#1a0505']);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0);
        // Cap disabled in 2D
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', 1);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', 0);
        map.setPaintProperty('zcta-line',      'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2','line-opacity', satellite ? 0.25 : 0.35);
      }
    } else {
      // No heatmap — use dark red theme
      map.setPaintProperty('zcta-fill', 'fill-color', ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505']);
      // FIX ADDITIVE STATE / 3D ARTIFACTING: zero opacity in 3D so the flat fill
      // doesn't appear as stray 2D surfaces beneath or through extrusions.
      map.setPaintProperty('zcta-fill', 'fill-opacity', threeD ? 0 : (satellite ? 0.38 : 0.55));

      if (threeD) {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 0);
        // FIX SATELLITE: 3D no-heatmap extrusion is semi-transparent when satellite is on
        const flatColorExpr = ['case', ['boolean', ['get', '_special'], false], '#111111', '#3a0505'];
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', withHoverColor(flatColorExpr));
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', flatH);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', satellite ? 0.9 : 1.0);

        // Cap: flat slab 1m above block top — glows purple on hover, aligns with zcta-outline boundary
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', flatHCap);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', flatH);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', capHoverOpacity);

        // Hide all 2D zip lines in 3D mode — no depth test against fill-extrusions (x-ray fix)
        map.setPaintProperty('zcta-line',       'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow',  'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 1);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', 
          ['case', ['boolean', ['get', '_special'], false], '#222222', '#1a0505']);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0);
        // Cap disabled in 2D
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', 1);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', 0);
        map.setPaintProperty('zcta-line',      'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2','line-opacity', satellite ? 0.25 : 0.35);
      }
    }

    // Hover fill: only in 2D modes (3D hover is handled via extrusion color)
    map.setPaintProperty('zcta-hover', 'fill-opacity', threeD ? 0 : ['case', ['boolean', ['feature-state', 'hovered'], false], 0.5, 0]);

    // Upper 3D border color: themed to zip's heat tier when heatmap on, red when off
    const upperBorderColorExpr = heatmap ? [
      'case', ['boolean', ['get', '_special'], false], '#333333',
      ['step', ['get', '_tier'], HEAT_DARK_COLORS.cold, 1, HEAT_DARK_COLORS.cool, 2, HEAT_DARK_COLORS.warm, 3, HEAT_DARK_COLORS.orange, 4, HEAT_DARK_COLORS.hot],
    ] : OUTLINE_COLOR;

    if (map.getSource('zcta-outline')) {
      // T3: zoom-interpolated opacity — reduces fringing at low zoom, full at close zoom
      const outlineOpacity = ['interpolate', ['linear'], ['zoom'], 9, 0.70, 13, 0.98];
      map.setPaintProperty('zcta-outline', 'fill-extrusion-opacity', threeD ? outlineOpacity : 0);
      map.setPaintProperty('zcta-outline-line', 'line-opacity', 0);
      if (threeD) {
        map.setPaintProperty('zcta-outline', 'fill-extrusion-color', upperBorderColorExpr);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-base', heatmap ? extrudeH : flatH);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-height', ['+', heatmap ? extrudeH : flatH, 18]);
      } else {
        map.setPaintProperty('zcta-outline', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-height', 0);
      }
    }

    // Borough outline — visible only in 3D mode, color based on avg borough tier
    if (map.getSource('borough-source')) {
      if (threeD && boroughGeoDataRef.current) {
        const avgTiers = computeBoroughAvgTiers(
          tiers,
          zipBoroughMapRef.current,
          boroughGeoDataRef.current.features.length
        );
        const coloredBorough = buildColoredBoroughFeatures(boroughGeoDataRef.current, avgTiers, heatmap);
        boroughWithColorRef.current = coloredBorough;
        map.getSource('borough-source').setData(
          createOutlineGeoJSON(coloredBorough, getZoomAwareOutlineWidth(map, 40))
        );
        // T3: zoom-interpolated opacity on borough-outline — same anti-pixelation treatment
        const boroughOpacity = ['interpolate', ['linear'], ['zoom'], 9, 0.70, 13, 0.92];
        map.setPaintProperty('borough-outline', 'fill-extrusion-opacity', boroughOpacity);
      } else {
        map.setPaintProperty('borough-outline', 'fill-extrusion-opacity', 0);
        boroughWithColorRef.current = null;
      }
    }
  }, [heatmap, threeD, real3D, timespanIdx, events, geoData, boroughGeoData, mapReady, satellite, adjacency, styleVersion]);

  // 3D pitch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.easeTo({ pitch: threeD ? 48 : 0, bearing: threeD ? -17 : 0, duration: 700 });
  }, [threeD, mapReady]);

  // T3 3D PIXELIZATION: re-generate outline ring width on zoom AND pitch so it stays visible.
  // Uses withHeatRef so it doesn't need to recompute tiers/zip data.
  // Also regenerates borough-outline width with baseMeters=40.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onZoom = () => {
      if (!threeDRef.current) return;
      if (withHeatRef.current && map.getSource('zcta-outline')) {
        const outlineData = createOutlineGeoJSON(withHeatRef.current, getZoomAwareOutlineWidth(map));
        map.getSource('zcta-outline').setData(outlineData);
        if (map.getSource('zcta-cap-source')) map.getSource('zcta-cap-source').setData(createCapGeoJSON(outlineData));
      }
      if (boroughWithColorRef.current && map.getSource('borough-source')) {
        map.getSource('borough-source').setData(createOutlineGeoJSON(boroughWithColorRef.current, getZoomAwareOutlineWidth(map, 40)));
      }
    };
    map.on('zoom', onZoom);
    map.on('pitch', onZoom);
    return () => { map.off('zoom', onZoom); map.off('pitch', onZoom); };
  }, [mapReady]);

  // FIX ADDITIVE STATE: Satellite is additive — does NOT touch heatmap/3D/real3D state.
  // After style swap, re-adds zcta layers and real3D layers if active.
  // styleVersion increment triggers the main heatmap effect to re-apply all paint
  // properties to the freshly created layers, restoring all active combos.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setStyle(satellite ? satelliteMapStyle() : darkMapStyle());
    map.once('styledata', () => {
      const currentGeoData = geoDataRef.current;
      if (!currentGeoData || map.getSource('zcta')) return;
      addLayers(map, currentGeoData, satelliteRef.current);
      if (real3DRef.current) applyReal3DLayers(map, heatmapRef.current);
      // This triggers the main heatmap+3D useEffect to re-run and restore all styles
      setStyleVersion(v => v + 1);
    });
  }, [satellite]);

  // FIX REAL3D: Building color expression using feature-state (tier+shadeIdx) for
  // heatmap mode, or deterministic ID-based red shades for non-heatmap mode.
  // In heatmap mode: tier comes from spatial assignment (zip region lookup),
  // shadeIdx = featureId % 5 for cluster differentiation.
  function buildingColorExprByState(isHeatmap) {
    if (!isHeatmap) {
      // 5 distinct dark-red shades so neighboring buildings are visually different
      return ['case',
        ['==', ['%', ['to-number', ['id'], 0], 5], 0], '#0d0202',
        ['==', ['%', ['to-number', ['id'], 0], 5], 1], '#280606',
        ['==', ['%', ['to-number', ['id'], 0], 5], 2], '#0a0101',
        ['==', ['%', ['to-number', ['id'], 0], 5], 3], '#3d0a0a',
        '#1f0505',
      ];
    }

    // Heatmap: nested case — outer=tier from feature-state, inner=shade index from feature-state
    const shades = (tones) => ['case',
      ['==', ['feature-state', 'shadeIdx'], 0], tones[0],
      ['==', ['feature-state', 'shadeIdx'], 1], tones[1],
      ['==', ['feature-state', 'shadeIdx'], 2], tones[2],
      ['==', ['feature-state', 'shadeIdx'], 3], tones[3],
      tones[4],
    ];

    return ['case',
      ['==', ['feature-state', 'tier'], 4], shades(HEAT_BUILDING_TONES.hot),
      ['==', ['feature-state', 'tier'], 3], shades(HEAT_BUILDING_TONES.orange),
      ['==', ['feature-state', 'tier'], 2], shades(HEAT_BUILDING_TONES.warm),
      ['==', ['feature-state', 'tier'], 1], shades(HEAT_BUILDING_TONES.cool),
      shades(HEAT_BUILDING_TONES.cold),
    ];
  }

  // FIX REAL3D: Spatial assignment — queries rendered buildings, does point-in-polygon
  // against zcta features to get the region tier, then sets feature-state on each building.
  // shadeIdx = featureId % 5 ensures neighboring buildings (different OSM IDs) get
  // different shades of the same hue for visibility without needing outlines.
  function assignBuildingTiersToMap(map) {
    if (!map || !map.getLayer('real3d-buildings')) return;
    const features = geoDataRef.current?.features;
    const tiers = tiersRef.current;
    if (!features || !tiers.length) return;
    try {
      const buildings = map.queryRenderedFeatures(undefined, { layers: ['real3d-buildings'] });
      buildings.forEach(b => {
        if (b.id == null) return;
        const centroid = getGeomCentroid(b.geometry);
        const tier = findTierForPoint(centroid, features, tiers);
        const shadeIdx = Math.abs(Number(b.id) || 0) % 5;
        map.setFeatureState(
          { source: 'openmaptiles', sourceLayer: 'building', id: b.id },
          { tier, shadeIdx }
        );
      });
    } catch (e) { /* ignore mid-render errors */ }
  }

  function applyReal3DLayers(map, isHeatmap) {
    // Clean up any previous building assignment listeners
    if (buildingAssignCleanupRef.current) {
      buildingAssignCleanupRef.current();
      buildingAssignCleanupRef.current = null;
    }

    ['real3d-buildings', 'real3d-buildings-outline'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (!map.getSource('openmaptiles')) {
      try {
        map.addSource('openmaptiles', { type: 'vector', url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}` });
      } catch (err) { console.warn('Real3D source add failed:', err); return; }
    }
    try {
      map.addLayer({
        id: 'real3d-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12,
        paint: {
          'fill-extrusion-color': buildingColorExprByState(isHeatmap),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 5],
          'fill-extrusion-base':   ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 1.0,
          'fill-extrusion-vertical-gradient': true,
        },
      });
      // FIX REAL3D BOTTOM OUTLINE: Do NOT add the outline layer for full 3D blocks.
      // The outline (minzoom 14) only appears when buildings are fully 3D extruded,
      // which is exactly when we want NO outline — cluster colors provide distinction.
      // For baseplate phase (zoom 12-14), the footprint fill provides enough boundary.

      map.easeTo({ pitch: 55, bearing: -17, duration: 700 });

      if (isHeatmap) {
        // Assign zip tiers to building feature-states for heatmap color inheritance
        const assignFn = () => assignBuildingTiersToMap(map);
        setTimeout(assignFn, 500);
        map.on('moveend', assignFn);
        map.on('zoomend', assignFn);
        buildingAssignCleanupRef.current = () => {
          map.off('moveend', assignFn);
          map.off('zoomend', assignFn);
        };
      }
    } catch (err) { console.warn('Real3D layer add failed:', err); }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!real3D) {
      ['real3d-buildings', 'real3d-buildings-outline'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      if (buildingAssignCleanupRef.current) { buildingAssignCleanupRef.current(); buildingAssignCleanupRef.current = null; }
      if (!threeD) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      return;
    }
    applyReal3DLayers(map, heatmapRef.current);
  }, [real3D, mapReady]);

  // FIX REAL3D HEATMAP: refresh building color expression + spatial assignment when heatmap changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !real3D || !map.getLayer('real3d-buildings')) return;
    map.setPaintProperty('real3d-buildings', 'fill-extrusion-color', buildingColorExprByState(heatmap));
    if (heatmap) {
      // Re-assign tiers with new heatmap state; set up move/zoom listeners
      if (buildingAssignCleanupRef.current) { buildingAssignCleanupRef.current(); buildingAssignCleanupRef.current = null; }
      const assignFn = () => assignBuildingTiersToMap(map);
      setTimeout(assignFn, 300);
      map.on('moveend', assignFn);
      map.on('zoomend', assignFn);
      buildingAssignCleanupRef.current = () => { map.off('moveend', assignFn); map.off('zoomend', assignFn); };
    } else {
      // Heatmap turned off — clear listeners, ID-based expression needs no state
      if (buildingAssignCleanupRef.current) { buildingAssignCleanupRef.current(); buildingAssignCleanupRef.current = null; }
    }
  }, [heatmap, real3D, mapReady]);

  const handleThreeDToggle = () => {
    if (isOffline) {
      setConnectionNotice('You must have an internet or mobile connection to use these features');
      return;
    }
    setConnectionNotice('');
    setThreeD(v => { if (!v) setReal3D(false); return !v; });
  };
  const handleReal3DToggle = () => {
    if (isOffline) {
      setConnectionNotice('You must have an internet or mobile connection to use these features');
      return;
    }
    setConnectionNotice('');
    setReal3D(v => { if (!v) setThreeD(false); return !v; });
  };

  // Location orb
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (locationMarkerRef.current) { locationMarkerRef.current.remove(); locationMarkerRef.current = null; }
    if (!userLocation) return;
    const el = document.createElement('div');
    el.style.cssText = `width:18px;height:18px;border-radius:50%;background:#7C3AED;border:2px solid white;box-shadow:0 0 0 4px rgba(124,58,237,0.35),0 0 24px rgba(124,58,237,0.7);z-index:1000;animation:orb-pulse 2s ease-in-out infinite;`;
    if (!document.getElementById('orb-pulse-style')) {
      const s = document.createElement('style'); s.id = 'orb-pulse-style';
      s.textContent = `@keyframes orb-pulse{0%,100%{box-shadow:0 0 0 4px rgba(124,58,237,0.35),0 0 24px rgba(124,58,237,0.7)}50%{box-shadow:0 0 0 8px rgba(124,58,237,0.15),0 0 40px rgba(124,58,237,0.9)}}`;
      document.head.appendChild(s);
    }
    locationMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([userLocation.lng, userLocation.lat]).addTo(map);
  }, [userLocation, mapReady]);

  useEffect(() => {
    if (!hoveredZip) { setHoveredEvents([]); setHoveredColonists(null); return; }
    if (hoveredZip === 'SAFEZONE') { setHoveredEvents([]); setHoveredColonists(0); return; }
    const { zipMap } = buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days);
    setHoveredEvents(zipMap[hoveredZip] || []);
    getZipColonists(hoveredZip).then(c => setHoveredColonists(c.length)).catch(() => setHoveredColonists(0));
  }, [hoveredZip, timespanIdx, events]);

  async function openSidePanel(zip) {
    setSideZip(zip);
    if (zip === 'SAFEZONE') { setSideEvents([]); setSideColonists([]); return; }
    const { zipMap } = buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days);
    setSideEvents(zipMap[zip] || []);
    setSideColonists(await getZipColonists(zip).catch(() => []));
  }

  async function handleCenterLocation() {
    if (locLoading) return;
    setLocLoading(true); setNotInNYC(false);
    try {
      const result = await pingNYCLocation();
      setUserLocation(result);
      if (!result.inNYC) { setNotInNYC(true); setTimeout(() => setNotInNYC(false), 6000); }
      else if (mapRef.current) mapRef.current.flyTo({ center: [result.lng, result.lat], zoom: 13.5, duration: 1400 });
    } catch { setNotInNYC(true); setTimeout(() => setNotInNYC(false), 6000); }
    setLocLoading(false);
  }

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') { setHoloFeature(null); setSideZip(null); setSideEvents([]); setSideColonists([]); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const zipLabel  = hoveredZip === 'SAFEZONE' ? 'Safe Zone' : hoveredZip ? `ZIP ${hoveredZip}` : '';
  const sideLabel = sideZip   === 'SAFEZONE' ? 'Safe Zone' : sideZip   ? `ZIP ${sideZip}`   : '';

  return (
    // Outer div is the positioning root for everything
    <div ref={containerRef} className="absolute inset-0 overflow-hidden" style={{ background: '#0d0000' }}>

      {/* FIX CRT: Wrap CRTEffect at z-index 20 so it renders ABOVE the map canvas
          (z:2) as a visible overlay on all views and combos, while remaining below
          popups (z:30+). pointer-events-none ensures it never blocks interaction. */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
        <CRTEffect active={true} limitMobile={isMobile} />
      </div>

      {/* Map canvas at z-index 2 */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 2, background: 'transparent' }}
      />

      {!entered && <MapIntro onEnter={() => setEntered(true)} />}

      {entered && (
        <>
          {/* Controls */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
            <div className="flex items-center gap-1 bg-black/80 backdrop-blur border border-white/20 rounded-2xl px-3 py-1.5">
              <span className="text-white text-xs font-black mr-1">📅</span>
              {TIMESPAN_STEPS.map((s, i) => (
                <button key={s.label} onClick={() => setTimespanIdx(i)}
                  className={`px-3 py-1 rounded-xl text-xs font-black border transition-all ${timespanIdx === i ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'bg-transparent text-white border-white/30 hover:border-white/60'}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <button onClick={() => setHeatmap(v => !v)}
                className={`px-4 py-2 rounded-2xl font-black text-sm border-2 transition-all ${heatmap ? 'bg-gradient-to-r from-cyan-500 via-yellow-400 to-red-500 border-yellow-300 text-white' : 'bg-black/70 border-white/30 text-white hover:border-orange-400'}`}>
                🌡️ Heatmap
              </button>
              <button onClick={() => setSatellite(v => !v)}
                className={`px-4 py-2 rounded-2xl font-black text-sm border-2 transition-all ${satellite ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'bg-black/70 border-white/30 text-white hover:border-violet-400'}`}>
                🛰️ Satellite
              </button>
              <button onClick={handleThreeDToggle}
                className={`px-4 py-2 rounded-2xl font-black text-sm border-2 transition-all ${threeD ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-black/70 border-white/30 text-white hover:border-emerald-400'}`}>
                🏙️ 3D
              </button>
              <button onClick={handleReal3DToggle}
                className={`px-4 py-2 rounded-2xl font-black text-sm border-2 transition-all ${real3D ? 'bg-amber-600 border-amber-400 text-white' : 'bg-black/70 border-white/30 text-white hover:border-amber-400'}`}>
                🏛️ Real3D
              </button>
            </div>
            {connectionNotice && (
              <div className="max-w-[92vw] rounded-xl border border-red-400 bg-red-950/90 px-3 py-2 text-center">
                <p className="text-red-200 text-xs font-black">{connectionNotice}</p>
              </div>
            )}
          </div>

          {/* Center-to-location */}
          <button onClick={handleCenterLocation} disabled={locLoading}
            className="absolute bottom-24 right-4 z-30 w-11 h-11 bg-black/80 border border-white/30 rounded-xl flex items-center justify-center hover:bg-[#7C3AED]/80 hover:border-[#7C3AED] transition-all shadow-lg">
            {locLoading
              ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
            }
          </button>

          {notInNYC && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 bg-yellow-950/95 border border-yellow-600 rounded-2xl px-5 py-3 flex items-center gap-3 shadow-lg">
              <span className="text-yellow-400 text-xl">⚠️</span>
              <div>
                <p className="text-yellow-200 font-black text-sm">You are not in NYC</p>
                <p className="text-yellow-400/70 text-xs mt-0.5">Orbiter mode — view only.</p>
              </div>
            </div>
          )}

          {/* Hover tooltip */}
          {hoveredZip && tooltipPos && (
            <div className="absolute z-30 pointer-events-none"
              style={{ left: Math.min(tooltipPos.x + 12, window.innerWidth - 220), top: Math.max(tooltipPos.y - 10, 70), width: 210 }}>
              <div className="bg-gray-950/95 border border-red-900/60 rounded-2xl overflow-hidden shadow-[0_0_15px_rgba(255,20,0,0.3)]">
                <div className="px-3 py-2 border-b border-white/10">
                  <p className="text-red-400 font-black text-xs">{zipLabel}</p>
                  {hoveredZip !== 'SAFEZONE' && <p className="text-white/60 text-xs">{hoveredEvents.length} upcoming events</p>}
                  {hoveredZip === 'SAFEZONE' && <p className="text-white/40 text-xs italic">Safe zone</p>}
                </div>
                {hoveredZip !== 'SAFEZONE' && hoveredEvents.slice(0, 3).map(e => (
                  <div key={e.id} className="px-3 py-1.5 border-b border-white/5">
                    <p className="text-white text-xs font-bold truncate">{e.representative_emoji} {e.event_name}</p>
                    <p className="text-white/40 text-xs">{e.event_date}</p>
                  </div>
                ))}
                {hoveredEvents.length > 3 && <p className="text-white/30 text-xs px-3 py-1">+{hoveredEvents.length - 3} more</p>}
                {hoveredColonists !== null && hoveredZip !== 'SAFEZONE' && (
                  <div className="px-3 py-2 border-t border-white/10">
                    <p className="text-green-400/70 text-xs italic">{hoveredColonists} colonist{hoveredColonists !== 1 ? 's' : ''} in {zipLabel}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── DESKTOP side panel ── */}
          {sideZip && !isMobile && (
            <div className="absolute right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden"
              style={{ width: 400, background: 'rgba(3,0,10,0.82)', backdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(180,0,0,0.3)' }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black/30 flex-shrink-0">
                <div>
                  <p className="text-red-400 font-black">{sideLabel}</p>
                  <p className="text-white/40 text-xs">{sideZip === 'SAFEZONE' ? 'Safe zone' : `${sideEvents.length} events · ${sideColonists.length} colonists`}</p>
                </div>
                <button onClick={() => { setSideZip(null); setSideEvents([]); setSideColonists([]); setHoloFeature(null); }}
                  className="text-white/40 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto border-b border-white/10" style={{ maxHeight: '50%' }}>
                <PaginatedSection
                  items={sideEvents}
                  emptyMsg="No upcoming events"
                  headerLabel="Events"
                  headerColor="text-white/30"
                  renderItem={(event) => (
                    <div key={event.id} onClick={() => setSelectedEvent(event)}
                      className="flex items-start gap-3 p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                      style={{ borderLeftColor: event.hex_color || '#7C3AED', borderLeftWidth: 3 }}>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl"
                        style={{ background: (event.hex_color || '#7C3AED') + '33', border: `2px solid ${event.hex_color || '#7C3AED'}` }}>
                        {event.photos?.[0]
                          ? <img src={event.photos[0]} className="w-full h-full object-cover" alt="" onError={e => { e.target.style.display = 'none'; }} />
                          : event.representative_emoji || '🎉'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-sm truncate">{event.representative_emoji} {event.event_name}</p>
                        <p className="text-white/40 text-xs">{event.event_date} · {event.price_category === 'free' ? 'FREE' : event.price_category || '?'}</p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {generateAutoTags(event).slice(0, 2).map(t => (
                            <span key={t} className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded-full">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                />
              </div>

              {sideZip !== 'SAFEZONE' && (
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: '50%' }}>
                  <PaginatedSection
                    items={sideColonists}
                    emptyMsg="No colonists yet"
                    headerLabel="Colony Leaderboard"
                    headerColor="text-green-400/50"
                    renderItem={(c, i) => {
                      const medal = MEDALS[i] || null, isTop = i < 3;
                      return (
                        <div key={c.username || i}
                          className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 hover:bg-white/5"
                          style={{ background: isTop ? `rgba(${i === 0 ? '255,200,0' : i === 1 ? '180,180,180' : '200,120,60'},0.06)` : 'transparent' }}>
                          <div className="w-7 text-center flex-shrink-0">
                            {medal ? <span className="text-lg">{medal}</span> : <span className="text-xs font-black text-white/20">#{i + 1}</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-black text-sm truncate ${isTop ? 'text-white' : 'text-white/60'}`}>{c.username}</p>
                            {c.updated_at && <p className="text-white/20 text-xs">since {new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`font-black text-sm ${isTop ? 'text-yellow-400' : 'text-yellow-400/50'}`} style={isTop ? { textShadow: '0 0 8px rgba(250,204,21,0.5)' } : {}}>{c.clout_points || 0}</p>
                            <p className="text-white/20 text-xs">clout</p>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── MOBILE: hologram top 50%, side panel bottom 50% ── */}
          {holoFeature && isMobile && (
            <ZipHologramMobile feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)} />
          )}

          {sideZip && isMobile && (
            <div className="absolute inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden"
              style={{ height: '50%', background: 'rgba(3,0,10,0.88)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(180,0,0,0.3)' }}>
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 flex-shrink-0">
                <div>
                  <p className="text-red-400 font-black text-sm">{sideLabel}</p>
                  <p className="text-white/40 text-xs">{sideZip === 'SAFEZONE' ? 'Safe zone' : `${sideEvents.length} events · ${sideColonists.length} colonists`}</p>
                </div>
                <button onClick={() => { setSideZip(null); setSideEvents([]); setSideColonists([]); setHoloFeature(null); }}
                  className="text-white/40 text-lg w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">✕</button>
              </div>

              <div className="flex flex-1 overflow-hidden min-h-0">
                <div className="flex-1 flex flex-col overflow-hidden border-r border-white/10 min-h-0">
                  <PaginatedSection
                    items={sideEvents}
                    emptyMsg="None"
                    headerLabel="Events"
                    headerColor="text-white/30"
                    renderItem={(event) => (
                      <div key={event.id} onClick={() => setSelectedEvent(event)}
                        className="flex items-center gap-2 px-2 py-2 border-b border-white/5 cursor-pointer active:bg-white/5"
                        style={{ borderLeftColor: event.hex_color || '#7C3AED', borderLeftWidth: 2 }}>
                        <div className="text-base flex-shrink-0">{event.representative_emoji || '🎉'}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-black text-xs truncate leading-tight">{event.event_name}</p>
                          <p className="text-white/40 text-[10px]">{event.event_date}</p>
                        </div>
                      </div>
                    )}
                  />
                </div>
                {sideZip !== 'SAFEZONE' && (
                  <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    <PaginatedSection
                      items={sideColonists}
                      emptyMsg="None yet"
                      headerLabel="Colony"
                      headerColor="text-green-400/50"
                      renderItem={(c, i) => {
                        const medal = MEDALS[i] || null, isTop = i < 3;
                        return (
                          <div key={c.username || i}
                            className="flex items-center gap-2 px-2 py-2 border-b border-white/5"
                            style={{ background: isTop ? `rgba(${i === 0 ? '255,200,0' : i === 1 ? '180,180,180' : '200,120,60'},0.06)` : 'transparent' }}>
                            <div className="w-5 text-center flex-shrink-0">
                              {medal ? <span className="text-sm">{medal}</span> : <span className="text-[10px] font-black text-white/20">#{i + 1}</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`font-black text-xs truncate ${isTop ? 'text-white' : 'text-white/60'}`}>{c.username}</p>
                            </div>
                            <p className={`font-black text-xs flex-shrink-0 ${isTop ? 'text-yellow-400' : 'text-yellow-400/50'}`}>{c.clout_points || 0}</p>
                          </div>
                        );
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Desktop hologram */}
          {holoFeature && !isMobile && (
            <ZipHologram feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)} />
          )}

          {userLocation && (
            <div className="absolute bottom-16 left-4 z-30 bg-black/70 border border-[#7C3AED]/60 rounded-xl px-3 py-1.5 text-xs text-[#7C3AED] font-bold pointer-events-none">
              📍 Location active
            </div>
          )}
        </>
      )}

      {selectedEvent && <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
