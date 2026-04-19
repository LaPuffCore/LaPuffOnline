import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { generateAutoTags } from '../lib/autoTags';
import EventDetailPopup from './EventDetailPopup';
import MapIntro from './MapIntro';
import CRTEffect from './CRTEffect';
import { getZipColonists } from '../lib/pointsSystem';
import { pingNYCLocation, getLastLocation } from '../lib/locationService';
import { SAMPLE_MODE } from '../lib/sampleConfig';
import { getSampleUsersForZip } from '../lib/sampleUsers';
import { deserialize as fgbDeserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const GEOJSON_URL = './data/MODZCTA_2010_WGS1984.geo.json';
const BOROUGH_GEOJSON_URL = './data/borough.geo.json';
const BUILDING_FGB_URL = './data/building_indexed.fgb';
const FGB_CACHE_NAME = 'lapuff-fgb-v2';
const FGB_CACHE_KEY  = 'building_indexed.fgb';
const MAPTILER_KEY = 'VjoJJ0mSCXFo9kFGYGxJ';

const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

// Fill colors slightly muted so the bright neon outline always reads brighter
const HEAT_COLORS = {
  cold:   '#00ccdd',
  cool:   '#00dd66',
  warm:   '#f5c800',
  orange: '#dd6600',
  hot:    '#cc0d00',
};

// Full-saturation neon for outlines — always visually dominant over fills
const OUTLINE_COLOR = '#ff2200';
const OUTLINE_GLOW  = '#ff0000';

// Darkened heatmap tier colors for upper 3D border and borough outlines.
// Much darker than fill tier colors so the outline reads clearly as a distinct boundary.
const HEAT_DARK_COLORS = {
  cold:   '#001f29',
  cool:   '#002910',
  warm:   '#5c4a00',
  orange: '#3d1500',
  hot:    '#2e0000',
};

// Mid-brightness heatmap tier colors for borough outlines in 3D/Real3D heatmap.
// Brighter than HEAT_DARK_COLORS so outlines stay visible against dark backgrounds and water.
const HEAT_MID_COLORS = {
  cold:   '#339eb3',
  cool:   '#33b366',
  warm:   '#b39900',
  orange: '#cc6622',
  hot:    '#cc3333',
};

// FIX REAL3D: 5 wide-range shades per heatmap tier for building cluster coloring.
// Neighbors get different shades (via featureId % 5). Range is light→dark for differentiation.
const HEAT_BUILDING_TONES = {
  cold:   ['#001824', '#003d5c', '#007a8c', '#00b8c8', '#a0eeff'],
  cool:   ['#001408', '#003d1c', '#007a38', '#00b854', '#a0ffb8'],
  warm:   ['#2b1f00', '#5c4a00', '#a08200', '#d4ad00', '#ffe44d'],
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

function midTierColor(tier) {
  if (tier >= 4) return HEAT_MID_COLORS.hot;
  if (tier >= 3) return HEAT_MID_COLORS.orange;
  if (tier >= 2) return HEAT_MID_COLORS.warm;
  if (tier >= 1) return HEAT_MID_COLORS.cool;
  return HEAT_MID_COLORS.cold;
}

function isSpecialZip(zip) {
  return !zip || zip === '' || zip === '99999' || parseInt(zip) > 11697 || (typeof zip === 'string' && zip.startsWith('SAFEZONE'));
}

// True if the sideZip / MODZCTA string is any safezone (SAFEZONE, SAFEZONE_1 … SAFEZONE_N)
function isSafezoneModzcta(zip) {
  return typeof zip === 'string' && (zip === 'SAFEZONE' || zip.startsWith('SAFEZONE_'));
}

// Human-readable label: "Safe Zone 3", "Safe Zone" (generic), or "" for non-safezone
function getSafezoneLabel(zip) {
  if (!zip) return '';
  if (zip.startsWith('SAFEZONE_')) return `Safe Zone ${zip.slice(9)}`;
  return 'Safe Zone';
}

// Find events geographically within a safezone feature polygon (by lat/lng).
// Used when the user opens a safezone's side panel — zipMap doesn't have SAFEZONE_N keys.
function getEventsInSafezone(szFeature, events, timespanIdx) {
  if (!szFeature?.geometry || !events?.length) return [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const maxDate = new Date(now.getTime() + TIMESPAN_STEPS[timespanIdx].days * 86400000);
  const geom = szFeature.geometry;
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  return events.filter(e => {
    const lat = parseFloat(e.lat); const lng = parseFloat(e.lng);
    if (isNaN(lat) || isNaN(lng)) return false;
    const ed = new Date(e.event_date + 'T00:00:00');
    if (ed < now || ed > maxDate) return false;
    for (const poly of polys) {
      if (pointInRing(lng, lat, poly[0])) return true;
    }
    return false;
  });
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

// D6: Winding validation — enforce GeoJSON right-hand rule for polygon rings.
// GeoJSON outer rings must be counterclockwise (positive signed area in screen coords).
// Reversed rings cause bad GPU triangulation (triangular Z-fighting artifacts).
function enforceGeoJSONWinding(feature) {
  if (!feature || !feature.geometry) return feature;
  const { type, coordinates } = feature.geometry;
  if (type !== 'Polygon' && type !== 'MultiPolygon') return feature;
  const fixRings = rings => rings.map((ring, i) => {
    const area = signedArea([...ring, ring[0]]);
    // Outer ring (i=0): should be counterclockwise (positive area in lat/lng space)
    // Holes (i>0): should be clockwise (negative area)
    const shouldBePositive = i === 0;
    if ((shouldBePositive && area < 0) || (!shouldBePositive && area > 0)) {
      return [...ring].reverse();
    }
    return ring;
  });
  const fixedCoords = type === 'Polygon'
    ? fixRings(coordinates)
    : coordinates.map(fixRings);
  return { ...feature, geometry: { ...feature.geometry, coordinates: fixedCoords } };
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

// MapLibre line-width expression for 2D/Real3D ZCTA outlines.
// z9→z9.5: original ramp 2→3.5px. z9.5→z11: ramp to 6.0px. z11→z16: gentle growth to 8px.
// z9.5 value reduced from 5.6 (user: too big at 9.5-11). z11+ unchanged.
// GPU-evaluated per-frame — no JS zoom listener needed.
function zctaLineWidthExpr(mult = 1) {
  return ['interpolate', ['linear'], ['zoom'],
    9,   2.0 * mult,   // original z9 ramp start
    9.5, 3.5 * mult,   // reduced from 5.6 — less thick at far-mid zoom
    11,  6.0 * mult,   // z11 anchor — preserves z11+ visual size
    16,  8.0 * mult,   // gentle growth target (stays visually consistent)
  ];
}

// T3 3D PIXELIZATION: Smooth continuous zoom-aware width scaling.
// ZCTA (base 14m): 14m flat until zoom 10.5, then ramps to 64m at zoom 9.
// Borough (base 18m): 1x at zoom≥11, 2x ramp at zoom 10-11, 3x ramp at zoom ≤9.
function getZoomAwareOutlineWidth(map, baseMeters = 14, is3D = false) {
  if (!map || typeof map.getZoom !== 'function') return baseMeters;
  // If 3D/Real3D mode is active, use the new split-scale logic.
  if (is3D) {
    const zoom = map.getZoom();
    const pitch = map.getPitch ? map.getPitch() : 0;
    const pitchFactor = 1 + (pitch / 90) * 0.55;
    // Borough outline (baseMeters=18): constant 1.5x at zoom>=12, 2.5x at zoom 11-12, ramp to 7x at zoom<=9.
    if (baseMeters >= 15) {
      let meters;
      if (zoom >= 12) {
        meters = baseMeters * 1.5; // locked smaller width at close zoom
      } else if (zoom >= 11) {
        const t = (12 - zoom); // 0 at zoom12, 1 at zoom11
        meters = baseMeters * (1.5 + 1.0 * t); // 1.5x → 2.5x
      } else if (zoom >= 9) {
        const t = (11 - zoom) / 2; // 0 at zoom11, 1 at zoom9
        meters = baseMeters * (2.5 + 4.5 * t);
      } else {
        meters = baseMeters * 7;
      }
      return meters * pitchFactor;
    }
    // ZCTA outline (baseMeters=14): original exponential ramp 10.5→9.
    const t = Math.max(0, 10.5 - zoom);
    const targetAt9 = 64;
    const scale = Math.pow(targetAt9 / baseMeters, 1 / 1.5);
    const multiplier = Math.pow(scale, t);
    return baseMeters * multiplier * pitchFactor;
  }

  // Non-3D behavior (2D and Real3D flat outlines): apply requested adjustments
  const zoom = map.getZoom();
  // Increase base starting size by +4 pixels (measured at zoom 9.5)
  const refLat = (map.getCenter && map.getCenter().lat) ? map.getCenter().lat : 40.71;
  const metersPerPixelAt95 = 156543.03392 * Math.cos(refLat * Math.PI / 180) / Math.pow(2, 9.5);
  const extraMetersFor4px = 4 * metersPerPixelAt95;
  // Increase constant minimum by 40%
  const adjBase = (baseMeters + extraMetersFor4px) * 1.4;

  // Lock flat until 9.5 (t = 0 for zoom >= 9.5)
  const t = Math.max(0, 9.5 - zoom);

  // Decrease the size at max zooms out (<9.5) by half
  const originalTargetAt9 = baseMeters === 18 ? 96 : 64;
  const targetAt9 = originalTargetAt9 * 0.5; // half size at zoom 9

  // exponent over the 0.5 zoom-step (9 -> 9.5)
  const denom = 9.5 - 9; // 0.5
  const scale = Math.pow(targetAt9 / adjBase, 1 / denom);
  const multiplier = Math.pow(scale, t);
  const pitch = map.getPitch ? map.getPitch() : 0;
  const pitchFactor = 1 + (pitch / 90) * 0.55;

  // Lock visual pixel width at zoom 10: scale meters up by 2^(zoom-10) for zoom > 10
  // so the outline maintains the same apparent thickness on screen.
  const zoomCompensation = zoom > 10 ? Math.pow(2, zoom - 10) : 1;

  return adjBase * multiplier * pitchFactor * zoomCompensation;
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

// Borough outlines: quad strip decomposition with outward-only offset.
// Inner edge = raw borough boundary (zero math). Outer edge = outward offset by widthMeters.
// Same anti-artifact approach as ZCTA outline but expanding outward from the boundary.
function createOutlineGeoJSON(sourceGeoJSON, widthMeters = 12) {
  const MITER_LIMIT = 2.5;

  const buildBoroughQuads = (rawRing, featureProps) => {
    const normalized = normalizeRing(rawRing);
    if (!normalized || normalized.length < 4) return [];
    const ring = normalized[0][0] === normalized[normalized.length - 1][0] && normalized[0][1] === normalized[normalized.length - 1][1]
      ? normalized.slice(0, -1) : normalized;
    if (ring.length < 3) return [];

    const refLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    const pts = ring.map(coord => lngLatToMeters(coord, refLat));
    const orientation = signedArea([...pts, pts[0]]) >= 0 ? 1 : -1;

    // Per-edge outward normals (away from polygon interior)
    const normals = pts.map((p, i) => {
      const next = pts[(i + 1) % pts.length];
      const dx = next[0] - p[0]; const dy = next[1] - p[1];
      return normalize(orientation > 0 ? [dy, -dx] : [-dy, dx]);
    });

    // Parallel outward edges at widthMeters from the boundary
    const outerEdges = pts.map((p, i) => {
      const next = pts[(i + 1) % pts.length]; const n = normals[i];
      return {
        p0: [p[0] + n[0] * widthMeters, p[1] + n[1] * widthMeters],
        p1: [next[0] + n[0] * widthMeters, next[1] + n[1] * widthMeters],
      };
    });

    // Resolve outer corner vertices — clamped miter, 1 vertex per corner always.
    const outerPts = pts.map((_, i) => {
      const prev = outerEdges[(i - 1 + outerEdges.length) % outerEdges.length];
      const curr = outerEdges[i];
      const avgNorm = normalize([
        normals[(i - 1 + normals.length) % normals.length][0] + normals[i][0],
        normals[(i - 1 + normals.length) % normals.length][1] + normals[i][1],
      ]);
      const intersection = lineIntersection(prev.p0, prev.p1, curr.p0, curr.p1);
      if (intersection) {
        const dx = intersection[0] - pts[i][0];
        const dy = intersection[1] - pts[i][1];
        if (Math.sqrt(dx * dx + dy * dy) > MITER_LIMIT * widthMeters) {
          return [pts[i][0] + avgNorm[0] * MITER_LIMIT * widthMeters, pts[i][1] + avgNorm[1] * MITER_LIMIT * widthMeters];
        }
        return intersection;
      }
      return [pts[i][0] + avgNorm[0] * widthMeters, pts[i][1] + avgNorm[1] * widthMeters];
    });

    // Convert outer points back to lng/lat
    const outerGeo = outerPts.map(coord => metersToLngLat(coord, refLat));

    // Emit one quad feature per edge segment: [outer_i, outer_i+1, inner_i+1, inner_i]
    // Inner = raw borough coords (unchanged), Outer = offset outward
    const quads = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const quadRing = [
        outerGeo[i],   // outer corner i
        outerGeo[j],   // outer corner i+1
        ring[j],       // inner (raw boundary) corner i+1
        ring[i],       // inner (raw boundary) corner i
        outerGeo[i],   // close ring
      ];
      quads.push({
        type: 'Feature',
        properties: { ...featureProps },
        geometry: { type: 'Polygon', coordinates: [quadRing] },
      });
    }
    return quads;
  };

  const features = [];
  for (const feature of sourceGeoJSON.features) {
    const normalizedGeom = normalizeFeatureGeometry(feature) || feature.geometry;
    if (!normalizedGeom) continue;
    const props = feature.properties || {};
    if (normalizedGeom.type === 'Polygon') {
      features.push(...buildBoroughQuads(normalizedGeom.coordinates[0], props));
    } else if (normalizedGeom.type === 'MultiPolygon') {
      for (const poly of normalizedGeom.coordinates) {
        features.push(...buildBoroughQuads(poly[0], props));
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

// ── Skeleton Cache System ──────────────────────────────────────────────────
// Precomputes per-ring geometry constants (normals, miter directions, meter coords)
// once on GeoJSON load. At runtime (every zoom tick), only cheap linear scaling
// is needed: offsetPt = pts[i] + unitOffsetVec[i] * widthMeters → metersToLngLat.
// Eliminates ~80% of per-tick compute (no re-normalizing, no re-intersecting).
const SKEL_MITER_LIMIT = 2.5;

function buildRingSkeleton(rawRing, direction) {
  // direction: 'inward' for ZCTA, 'outward' for borough
  const normalized = normalizeRing(rawRing);
  if (!normalized || normalized.length < 4) return null;
  const ring = normalized[0][0] === normalized[normalized.length - 1][0] && normalized[0][1] === normalized[normalized.length - 1][1]
    ? normalized.slice(0, -1) : normalized;
  if (ring.length < 3) return null;

  const refLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const pts = ring.map(coord => lngLatToMeters(coord, refLat));
  const orientation = signedArea([...pts, pts[0]]) >= 0 ? 1 : -1;

  // Normals: inward or outward depending on direction
  const normals = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    const dx = next[0] - p[0]; const dy = next[1] - p[1];
    if (direction === 'inward') {
      return normalize(orientation > 0 ? [-dy, dx] : [dy, -dx]);
    }
    return normalize(orientation > 0 ? [dy, -dx] : [-dy, dx]);
  });

  // Compute unit offset vectors at w=1 using line intersection
  const unitEdges = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length]; const n = normals[i];
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
      const dx = intersection[0] - pts[i][0];
      const dy = intersection[1] - pts[i][1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > SKEL_MITER_LIMIT) {
        return [avgNorm[0] * SKEL_MITER_LIMIT, avgNorm[1] * SKEL_MITER_LIMIT];
      }
      return [dx, dy];
    }
    return [avgNorm[0], avgNorm[1]];
  });

  return { ring, refLat, pts, unitOffsetVecs };
}

function buildZctaSkeleton(sourceGeoJSON) {
  return sourceGeoJSON.features.map(feature => {
    // Skip safezone features — they should NOT get an upper 3D border
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

// Fast quad generation from precomputed skeleton — only linear scaling + metersToLngLat.
// ZCTA: outer = raw ring, offset = inward (inner edge)
function generateZctaQuadsFromSkeleton(skeletons, widthMeters, propsOverrides) {
  const features = [];
  for (let si = 0; si < skeletons.length; si++) {
    const { props, rings } = skeletons[si];
    const mergedProps = propsOverrides ? { ...props, ...propsOverrides[si] } : props;
    for (const { ring, refLat, pts, unitOffsetVecs } of rings) {
      const n = ring.length;
      const offsetGeo = new Array(n);
      for (let i = 0; i < n; i++) {
        offsetGeo[i] = metersToLngLat(
          [pts[i][0] + unitOffsetVecs[i][0] * widthMeters, pts[i][1] + unitOffsetVecs[i][1] * widthMeters],
          refLat
        );
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        features.push({
          type: 'Feature',
          properties: mergedProps,
          geometry: { type: 'Polygon', coordinates: [[ring[i], ring[j], offsetGeo[j], offsetGeo[i], ring[i]]] },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

// Borough: inner = raw ring, offset = outward (outer edge)
function generateBoroughQuadsFromSkeleton(skeletons, widthMeters, propsOverrides) {
  const features = [];
  for (let si = 0; si < skeletons.length; si++) {
    const { props, rings } = skeletons[si];
    const mergedProps = propsOverrides ? { ...props, ...propsOverrides[si] } : props;
    for (const { ring, refLat, pts, unitOffsetVecs } of rings) {
      const n = ring.length;
      const offsetGeo = new Array(n);
      for (let i = 0; i < n; i++) {
        offsetGeo[i] = metersToLngLat(
          [pts[i][0] + unitOffsetVecs[i][0] * widthMeters, pts[i][1] + unitOffsetVecs[i][1] * widthMeters],
          refLat
        );
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        features.push({
          type: 'Feature',
          properties: mergedProps,
          geometry: { type: 'Polygon', coordinates: [[offsetGeo[i], offsetGeo[j], ring[j], ring[i], offsetGeo[i]]] },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

// ── End Skeleton Cache System ─────────────────────────────────────────────

// ZCTA upper 3D border outline — quad strip decomposition (non-cached, used for initial render).
// Kept as fallback; skeleton-cached version is used for zoom updates.
function createZctaOutlineGeoJSON(sourceGeoJSON, widthMeters = 12) {
  const MITER_LIMIT = 2.5;

  const buildZctaQuads = (rawRing, featureProps) => {
    const normalized = normalizeRing(rawRing);
    if (!normalized || normalized.length < 4) return [];
    const ring = normalized[0][0] === normalized[normalized.length - 1][0] && normalized[0][1] === normalized[normalized.length - 1][1]
      ? normalized.slice(0, -1) : normalized;
    if (ring.length < 3) return [];

    const refLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    const pts = ring.map(coord => lngLatToMeters(coord, refLat));
    const orientation = signedArea([...pts, pts[0]]) >= 0 ? 1 : -1;

    // Per-edge inward normals
    const normals = pts.map((p, i) => {
      const next = pts[(i + 1) % pts.length];
      const dx = next[0] - p[0]; const dy = next[1] - p[1];
      return normalize(orientation > 0 ? [-dy, dx] : [dy, -dx]);
    });

    // Parallel inward edges
    const innerEdges = pts.map((p, i) => {
      const next = pts[(i + 1) % pts.length]; const n = normals[i];
      return {
        p0: [p[0] + n[0] * widthMeters, p[1] + n[1] * widthMeters],
        p1: [next[0] + n[0] * widthMeters, next[1] + n[1] * widthMeters],
      };
    });

    // Resolve inner corner vertices — clamped miter, 1 vertex per corner always.
    const innerPts = pts.map((_, i) => {
      const prev = innerEdges[(i - 1 + innerEdges.length) % innerEdges.length];
      const curr = innerEdges[i];
      const avgNorm = normalize([
        normals[(i - 1 + normals.length) % normals.length][0] + normals[i][0],
        normals[(i - 1 + normals.length) % normals.length][1] + normals[i][1],
      ]);
      const intersection = lineIntersection(prev.p0, prev.p1, curr.p0, curr.p1);
      if (intersection) {
        const dx = intersection[0] - pts[i][0];
        const dy = intersection[1] - pts[i][1];
        if (Math.sqrt(dx * dx + dy * dy) > MITER_LIMIT * widthMeters) {
          return [pts[i][0] + avgNorm[0] * MITER_LIMIT * widthMeters, pts[i][1] + avgNorm[1] * MITER_LIMIT * widthMeters];
        }
        return intersection;
      }
      return [pts[i][0] + avgNorm[0] * widthMeters, pts[i][1] + avgNorm[1] * widthMeters];
    });

    // Convert inner points back to lng/lat
    const innerGeo = innerPts.map(coord => metersToLngLat(coord, refLat));

    // Emit one quad feature per edge segment: [outer_i, outer_i+1, inner_i+1, inner_i]
    // CCW winding for each quad (standard GeoJSON exterior ring).
    const quads = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const quadRing = [
        ring[i],        // outer corner i
        ring[j],        // outer corner i+1
        innerGeo[j],    // inner corner i+1
        innerGeo[i],    // inner corner i
        ring[i],        // close ring
      ];
      quads.push({
        type: 'Feature',
        properties: { ...featureProps },
        geometry: { type: 'Polygon', coordinates: [quadRing] },
      });
    }
    return quads;
  };

  const features = [];
  for (const feature of sourceGeoJSON.features) {
    // Skip safezone features — they should NOT get an upper 3D border
    if (feature.properties?._special) continue;
    const geom = feature.geometry;
    const props = feature.properties || {};
    if (geom.type === 'Polygon') {
      features.push(...buildZctaQuads(geom.coordinates[0], props));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        features.push(...buildZctaQuads(poly[0], props));
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

function darkMapStyle() {
  // No background layer — CSS background on the container provides the dark red (#0d0000).
  return { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources: {}, layers: [] };
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

// NYC bounding box as simple 5-vertex polygon — reliable GPU filter (eliminates NJ/CT).
// Borough.geo.json full polygon was too complex for MapLibre's within filter.
const NYC_BBOX_GEOM = {
  type: 'Polygon',
  coordinates: [[
    [-74.27, 40.47], [-73.68, 40.47], [-73.68, 40.93],
    [-74.27, 40.93], [-74.27, 40.47],
  ]],
};

// All Real3D layer IDs — used for cleanup. Includes per-tier heatmap layer IDs.
const REAL3D_ALL_LAYER_IDS = [
  'real3d-water',
  'real3d-park',
  'real3d-roads-motorway',
  'real3d-roads-primary',
  'real3d-roads-tertiary',
  'real3d-landuse-baseplate',
  'real3d-buildings', 'real3d-buildings-outline', 'real3d-buildings-baseplate',
];

// Douglas-Peucker line simplification — reduces coordinate count while preserving shape.
// tolerance in degrees (0.002 ≈ 200m, enough to cut ZCTA point count by ~70%).
function dpSimplify(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  const [x1, y1] = points[0], [x2, y2] = points[points.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    let d;
    if (lenSq === 0) {
      d = Math.hypot(px - x1, py - y1);
    } else {
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
      d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const l = dpSimplify(points.slice(0, maxIdx + 1), tolerance);
    const r = dpSimplify(points.slice(maxIdx), tolerance);
    return [...l.slice(0, -1), ...r];
  }
  return [points[0], points[points.length - 1]];
}

// Simplify a GeoJSON feature's geometry rings using Douglas-Peucker.
// Returns a new feature with simplified coordinates (only affects PiP/within filter geometry,
// not the rendered ZCTA fill layers which use original GeoJSON).
function simplifyFeature(feat, tolerance) {
  const geom = feat.geometry;
  const simplifyRing = (ring) => {
    const s = dpSimplify(ring, tolerance);
    if (s.length < 4) return ring; // keep original if too short
    // Ensure ring is closed
    const last = s[s.length - 1];
    if (s[0][0] !== last[0] || s[0][1] !== last[1]) s.push(s[0]);
    return s;
  };
  let newCoords;
  if (geom.type === 'Polygon') {
    newCoords = geom.coordinates.map(simplifyRing);
  } else if (geom.type === 'MultiPolygon') {
    newCoords = geom.coordinates.map(poly => poly.map(simplifyRing));
  } else {
    return feat;
  }
  return { ...feat, geometry: { ...geom, coordinates: newCoords } };
}


// Build per-tier FeatureCollections for ['within']-based building layers (planned C2 optimization).
// Features are simplified with Douglas-Peucker so ['within'] filter payload is small.
// IMPORTANT: ['within'] in MapLibre requires COMPLETE containment — buildings straddling zip
// borders will be excluded. A catch-all fallback layer with cold-tier colors handles those.
function buildTierGeoCollections(features, tiers) {
  const SIMPLIFY_TOLERANCE = 0.002; // ~200m — reduces points by ~60-70%, preserves general shape
  const groups = [[], [], [], [], []];
  features.forEach((feat, i) => {
    if (feat.properties?._special) return;
    const t = Math.min(4, Math.max(0, Math.round(tiers[i] ?? 0)));
    groups[t].push(simplifyFeature(feat, SIMPLIFY_TOLERANCE));
  });
  return groups.map(feats => ({ type: 'FeatureCollection', features: feats }));
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

// Compute borough heat tiers using TOTAL tier points across all zips in each borough.
// No averaging — boroughs with more hot zips rank higher regardless of how many cold zips they have.
// Tier points: tier 4 = 5pts, tier 3 = 4pts, tier 2 = 3pts, tier 1 = 2pts, tier 0 = 0pts.
// This prevents boroughs with many zips from being penalized by averaging down.
function computeBoroughAvgTiers(tiers, zipBoroughMap, boroughCount) {
  const TIER_POINTS = [0, 2, 3, 4, 5]; // tier 0 contributes nothing
  const boroughTotalPts = new Array(boroughCount).fill(0);
  Object.entries(zipBoroughMap).forEach(([idx, bi]) => {
    const i = parseInt(idx);
    const tier = Math.min(4, Math.max(0, tiers[i] ?? 0));
    boroughTotalPts[bi] += TIER_POINTS[tier];
  });
  // Sort by total points descending — highest total gets tier 4
  const indexed = boroughTotalPts.map((pts, i) => ({ pts, i }));
  indexed.sort((a, b) => b.pts - a.pts);
  const ranked = new Array(boroughCount).fill(0);
  for (let pos = 0; pos < indexed.length; pos++) {
    ranked[indexed[pos].i] = Math.max(0, 4 - pos);
  }
  return ranked;
}

// Inject _tier, _color, and _boroughIdx onto each borough feature. avgTiers are integer
// tiers from unique ranking — use HEAT_MID_COLORS for visible outline differentiation.
// Features stay in ORIGINAL order (must match skeleton index for zoom updates).
// _boroughIdx assigned by tier rank (ascending) so higher-tier (red) boroughs render on top via height stagger.
function buildColoredBoroughFeatures(boroughGeoData, avgTiers, isHeatmap) {
  // Compute rank order by tier (ascending) — lowest tier gets rank 0, highest gets rank 4.
  const indexed = avgTiers.map((tier, i) => ({ tier: tier ?? 0, i }));
  indexed.sort((a, b) => a.tier - b.tier);
  const rankMap = new Array(avgTiers.length);
  indexed.forEach(({ i }, rank) => { rankMap[i] = rank; });

  return {
    ...boroughGeoData,
    features: boroughGeoData.features.map((f, i) => ({
      ...f,
      properties: {
        ...f.properties,
        _tier: isHeatmap ? (avgTiers[i] ?? 0) : 0,
        _color: isHeatmap ? midTierColor(avgTiers[i] ?? 0) : OUTLINE_COLOR,
        _boroughIdx: rankMap[i],  // 0=lowest tier … 4=highest tier (red always last/on top)
      },
    })),
  };
}

// Remove borough outline quads that overlap safezone areas (ZCTA features with _special=true).
// Interior borough edges are KEPT for visual clarity; only safezone-adjacent quads are removed
// because their extrusion conflicts with the white safezone fill-extrusion.
// Returns { filtered, removedIdxSet } — removedIdxSet is stable across zooms for O(1) re-filtering.
function removeSafezoneOverlapQuads(quadsGeoJSON, safezoneFeatures) {
  const removedIdxSet = new Set();
  if (!safezoneFeatures || !safezoneFeatures.length) return { filtered: quadsGeoJSON, removedIdxSet };
  const kept = [];
  quadsGeoJSON.features.forEach((quad, idx) => {
    const coords = quad.geometry.coordinates[0];
    // Outward edge midpoint (coords[0] and coords[1] are outer vertices)
    const mx = (coords[0][0] + coords[1][0]) / 2;
    const my = (coords[0][1] + coords[1][1]) / 2;
    let isInSafezone = false;
    for (const sf of safezoneFeatures) {
      const geom = sf.geometry;
      const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
      for (const poly of polys) {
        if (pointInRing(mx, my, poly[0])) { isInSafezone = true; break; }
      }
      if (isInSafezone) break;
    }
    if (isInSafezone) removedIdxSet.add(idx);
    else kept.push(quad);
  });
  return { filtered: { ...quadsGeoJSON, features: kept }, removedIdxSet };
}

const MEDALS = ['🥇', '🥈', '🥉'];
const PAGE_SIZE = 6;

// Build point features from zip centroids for the MapLibre native heatmap layer.
// Each point carries a _weight (0–1) derived from the zip's tier so the Gaussian
// blur produces smooth topographic heat gradients across the entire map.
function buildHeatUnderlayPoints(geoData, tiers) {
  const features = [];
  // Rebalanced weights: reduce top-tier (red) so mid bands (green/yellow/orange) can form thicker rings
  const baseWeights = [0, 0.10, 0.15, 0.20, 0.26];
  geoData.features.forEach((f, i) => {
    if (f.properties._special) return;
    const tier = tiers[i] ?? 0;
    if (tier < 0) return;
    const [cx, cy] = getGeomCentroid(f.geometry);
    const heat = typeof f.properties._heat === 'number' ? f.properties._heat : (tier / 4);
    // single centroid per ZCTA — weight scaled slightly by normalized heat
    const weight = (baseWeights[tier] || 0) * (1 + heat * 0.45);
    features.push({
      type: 'Feature',
      properties: { _weight: weight, _tier: tier, _origin_zcta: f.properties.MODZCTA },
      geometry: { type: 'Point', coordinates: [cx, cy] },
    });
  });
  return { type: 'FeatureCollection', features };
}

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
export default function MapView({ events, headerCollapsed = false }) {
  const [topoOn, setTopoOn] = useState(() => {
    try {
      const v = localStorage.getItem('lapuff_topo_on');
      return v === null ? true : v === '1';
    } catch (e) {
      return true;
    }
  });
  const containerRef    = useRef(null);
  // Public base (Vite base) so assets resolve correctly when app is served under a subpath
  const PUBLIC_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const hoveredIdRef    = useRef(null);
  const locationMarkerRef = useRef(null);
  const heatmapRef      = useRef(false);
  const threeDRef       = useRef(false);
  const tiersRef        = useRef([]);
  const timespanIdxRef  = useRef(4);
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
  const boroughAvgTiersRef = useRef([]);
  const boroughQuadFilterRef = useRef(null); // Pre-computed Set of skeleton segment indices removed by safezone filter
  const zctaSkeletonRef    = useRef(null);
  const boroughSkeletonRef = useRef(null);
  // Tier computation cache — skip expensive buildZipEventMap + computeTiers when only paint deps change
  const cachedTierDataRef   = useRef({ events: null, timespanIdx: -1, geoData: null, zipMap: null, maxCount: 0, tiers: [] });
  // Pre-computed tiers for all 5 timespans — slider reads from here (no recomputation)
  const precomputedTiersRef = useRef(null); // { [timespanIdx]: { tiers, zipMap, maxCount } }
  // FGB building data — full-file load, cached forever after first parse
  const buildingFGBRef      = useRef(null);  // parsed FeatureCollection (all 381K buildings)
  const buildingZctaMapRef  = useRef(null);  // Int16Array: building index → ZCTA feature index (-1 = not found)
  const fgbLoadingRef       = useRef(false); // prevents concurrent loads
  // Real3D layer lifecycle — create once, toggle visibility
  const real3dLayersCreatedRef = useRef(false); // true after first initReal3DLayers
  // Tracks whether _tier_0.._tier_4 have been baked into building properties
  const buildingTiersBakedRef = useRef(false);

  // Persist topo toggle across sessions
  useEffect(() => {
    try { localStorage.setItem('lapuff_topo_on', topoOn ? '1' : '0'); } catch (e) { /* ignore */ }
  }, [topoOn]);

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
  // Cache status for FGB loading indicator: 'idle' | 'building' | 'paused' | 'done'
  const [fgbCacheStatus, setFgbCacheStatus] = useState('idle');
  const [fgbCacheProgress, setFgbCacheProgress] = useState(0); // 0-100

  // Auto-dismiss cache indicator 2 seconds after "done"
  useEffect(() => {
    if (fgbCacheStatus !== 'done') return;
    const t = setTimeout(() => setFgbCacheStatus('idle'), 2000);
    return () => clearTimeout(t);
  }, [fgbCacheStatus]);

  heatmapRef.current   = heatmap;
  threeDRef.current    = threeD;
  real3DRef.current    = real3D;
  satelliteRef.current = satellite;
  timespanIdxRef.current = timespanIdx;
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
      const features = [];
      let safezoneCounter = 0;

      data.features.forEach((f, i) => {
        let zip = String(f.properties.MODZCTA || f.properties.modzcta || '');

        if (isSpecialZip(zip) && f.geometry?.type === 'MultiPolygon') {
          // Split each sub-polygon into its own individually numbered safezone feature.
          // This lets events and hover labels target the exact zone (e.g. "Safe Zone 3").
          f.geometry.coordinates.forEach((polyCoords, pi) => {
            const szNum = ++safezoneCounter;
            const modzcta = `SAFEZONE_${szNum}`;
            let szFeature = {
              ...f,
              geometry: { type: 'Polygon', coordinates: polyCoords },
              properties: {
                ...f.properties,
                MODZCTA: modzcta,
                _special: true,
                _safezoneNum: szNum,
                label: `Safezone ${szNum}`,
              },
            };
            szFeature = enforceGeoJSONWinding(szFeature);
            features.push({ ...szFeature, id: i * 1000 + pi });
          });
        } else {
          // Normal zip or already-encoded safezone
          if (isSpecialZip(zip) && !zip.startsWith('SAFEZONE')) {
            // Single-polygon special zip — assign as SAFEZONE_N
            const szNum = ++safezoneCounter;
            const modzcta = `SAFEZONE_${szNum}`;
            f = { ...f, properties: { ...f.properties, MODZCTA: modzcta, _special: true, _safezoneNum: szNum, label: `Safezone ${szNum}` } };
          }
          // D6: enforce correct GeoJSON winding on all features
          f = enforceGeoJSONWinding(f);
          features.push({ ...f, id: i });
        }
      });
      setGeoData({ ...data, features });
      setAdjacency(buildAdjacency(features));
      // Build ZCTA skeleton cache once — precomputes normals, miter vectors per ring
      zctaSkeletonRef.current = buildZctaSkeleton({ ...data, features });
    });
  }, []);

  // Borough GeoJSON — load once
  useEffect(() => {
    fetch(BOROUGH_GEOJSON_URL).then(r => r.json()).then(data => {
      setBoroughGeoData(data);
      boroughSkeletonRef.current = buildBoroughSkeleton(data);
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
      antialias: true,
    });
    // Place navigation controls in the bottom-right and give extra padding + slight scale for accessibility
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.once('load', () => {
      const navContainer = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
      if (navContainer) {
        navContainer.style.bottom = '28px';
        navContainer.style.right = '20px';
        navContainer.style.transformOrigin = 'bottom right';
        navContainer.style.transform = 'scale(1.08)';
      }
    });
    mapRef.current = map;
    map.on('load', () => {
      map.getCanvas().style.backgroundColor = 'transparent';
      setMapReady(true);
    });
    return () => {
      map.remove(); mapRef.current = null;
    };
  }, []);

  // ── Layer setup ────────────────────────────────────────────────────────────
  function addLayers(map, data, sat) {
    if (!map || !data || map.getSource('zcta')) return;
    // Read current 3D state so initial paint values are correct even on re-add (satellite swap)
    const is3D = threeDRef.current;
    const isReal3D = real3DRef.current;
    map.addSource('zcta', { type: 'geojson', data, generateId: false });



    // Topographic heat underlay — MapLibre native heatmap from multiple centroids per zip.
    // Single heatmap layer will receive multiple point features per zip so each local
    // peak produces its own ring and they blend naturally via density.
    if (!map.getSource('heat-underlay')) {
      map.addSource('heat-underlay', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'heat-underlay', type: 'heatmap', source: 'heat-underlay',
        paint: {
          // Dynamic weight multiplier per-tier based on zoom:
          // - Tier 4 (red) : reduced on zoom 9→11, slightly increased at zoom >=11
          // - Other tiers: baseline, but scaled up 20% at zoom >=11 to enlarge all elements
          'heatmap-weight': ['coalesce', ['get', '_weight'], 0],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 11, 1.6, 13, 1.6],
          // radius is managed dynamically (meters→pixels) elsewhere so set a fallback
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 200, 11, 185, 12, 185],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.03, '#092f6f',    // dark-blue (deep)
            0.09, '#00a2e8',    // blue (band)
            0.12, '#00dd66',    // green (wider band)
            0.22, '#f5c800',    // yellow (wider band — golden, not lime)
            0.36, '#ff9a00',    // orange (wider band)
            0.55, '#ff4d4d',    // red-orange
            0.75, '#cc0d00',    // red
          ],
          'heatmap-opacity': (heatmap && topoOn) ? 0.50 : 0,
        },
      });
    }

    // Extrusion base — fully opaque, blocks everything below.
    // Filter excludes _special (safe zone) features — handled solely by zcta-safezone-extrusion.
    map.addLayer({
      id: 'zcta-extrude', type: 'fill-extrusion', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        'fill-extrusion-color': '#1a0505',
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0,
      },
    });

    // Floor — thin slab inside each 3D block, visible only when camera enters the block.
    // Same color as the block but half opacity. Height 1m (base 0) avoids z-fighting.
    // Occluded by zcta-extrude walls when viewed from outside.
    // Filter excludes _special (safe zone) features — handled solely by zcta-safezone-extrusion.
    map.addLayer({
      id: 'zcta-floor', type: 'fill-extrusion', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        'fill-extrusion-color': '#1a0505',
        'fill-extrusion-height': 1,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,
        'fill-extrusion-vertical-gradient': false,
      },
    });

    // Flat fill — slightly transparent dark red to differentiate regions from bg without solid fill.
    // Excludes _special (safe zone) features — those are handled by zcta-safezone-extrusion below.
    map.addLayer({
      id: 'zcta-fill', type: 'fill', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        'fill-color': '#1a0505',
        'fill-opacity': sat ? 0.38 : 0.55,
      },
    });

    // D1/D2: Safe zone extrusion — minimal height (1m) so features (parks, water, buildings)
    // above it remain visible. White fill serves as ground plane; features sit on top.
    // At 0° pitch a 1m extrusion is visually flat top-down.
    map.addLayer({
      id: 'zcta-safezone-extrusion', type: 'fill-extrusion', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: {
        // Purple on hover, white otherwise — consistent hover feedback in all 3D modes
        'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'hovered'], false], '#7C3AED', '#ffffff'],
        'fill-extrusion-height': 1,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0,
        'fill-extrusion-vertical-gradient': false,
      },
    });

    // Hover — electric purple (2D fill overlay, non-safezone)
    map.addLayer({
      id: 'zcta-hover', type: 'fill', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'fill-color': '#7C3AED', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.5, 0] },
    });

    // Safezone hover — purple fill that captures mouse events (2D/Real3D)
    map.addLayer({
      id: 'zcta-safezone-hover', type: 'fill', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'fill-color': '#7C3AED', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.5, 0] },
    });

    // Cap — thin slab on top of each zip block, same polygon as the block (source: 'zcta').
    // Glows purple on hover in 3D mode only. 1:1 aligned with zcta-extrude by design.
    // Heights set dynamically in heatmap effect to sit exactly at the block top face.
    map.addLayer({
      id: 'zcta-cap', type: 'fill-extrusion', source: 'zcta',
      paint: {
        'fill-extrusion-color': '#9F67FF',
        'fill-extrusion-height': 1,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,
        'fill-extrusion-vertical-gradient': false,
      },
    });

    // Safe zone outline — hidden in 3D and Real3D modes (zcta-safezone-extrusion is sole renderer)
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': zctaLineWidthExpr(1.5), 'line-opacity': (is3D || isReal3D) ? 0 : 1 },
    });

    // Ground boundary glows (non-special) — hidden in 3D mode
    map.addLayer({
      id: 'zcta-line-glow2', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_GLOW, 'line-width': zctaLineWidthExpr(1.6), 'line-opacity': is3D ? 0 : (sat ? 0.25 : 0.35), 'line-blur': 10 },
    });
    map.addLayer({
      id: 'zcta-line-glow', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_COLOR, 'line-width': zctaLineWidthExpr(1.25), 'line-opacity': is3D ? 0 : (sat ? 0.55 : 0.75), 'line-blur': 3 },
    });
    map.addLayer({
      id: 'zcta-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_COLOR, 'line-width': zctaLineWidthExpr(1), 'line-opacity': is3D ? 0 : 1 },
    });

    // Upper 3D border — annular ring using createZctaOutlineGeoJSON.
    // Inner ring = raw MODZCTA coords (1:1 with zcta-extrude blocks). Outer ring = fullWidth outward.
    map.addSource('zcta-outline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: false, tolerance: 0.001 });
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

    // Borough outline — fill-extrusion annular rings at 22m height (below cold tier 30m).
    // Base outline width uses baseMeters=24 so outer perimeter is prominent.
    // Only visible at the outer NYC perimeter; zip blocks occlude internal borough borders.
    // Color is data-driven via _color property set on each feature before source update.
    if (!map.getSource('borough-source')) {
      map.addSource('borough-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: false, tolerance: 0.001 });
      map.addLayer({
        id: 'borough-outline', type: 'fill-extrusion', source: 'borough-source',
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', '_color'], OUTLINE_COLOR],
          'fill-extrusion-height': 32,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0,
          'fill-extrusion-vertical-gradient': false,
        },
      });
    }
    const handleZctaHover = e => {
      if (!e.features.length) return;
      const f = e.features[0];
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== f.id)
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
      hoveredIdRef.current = f.id;
      map.setFeatureState({ source: 'zcta', id: f.id }, { hovered: true });
      map.getCanvas().style.cursor = 'pointer';
      const zip = String(f.properties.MODZCTA || '');
      const isSafezone = !!f.properties._special;
      setHoveredZip(isSafezone ? `SAFE:${zip}` : zip);
      setTooltipPos({ x: e.point.x, y: e.point.y });
    };

    const handleZctaLeave = () => {
      if (hoveredIdRef.current !== null) {
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
        hoveredIdRef.current = null;
      }
      map.getCanvas().style.cursor = '';
      setHoveredZip(null); setTooltipPos(null);
    };

    const handleZctaClick = e => {
      if (!e.features.length) return;
      const f = e.features[0];
      const zip = String(f.properties.MODZCTA || '');
      const isSafezone = !!f.properties._special;
      openSidePanel(isSafezone ? `SAFE:${zip}` : zip);
      openHologram(f);
    };

    layerHandlersRef.current = { handleZctaHover, handleZctaLeave, handleZctaClick };

    // Register hover/click on both regular zips and safezone areas
    map.on('mousemove', 'zcta-fill', handleZctaHover);
    map.on('mouseleave', 'zcta-fill', handleZctaLeave);
    map.on('click', 'zcta-fill', handleZctaClick);
    map.on('mousemove', 'zcta-safezone-hover', handleZctaHover);
    map.on('mouseleave', 'zcta-safezone-hover', handleZctaLeave);
    map.on('click', 'zcta-safezone-hover', handleZctaClick);
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

  // Pre-create Real3D layers at map init so first toggle is instant (just a visibility flip).
  // Runs right after addLayers (same deps, defined after it — React fires in order).
  // All layers are immediately hidden. Zero GPU cost for hidden layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData) return;
    if (real3dLayersCreatedRef.current) return; // already created (shouldn't happen, safety guard)
    initReal3DLayers(map, heatmapRef.current, timespanIdxRef.current ?? 4);
    // Hide immediately — user hasn't toggled Real3D on yet
    setReal3DLayersVisible(map, false);
  }, [mapReady, geoData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start background FGB cache building once map + ZCTA data are ready.
  // Runs once per session — Cache API persists data across sessions.
  useEffect(() => {
    if (!mapReady || !geoData) return;
    buildFGBCache();
  }, [mapReady, geoData]);

  // Pre-compute tiers for all 5 timespans in background.
  // This makes time slider changes near-instant: just read from pre-computed cache.
  useEffect(() => {
    if (!geoData || !adjacency || !events?.length) return;
    let cancelled = false;
    (async () => {
      const result = {};
      for (let idx = 0; idx < TIMESPAN_STEPS.length; idx++) {
        if (cancelled) return;
        const { zipMap, maxCount } = buildZipEventMap(events, TIMESPAN_STEPS[idx].days);
        const tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
        result[idx] = { tiers, zipMap, maxCount };
        await new Promise(r => setTimeout(r, 0));
      }
      if (!cancelled) {
        precomputedTiersRef.current = result;
        // Bake tiers into buildings if FGB data + ZCTA index are ready
        if (buildingFGBRef.current && buildingZctaMapRef.current) {
          bakeAllTiersIntoBuildings();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [events, geoData, adjacency]);

  // Manage hover layers based on 3D/Real3D state.
  // 3D: hover on zcta-extrude + zcta-safezone-extrusion (fill-extrusion layers).
  // 2D: hover on zcta-fill + zcta-safezone-hover (fill layers).
  // Real3D: hover on zcta-fill + zcta-safezone-hover + zcta-safezone-extrusion
  //         (safezone extrusion covers the 2D fill, so we need both).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer('zcta-fill')) return;
    
    const { handleZctaHover, handleZctaLeave, handleZctaClick } = layerHandlersRef.current;
    if (!handleZctaHover) return;

    // Clear all previous hover registrations first
    ['zcta-fill', 'zcta-extrude', 'zcta-safezone-hover', 'zcta-safezone-extrusion'].forEach(layerId => {
      if (!map.getLayer(layerId)) return;
      map.off('mousemove', layerId, handleZctaHover);
      map.off('mouseleave', layerId, handleZctaLeave);
      map.off('click', layerId, handleZctaClick);
    });

    if (threeD) {
      // 3D mode: hover on extruded zips + safezone extrusion
      map.on('mousemove', 'zcta-extrude', handleZctaHover);
      map.on('mouseleave', 'zcta-extrude', handleZctaLeave);
      map.on('click', 'zcta-extrude', handleZctaClick);
      map.on('mousemove', 'zcta-safezone-extrusion', handleZctaHover);
      map.on('mouseleave', 'zcta-safezone-extrusion', handleZctaLeave);
      map.on('click', 'zcta-safezone-extrusion', handleZctaClick);
    } else {
      // 2D / Real3D: hover on flat fill + safezone hover fill
      map.on('mousemove', 'zcta-fill', handleZctaHover);
      map.on('mouseleave', 'zcta-fill', handleZctaLeave);
      map.on('click', 'zcta-fill', handleZctaClick);
      map.on('mousemove', 'zcta-safezone-hover', handleZctaHover);
      map.on('mouseleave', 'zcta-safezone-hover', handleZctaLeave);
      map.on('click', 'zcta-safezone-hover', handleZctaClick);
      // In Real3D, safezone extrusion covers the 2D fill — also register on it
      if (real3D && map.getLayer('zcta-safezone-extrusion')) {
        map.on('mousemove', 'zcta-safezone-extrusion', handleZctaHover);
        map.on('mouseleave', 'zcta-safezone-extrusion', handleZctaLeave);
        map.on('click', 'zcta-safezone-extrusion', handleZctaClick);
      }
    }
  }, [threeD, real3D, mapReady]);

  // ── Main heatmap + 3D update ──────────────────────────────────────────────
  // FIX ADDITIVE STATE: added `styleVersion` and `real3D` to deps so this re-runs
  // after satellite style swap (which increments styleVersion) and after real3D changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData || !map.getLayer('zcta-fill')) return;

    // Cache tier computations — only recompute when data deps change (events, timespan, geoData).
    // Paint-only toggles (satellite, topoOn, threeD) skip the expensive buildZipEventMap + computeTiers.
    // Uses pre-computed tiers if available (from background pre-computation).
    const cached = cachedTierDataRef.current;
    const dataChanged = events !== cached.events || timespanIdx !== cached.timespanIdx || geoData !== cached.geoData;
    let zipMap, maxCount, tiers, withHeat;

    if (dataChanged) {
      // Try pre-computed first (instant). Fallback to live computation.
      const precomputed = precomputedTiersRef.current?.[timespanIdx];
      if (precomputed) {
        ({ zipMap, maxCount, tiers } = precomputed);
      } else {
        ({ zipMap, maxCount } = buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days));
        tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
      }
      withHeat = {
        ...geoData,
        features: geoData.features.map((f, i) => {
          const tier = tiers[i];
          const zip = String(f.properties.MODZCTA || '');
          const rawHeat = f.properties._special ? 0 : normalizeHeat(zipMap[zip]?.length || 0, maxCount);
          return { ...f, properties: { ...f.properties, _heat: rawHeat, _tier: tier < 0 ? 0 : tier } };
        }),
      };
      cachedTierDataRef.current = { events, timespanIdx, geoData, zipMap, maxCount, tiers, withHeat };
      tiersRef.current = tiers;
      withHeatRef.current = withHeat;
      if (map.getSource('zcta')) map.getSource('zcta').setData(withHeat);
      if (map.getSource('zcta-outline')) {
        map.getSource('zcta-outline').setData(createZctaOutlineGeoJSON(withHeat, getZoomAwareOutlineWidth(map, undefined, threeD)));
      }
    } else {
      ({ zipMap, maxCount, tiers, withHeat } = cached);
    }

    // Non-heatmap 2D/Real3D: restore standard line colors
    if (!threeD && !heatmap) {
      try {
        if (map.getLayer('zcta-line')) map.setPaintProperty('zcta-line', 'line-color', OUTLINE_COLOR);
        if (map.getLayer('zcta-line-glow')) map.setPaintProperty('zcta-line-glow', 'line-color', OUTLINE_COLOR);
        if (map.getLayer('zcta-line-glow2')) map.setPaintProperty('zcta-line-glow2', 'line-color', OUTLINE_GLOW);
        if (map.getLayer('zcta-safe-line')) map.setPaintProperty('zcta-safe-line', 'line-color', '#000000');
      } catch (e) { /* ignore */ }
    }

    // Topographic heat underlay — update point data from zip centroids.
    // Enabled when heatmap is ON and the topo toggle is on. Visible in ALL modes (2D, 3D, Real3D).
    // No separate canvas needed — `['within']` handles NYC restriction, topo glow radiates naturally.
    if (map.getSource('heat-underlay')) {
      if (heatmap && topoOn) {
        map.getSource('heat-underlay').setData(buildHeatUnderlayPoints(withHeat, tiers));
        map.setPaintProperty('heat-underlay', 'heatmap-opacity', 0.50);
      } else {
        map.setPaintProperty('heat-underlay', 'heatmap-opacity', 0);
      }
    }

    // Fix 11: When satellite ON + 2D/Real3D, boost orange to be more fluorescent/visible
    const orangeColor = (satellite && !threeD) ? '#ff7700' : HEAT_COLORS.orange;
    const heatColorExpr = [
      'case', ['boolean', ['get', '_special'], false], '#ffffff',
      ['step', ['get', '_tier'], HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm, 3, orangeColor, 4, HEAT_COLORS.hot],
    ];

    // Wrap color expression with hover state check for 3D mode
    const withHoverColor = (baseExpr) => {
      return ['case', ['boolean', ['feature-state', 'hovered'], false], '#7C3AED', baseExpr];
    };

    // Height expressions — heatmap 3D. Safe zones excluded via filter on zcta-extrude/zcta-floor.
    const extrudeH    = ['step', ['get', '_tier'], 30, 1, 200, 2, 700, 3, 1600, 4, 2800];
    // Cap sits 1m above the block top — same tiers +1
    const extrudeHCap = ['step', ['get', '_tier'], 31, 1, 201, 2, 701, 3, 1601, 4, 2801];
    // Flat 3D
    const flatH    = 400;
    const flatHCap = 401;
    // Cap opacity expression — visible (glow purple) only on hover in 3D mode
    const capHoverOpacity = ['case', ['boolean', ['feature-state', 'hovered'], false], 0.72, 0];

    if (heatmap) {
      map.setPaintProperty('zcta-fill', 'fill-color', heatColorExpr);
      // FIX ADDITIVE STATE: heatmap fill — 0 when 3D is on (extrusion takes over),
      // semi-transparent when satellite on, solid otherwise.
      // In 2D and Real3D heatmap modes (threeD false) make fills more transparent; leave 3D unchanged
        if (threeD) {
          map.setPaintProperty('zcta-fill', 'fill-opacity', 0);
        } else {
          // 1a/1b: solid fill if heatmap on, satellite off, topo off; else transparent
        if (heatmap && !satellite && !topoOn) {
          map.setPaintProperty('zcta-fill', 'fill-opacity', 1.0);
        } else {
          map.setPaintProperty('zcta-fill', 'fill-opacity', satellite || topoOn ? 0.35 : 0.45);
        }
        }


      if (threeD) {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 0);
        // Safezone extrusion is the sole white renderer — ensure it stays visible in all 3D/Real3D modes
        if (map.getLayer('zcta-safezone-extrusion')) map.setPaintProperty('zcta-safezone-extrusion', 'fill-extrusion-opacity', 1.0);

        const extrudeColorExpr = ['step', ['get', '_tier'], HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm, 3, HEAT_COLORS.orange, 4, HEAT_COLORS.hot];
        // FIX SATELLITE: 3D+heatmap extrusion stays solid (1.0) even when satellite is on
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', withHoverColor(extrudeColorExpr));
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', extrudeH);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0.72);

        // Floor: inside-block slab, same color at half opacity — visible when camera enters block
        map.setPaintProperty('zcta-floor', 'fill-extrusion-color', withHoverColor(extrudeColorExpr));
        map.setPaintProperty('zcta-floor', 'fill-extrusion-height', 1);
        map.setPaintProperty('zcta-floor', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-floor', 'fill-extrusion-opacity', 0.36);

        // Cap: flat slab 1m above block top — glows purple on hover, aligns with zcta-outline boundary
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', extrudeHCap);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', extrudeH);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', capHoverOpacity);

        // Hide all 2D zip lines in 3D mode — no depth test against fill-extrusions (x-ray fix)
        map.setPaintProperty('zcta-line',       'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow',  'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        // 2D heatmap — safe-line visible only when NOT in Real3D (where safezone-extrusion handles it)
        map.setPaintProperty('zcta-safe-line', 'line-opacity', real3D ? 0 : 1);
        if (map.getLayer('zcta-safezone-extrusion')) map.setPaintProperty('zcta-safezone-extrusion', 'fill-extrusion-opacity', 1.0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', '#1a0505');
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0);
        // Floor disabled in heatmap 2D
        map.setPaintProperty('zcta-floor', 'fill-extrusion-opacity', 0);
        // Cap disabled in 2D
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', 1);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', 0);
        map.setPaintProperty('zcta-line',      'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2','line-opacity', satellite ? 0.25 : 0.35);
      }
    } else {
      // No heatmap — use dark red theme (zcta-fill filter excludes _special, so no case needed)
      map.setPaintProperty('zcta-fill', 'fill-color', '#1a0505');
      // FIX ADDITIVE STATE / 3D ARTIFACTING: zero opacity in 3D so the flat fill
      // doesn't appear as stray 2D surfaces beneath or through extrusions.
      // In 2D and Real3D non-heatmap modes make the dark fill more visible; leave 3D unchanged
        if (threeD) {
          map.setPaintProperty('zcta-fill', 'fill-opacity', 0);
        } else {
          map.setPaintProperty('zcta-fill', 'fill-opacity', satellite ? 0.65 : 0.75); // unchanged, more visible dark fill for non-heatmap
        }

      if (threeD) {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 0);
        // Safezone extrusion is the sole white renderer — ensure it stays visible in all 3D/Real3D modes
        if (map.getLayer('zcta-safezone-extrusion')) map.setPaintProperty('zcta-safezone-extrusion', 'fill-extrusion-opacity', 1.0);
        // FIX SATELLITE: 3D no-heatmap extrusion is semi-transparent when satellite is on
        const flatColorExpr = '#220202';
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', withHoverColor(flatColorExpr));
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', flatH);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0.72);

        // Floor: inside-block slab, same color at half opacity — visible when camera enters block
        map.setPaintProperty('zcta-floor', 'fill-extrusion-color', withHoverColor(flatColorExpr));
        map.setPaintProperty('zcta-floor', 'fill-extrusion-height', 1);
        map.setPaintProperty('zcta-floor', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-floor', 'fill-extrusion-opacity', 0.36);

        // Cap: flat slab 1m above block top — glows purple on hover, aligns with zcta-outline boundary
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', flatHCap);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', flatH);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', capHoverOpacity);

        // Hide all 2D zip lines in 3D mode — no depth test against fill-extrusions (x-ray fix)
        map.setPaintProperty('zcta-line',       'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow',  'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        // 2D non-heatmap — safe-line visible only when NOT in Real3D
        map.setPaintProperty('zcta-safe-line', 'line-opacity', real3D ? 0 : 1);
        if (map.getLayer('zcta-safezone-extrusion')) map.setPaintProperty('zcta-safezone-extrusion', 'fill-extrusion-opacity', 1.0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', '#1a0505');
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0);
        // Floor disabled in non-heatmap 2D
        map.setPaintProperty('zcta-floor', 'fill-extrusion-opacity', 0);
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
    // Fix 7: Nearly solid purple selection when satellite off + (2D or Real3D). Keep 0.5 for satellite on.
    const hoverOpacity = satellite ? 0.5 : 0.85;
    map.setPaintProperty('zcta-hover', 'fill-opacity', threeD ? 0 : ['case', ['boolean', ['feature-state', 'hovered'], false], hoverOpacity, 0]);

    // Re-apply line-width expressions for 2D/Real3D (GPU-evaluated per-frame — defensive re-assert)
    if (!threeD) {
      try {
        if (map.getLayer('zcta-line'))       map.setPaintProperty('zcta-line',       'line-width', zctaLineWidthExpr(1));
        if (map.getLayer('zcta-line-glow'))  map.setPaintProperty('zcta-line-glow',  'line-width', zctaLineWidthExpr(1.25));
        if (map.getLayer('zcta-line-glow2')) map.setPaintProperty('zcta-line-glow2', 'line-width', zctaLineWidthExpr(1.6));
        if (map.getLayer('zcta-safe-line'))  map.setPaintProperty('zcta-safe-line',  'line-width', zctaLineWidthExpr(1.5));
      } catch (e) { /* ignore */ }
    }

    // Upper 3D border color: themed to zip's heat tier when heatmap on, red when off
    const upperBorderColorExpr = heatmap ? [
      'case', ['boolean', ['get', '_special'], false], '#333333',
      ['step', ['get', '_tier'], HEAT_DARK_COLORS.cold, 1, HEAT_DARK_COLORS.cool, 2, HEAT_DARK_COLORS.warm, 3, HEAT_DARK_COLORS.orange, 4, HEAT_DARK_COLORS.hot],
    ] : OUTLINE_COLOR;

    if (map.getSource('zcta-outline')) {
      // T3: zoom-interpolated opacity — reduces fringing at low zoom, full at close zoom
      const outlineOpacity = ['interpolate', ['linear'], ['zoom'], 9, 0.70, 13, 0.98];
      map.setPaintProperty('zcta-outline', 'fill-extrusion-opacity', threeD ? outlineOpacity : 0);
      if (threeD) {
        map.setPaintProperty('zcta-outline', 'fill-extrusion-color', upperBorderColorExpr);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-base', heatmap ? extrudeH : flatH);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-height', ['+', heatmap ? extrudeH : flatH, 18]);
      } else {
        map.setPaintProperty('zcta-outline', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-height', 0);
      }
    }

    // Borough outline — visible in 3D and Real3D modes, color based on avg borough tier.
    // In Real3D: fill-extrusion renders in the GPU 3D pass, sits above the stencil and
    // occludes correctly behind taller buildings via the depth buffer.
    if (map.getSource('borough-source')) {
      if ((threeD || real3D) && boroughGeoDataRef.current) {
        const avgTiers = computeBoroughAvgTiers(
          tiers,
          zipBoroughMapRef.current,
          boroughGeoDataRef.current.features.length
        );
        boroughAvgTiersRef.current = avgTiers;
        const coloredBorough = buildColoredBoroughFeatures(boroughGeoDataRef.current, avgTiers, heatmap);
        boroughWithColorRef.current = coloredBorough;
        // Generate quads and remove quads overlapping safezone areas (interior edges preserved)
        let boroughQuads = createOutlineGeoJSON(coloredBorough, getZoomAwareOutlineWidth(map, 18, threeD || real3D));
        const safezoneFeatures = geoData?.features?.filter(f => f.properties?._special) || [];
        const { filtered, removedIdxSet } = removeSafezoneOverlapQuads(boroughQuads, safezoneFeatures);
        boroughQuadFilterRef.current = removedIdxSet;
        map.getSource('borough-source').setData(filtered);
        // Borough color: read baked _color from features — mid-brightness for visibility
        map.setPaintProperty('borough-outline', 'fill-extrusion-color', ['coalesce', ['get', '_color'], OUTLINE_COLOR]);
        // Base 0 → full extrusion blocks from ground to max height.
        // Height stagger by _boroughIdx * 0.1m prevents Z-fighting at shared top edges.
        map.setPaintProperty('borough-outline', 'fill-extrusion-base',   0);
        map.setPaintProperty('borough-outline', 'fill-extrusion-height', ['+', 32, ['*', 0.1, ['coalesce', ['get', '_boroughIdx'], 0]]]);
        // Zoom-interpolated opacity — softens thin extrusions at distance to reduce pixelation
        map.setPaintProperty('borough-outline', 'fill-extrusion-opacity',
          ['interpolate', ['linear'], ['zoom'], 9, 0.4, 11, 1.0]);
      } else {
        map.setPaintProperty('borough-outline', 'fill-extrusion-opacity', 0);
        boroughWithColorRef.current = null;
        boroughAvgTiersRef.current = [];
        boroughQuadFilterRef.current = null;
      }
    }

    // Real3D: when heatmap/timespan changes, rebuild all Real3D layers with updated tiers/colors.
    // applyReal3DLayers handles this via the dedicated Real3D useEffect below.
    // Only update landuse proxy here (safe to set without full rebuild).
    if (real3D && map.getLayer('real3d-landuse-baseplate')) {
      map.setPaintProperty('real3d-landuse-baseplate', 'fill-color', baseplateColorExpr(heatmap, timespanIdx));
    }
  }, [heatmap, topoOn, threeD, real3D, timespanIdx, events, geoData, boroughGeoData, mapReady, satellite, adjacency, styleVersion]);

  // Manage heat-underlay radius so its real-world meter reach stays constant between zoom 9.5 and 14.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer) return;
    // sentinel check: ensure our heat-underlay layer exists
    if (!map.getLayer('heat-underlay')) return;
    const center = map.getCenter();
    const refLat = center && typeof center.lat === 'number' ? center.lat : 40.71;
    const metersPerPixel = (z) => 156543.03392 * Math.cos(refLat * Math.PI / 180) / Math.pow(2, z);
    // Preserve the original desiredMeters computation (based on px@12 and prior scale)
    const mpp12 = metersPerPixel(12);
    const ORIGINAL_PX_AT_12 = 220;
    const FROZEN_PX_AT_12 = Math.round(ORIGINAL_PX_AT_12 * 0.7); // 154px
    const SCALE_ABOVE_11 = 1.44; // cumulative scale used historically
    const desiredMeters = FROZEN_PX_AT_12 * mpp12 * SCALE_ABOVE_11; // apply cumulative scale to real-world reach

    // Freeze frame bounds: within [freezeLower, freezeUpper] we keep a deterministic
    // constant rendering frame (radius + intensity + weight multipliers) so close zooms
    // do not reflow the heatmap.
    const freezeLower = 9.5;
    const freezeUpper = 16; // safety cap (expanded per user request)
    const pxFreezeLowerEquiv = Math.max(1, desiredMeters / metersPerPixel(freezeLower));
    const pxFreezeUpperEquiv = Math.max(1, desiredMeters / metersPerPixel(freezeUpper));

    // Intensity helper: mirrors previous interpolate behavior for zooms < freezeLower
    const INTERP_INTENSITY = (z) => {
      if (z <= 8) return 1.2;
      if (z >= 13) return 1.6;
      // linear between 8->11 -> 1.2->1.6, clamp thereafter
      if (z <= 11) return 1.2 + (1.6 - 1.2) * ((z - 8) / (11 - 8));
      return 1.6;
    };
    const FROZEN_INTENSITY = 1.6;

    const updateHeatRadius = () => {
      if (!map.getLayer('heat-underlay')) return;
      const zoom = map.getZoom();

      let px;
      // Constant (frozen) behavior between freezeLower and freezeUpper inclusive
      if (zoom >= freezeLower && zoom <= freezeUpper) {
        px = Math.max(1, Math.round(desiredMeters / metersPerPixel(zoom)));
      } else if (zoom > freezeUpper) {
        // Cap at the equivalent px for freezeUpper to avoid uncontrolled growth beyond safety range
        px = Math.max(1, Math.round(pxFreezeUpperEquiv));
      } else {
        // For any zoom < freezeLower: use scaled behavior relative to freezeLower
        px = Math.max(1, Math.round(Math.max(pxFreezeLowerEquiv * 1.5, desiredMeters / metersPerPixel(Math.max(zoom, freezeLower)))));
      }

      if (!Number.isFinite(px) || px < 1) px = Math.max(1, Math.round(desiredMeters / metersPerPixel(Math.max(zoom, freezeLower))));
      map.setPaintProperty('heat-underlay', 'heatmap-radius', px);

      // Compute tier-specific multipliers for weights and lock intensity inside freeze range
      try {
        const intensity = (zoom >= freezeLower) ? FROZEN_INTENSITY : INTERP_INTENSITY(zoom);
        map.setPaintProperty('heat-underlay', 'heatmap-intensity', intensity);

        // Use frozen multipliers so relative peak weighting is deterministic
        const multiplierRed = 1.35;
        const multiplierOthers = 1.20;
        const weightExpr = ['case', ['==', ['get', '_tier'], 4], ['*', ['coalesce', ['get', '_weight'], 0], multiplierRed], ['*', ['coalesce', ['get', '_weight'], 0], multiplierOthers]];
        map.setPaintProperty('heat-underlay', 'heatmap-weight', weightExpr);
      } catch (e) {
        // ignore paint errors (layer may not exist yet)
      }
    };
    updateHeatRadius();
    map.on('zoom', updateHeatRadius);
    return () => { try { map.off('zoom', updateHeatRadius); } catch (e) { /* ignore */ } };
  }, [mapReady, heatmap, topoOn]);


  // 3D pitch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.easeTo({ pitch: threeD ? 48 : 0, bearing: threeD ? -17 : 0, duration: 700 });
  }, [threeD, mapReady]);

  // Outline ring width regeneration on zoom AND pitch — covers 3D and Real3D modes.
  // ZCTA outline only rebuilds in 3D (layer only exists in 3D). Borough outline rebuilds in both.
  // Fires synchronously on zoom tick — skeleton cache is fast enough that RAF debounce just adds visible lag.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let prevZoom = map.getZoom();
    const onZoom = () => {
      const is3D  = threeDRef.current;
      const isR3D = real3DRef.current;
      // 2D/Real3D: line-width is a MapLibre expression (GPU-evaluated per-frame) — no JS update needed.
      if (!is3D && !isR3D) { prevZoom = map.getZoom(); return; }
      if (!is3D && isR3D)  { prevZoom = map.getZoom(); }
      // ZCTA outline — 3D only (layer does not exist in Real3D)
      if (is3D && map.getSource('zcta-outline')) {
        if (zctaSkeletonRef.current && withHeatRef.current) {
          const overrides = withHeatRef.current.features.map(f => f.properties);
          map.getSource('zcta-outline').setData(
            generateZctaQuadsFromSkeleton(zctaSkeletonRef.current, getZoomAwareOutlineWidth(map, undefined, true), overrides)
          );
        } else if (withHeatRef.current) {
          map.getSource('zcta-outline').setData(createZctaOutlineGeoJSON(withHeatRef.current, getZoomAwareOutlineWidth(map, undefined, true)));
        }
      }
      // Borough outline — 3D and Real3D. Uses pre-computed filter index for safezone fix.
      if ((is3D || isR3D) && map.getSource('borough-source')) {
        const filterSet = boroughQuadFilterRef.current;
        if (boroughSkeletonRef.current && boroughWithColorRef.current) {
          const overrides = boroughWithColorRef.current.features.map(f => f.properties);
          let quads = generateBoroughQuadsFromSkeleton(boroughSkeletonRef.current, getZoomAwareOutlineWidth(map, 18, true), overrides);
          if (filterSet && filterSet.size > 0) {
            quads = { ...quads, features: quads.features.filter((_, i) => !filterSet.has(i)) };
          }
          map.getSource('borough-source').setData(quads);
        } else if (boroughWithColorRef.current) {
          let quads = createOutlineGeoJSON(boroughWithColorRef.current, getZoomAwareOutlineWidth(map, 18, true));
          if (filterSet && filterSet.size > 0) {
            quads = { ...quads, features: quads.features.filter((_, i) => !filterSet.has(i)) };
          }
          map.getSource('borough-source').setData(quads);
        }
      }
      // Real3D: confirm building/baseplate colors when crossing into render zoom ranges.
      // This guards against stale paint expressions after zoom-driven layer transitions.
      if (isR3D && heatmapRef.current) {
        const zoom = map.getZoom();
        const crossedBaseplates = (prevZoom < 13 && zoom >= 13) || (prevZoom >= 13 && zoom < 13);
        const crossedBuildings  = (prevZoom < 14 && zoom >= 14) || (prevZoom >= 14 && zoom < 14);
        if (crossedBaseplates || crossedBuildings) refreshBuildingColors();
      }
      prevZoom = map.getZoom();
    };
    map.on('zoom', onZoom);
    map.on('pitch', onZoom);
    return () => { map.off('zoom', onZoom); map.off('pitch', onZoom); };
  }, [mapReady]);

  // SATELLITE: Single raster layer on main map — same approach for ALL modes (2D, 3D, Real3D).
  // Inserted at bottom of layer stack so it renders behind all other layers. No stencil blocks it.
  // No separate canvas, no camera sync. Moves naturally with main map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (satellite) {
      if (!map.getSource('sat-source')) {
        map.addSource('sat-source', {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
        });
      }
      if (!map.getLayer('sat-layer')) {
        const layers = map.getStyle().layers;
        const firstLayerId = layers.length > 0 ? layers[0].id : undefined;
        map.addLayer({
          id: 'sat-layer', type: 'raster', source: 'sat-source',
          paint: { 'raster-opacity': 1 },
        }, firstLayerId);
      }
    } else {
      if (map.getLayer('sat-layer')) map.removeLayer('sat-layer');
      if (map.getSource('sat-source')) map.removeSource('sat-source');
    }
  }, [satellite, real3D, mapReady]);


  // Building color expression — uses pre-computed _s7 (shade index mod 7).
  // For heatmap mode, tier comes from baked _tier_X property (X = timespanIdx).
  // GPU reads property directly — no feature-state needed, no CPU loop.
  const memoizedExprs = useRef({});

  function buildingColorExprByState(isHeatmap, tsIdx = 0) {
    const key = `bldg_${isHeatmap}_${tsIdx}`;
    if (memoizedExprs.current[key]) return memoizedExprs.current[key];

    let expr;
    if (!isHeatmap) {
      expr = ['case',
        ['==', ['get', '_s7'], 0], '#0d0101',
        ['==', ['get', '_s7'], 1], '#1a0303',
        ['==', ['get', '_s7'], 2], '#260606',
        ['==', ['get', '_s7'], 3], '#330909',
        ['==', ['get', '_s7'], 4], '#400c0c',
        ['==', ['get', '_s7'], 5], '#1f0404',
        '#7a1818',
      ];
    } else {
      // Tier from baked property — switches column on timespan change (GPU-only)
      const tierExpr = ['coalesce', ['get', `_tier_${tsIdx}`], 0];
      const shades = (tones) => ['case',
        ['==', ['get', '_s5'], 0], tones[0],
        ['==', ['get', '_s5'], 1], tones[1],
        ['==', ['get', '_s5'], 2], tones[2],
        ['==', ['get', '_s5'], 3], tones[3],
        tones[4],
      ];
      expr = ['case',
        ['==', tierExpr, 4], shades(HEAT_BUILDING_TONES.hot),
        ['==', tierExpr, 3], shades(HEAT_BUILDING_TONES.orange),
        ['==', tierExpr, 2], shades(HEAT_BUILDING_TONES.warm),
        ['==', tierExpr, 1], shades(HEAT_BUILDING_TONES.cool),
        ['==', tierExpr, 0], shades(HEAT_BUILDING_TONES.cold),
        shades(HEAT_BUILDING_TONES.cold),
      ];
    }
    memoizedExprs.current[key] = expr;
    return expr;
  }

  // Central helper — clears stale memoized exprs and re-applies building/baseplate colors.
  // Called after any setData or toggle that may invalidate the current GPU expression.
  function refreshBuildingColors() {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    const isHm = heatmapRef.current;
    const tsIdx = timespanIdxRef.current ?? 4;
    memoizedExprs.current = {};
    if (map.getLayer('real3d-buildings')) {
      map.setPaintProperty('real3d-buildings', 'fill-extrusion-color', buildingColorExprByState(isHm, tsIdx));
    }
    if (map.getLayer('real3d-buildings-baseplate')) {
      map.setPaintProperty('real3d-buildings-baseplate', 'fill-extrusion-color', baseplateColorExpr(isHm, tsIdx));
    }
    if (map.getLayer('real3d-landuse-baseplate')) {
      map.setPaintProperty('real3d-landuse-baseplate', 'fill-color', baseplateColorExpr(isHm, tsIdx));
    }
  }

  // Update 2D ZCTA line widths based on current zoom — called on every zoom event and on
  // heatmap effect for initial state. Gentle linear increase at z10+ so lines don't
  // appear to shrink relative to the growing zip polygons, without becoming too thick.
  // z9-z10: original ramp/lock — DO NOT change this range.
  // z10+: +1px per zoom level from 6px base, capped at 12px at z16.
  // Baseplate color expression — one flat dark contrast color per tier. No clustering.
  // Baseplates (z13-14) are a visual proxy layer — no need for shade differentiation.
  function baseplateColorExpr(isHeatmap, tsIdx = 0) {
    const key = `bp_${isHeatmap}_${tsIdx}`;
    if (memoizedExprs.current[key]) return memoizedExprs.current[key];

    let expr;
    if (!isHeatmap) {
      // Standard: single flat dark red for all baseplates
      expr = '#220505';
    } else {
      // Heatmap: one dark contrast color per tier, matching the heat zone color family
      const tierExpr = ['coalesce', ['get', `_tier_${tsIdx}`], 0];
      expr = ['case',
        ['==', tierExpr, 4], '#440400',   // hot → dark red
        ['==', tierExpr, 3], '#3d1500',   // orange → dark orange-brown
        ['==', tierExpr, 2], '#5c4a00',   // warm → dark yellow-brown
        ['==', tierExpr, 1], '#002910',   // cool → dark green
        '#001f29',                         // cold → dark blue-grey
      ];
    }
    memoizedExprs.current[key] = expr;
    return expr;
  }


  // ─── FGB building data — dual-path: instant viewport render + persistent Cache API ──
  // Path 1 (instant): fgbDeserialize(url, rect) with HTTP Range requests for current viewport.
  // Path 2 (background): Full-file fetch → Cache API → parse → ZCTA index. Persists across sessions.
  // When cache is ready, viewport render uses cached data instead of network.

  // Normalize a single FGB feature's properties. Pre-computes shade indices for GPU.
  function normalizeFGBProps(props) {
    const hr = parseFloat(props?.HEIGHT_ROOF ?? props?.height_roof);
    const ge = parseFloat(props?.GROUND_ELEVATION ?? props?.ground_elevation);
    const oid = parseInt(props?.OBJECTID ?? props?.objectid ?? '0', 10) || 0;
    return {
      height_roof: isNaN(hr) ? 8 : hr,
      ground_elevation: isNaN(ge) ? 0 : ge,
      objectid: String(oid),
      _s5: oid % 5,
      _s7: oid % 7,
      _tier_0: 0, _tier_1: 0, _tier_2: 0, _tier_3: 0, _tier_4: 0,
    };
  }

  // Parse a Uint8Array of FGB data into a FeatureCollection.
  // Yields to the event loop every CHUNK features to prevent main-thread freeze.
  const FGB_YIELD_CHUNK = 5000;
  const FGB_ESTIMATED_TOTAL = 381000;

  async function parseFGBBuffer(buf, onProgress) {
    const features = [];
    let count = 0;
    for await (const feature of fgbDeserialize(buf)) {
      if (!feature?.geometry?.coordinates) continue;
      feature.properties = normalizeFGBProps(feature.properties);
      features.push(feature);
      count++;
      if (count % FGB_YIELD_CHUNK === 0) {
        if (onProgress) onProgress(count);
        await new Promise(r => setTimeout(r, 0)); // yield to event loop
      }
    }
    if (onProgress) onProgress(count);
    return { type: 'FeatureCollection', features };
  }

  // Build ZCTA index map — one-time PiP for each building centroid → ZCTA index.
  // Yields every CHUNK buildings to prevent main-thread freeze.
  async function buildZctaIndexMap(features, onProgress) {
    const zctaFeatures = geoDataRef.current?.features;
    if (!zctaFeatures?.length) return null;
    const idxMap = new Int16Array(features.length).fill(-1);
    for (let i = 0; i < features.length; i++) {
      const centroid = getGeomCentroid(features[i].geometry);
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
    if (onProgress) onProgress(features.length);
    return idxMap;
  }

  // Background cache builder — non-blocking with yielding every 5K features.
  // Warm path: FGB bytes from Cache API + ZCTA index from Cache API → parse (skip PiP).
  // Cold path: fetch FGB from network → parse → PiP → cache bytes + index.
  // Never caches parsed GeoJSON (too large, causes freeze on stringify/parse).
  async function buildFGBCache() {
    if (buildingFGBRef.current) { setFgbCacheStatus('done'); setFgbCacheProgress(100); return; }
    if (fgbLoadingRef.current) return;
    fgbLoadingRef.current = true;
    setFgbCacheStatus('building');
    setFgbCacheProgress(0);

    // Progress: parse = 0-60%, PiP = 60-95%, finalize = 95-100%
    const reportParseProgress = (count) => {
      const pct = Math.min(60, Math.round((count / FGB_ESTIMATED_TOTAL) * 60));
      setFgbCacheProgress(pct);
    };
    const reportPipProgress = (count) => {
      const pct = 60 + Math.min(35, Math.round((count / FGB_ESTIMATED_TOTAL) * 35));
      setFgbCacheProgress(pct);
    };

    try {
      // ── Check for cached ZCTA index (skip PiP on warm loads) ──
      let cachedZctaIndex = null;
      if ('caches' in window) {
        try {
          const cache = await caches.open(FGB_CACHE_NAME);
          const idxResp = await cache.match('building_zcta_index.bin');
          if (idxResp) {
            cachedZctaIndex = new Int16Array(await idxResp.arrayBuffer());
            console.log('ZCTA index loaded from cache — PiP will be skipped');
          }
        } catch (e) { /* ignore */ }
      }

      // ── Get FGB bytes (cache or network) ──
      let buf = null;
      if ('caches' in window) {
        try {
          const cache = await caches.open(FGB_CACHE_NAME);
          const cached = await cache.match(FGB_CACHE_KEY);
          if (cached) {
            buf = new Uint8Array(await cached.arrayBuffer());
            console.log('FGB bytes loaded from cache');
          }
        } catch (e) { /* ignore */ }
      }

      if (!buf) {
        const resp = await fetch(BUILDING_FGB_URL);
        if (!resp.ok) throw new Error(`FGB fetch failed: ${resp.status}`);
        const arrayBuf = await resp.arrayBuffer();
        buf = new Uint8Array(arrayBuf);

        // Store raw bytes in Cache API for next session
        if ('caches' in window) {
          try {
            const cache = await caches.open(FGB_CACHE_NAME);
            await cache.put(FGB_CACHE_KEY, new Response(arrayBuf.slice(0), {
              headers: { 'Content-Type': 'application/octet-stream' },
            }));
            console.log('FGB bytes stored in cache');
          } catch (e) { console.warn('Cache API write failed:', e); }
        }
      }

      // ── Parse FGB binary → GeoJSON (yielding, non-blocking) ──
      const geojson = await parseFGBBuffer(buf, reportParseProgress);
      buildingFGBRef.current = geojson;

      // ── ZCTA index: use cached or build with yielding ──
      let idxMap = cachedZctaIndex;
      if (idxMap && idxMap.length === geojson.features.length) {
        buildingZctaMapRef.current = idxMap;
        setFgbCacheProgress(95);
        console.log(`FGB warm load: ${geojson.features.length} buildings, ZCTA index from cache`);
      } else {
        // Cold PiP — yields every 5K features
        idxMap = await buildZctaIndexMap(geojson.features, reportPipProgress);
        if (idxMap) {
          buildingZctaMapRef.current = idxMap;
          // Store ZCTA index for future warm loads (~762KB — instant cache write)
          if ('caches' in window) {
            try {
              const cache = await caches.open(FGB_CACHE_NAME);
              await cache.put('building_zcta_index.bin', new Response(idxMap.buffer.slice(0), {
                headers: { 'Content-Type': 'application/octet-stream' },
              }));
              console.log('ZCTA index stored in cache');
            } catch (e) { /* ignore */ }
          }
        }
        console.log(`FGB cold load: ${geojson.features.length} buildings, ZCTA index built`);
      }

      setFgbCacheProgress(100);
      setFgbCacheStatus('done');

      // Push to map if Real3D active + bake all timespan tiers if pre-computed
      const map = mapRef.current;
      if (map && map.getSource('fgb-buildings') && map.getStyle()) {
        // bakeAllTiersIntoBuildings calls setData internally (+ refreshes paint expressions).
        // Only call setData directly when baking is skipped (precomputed tiers not ready yet).
        const baked = precomputedTiersRef.current ? bakeAllTiersIntoBuildings() : false;
        if (!baked) map.getSource('fgb-buildings').setData(geojson);
      }
    } catch (err) {
      console.error('FGB cache build failed:', err);
      setFgbCacheStatus('idle');
      setFgbCacheProgress(0);
    } finally {
      fgbLoadingRef.current = false;
    }
  }

  // Instant viewport render — fetches buildings in visible area + padding via HTTP Range.
  // Used as fallback when full cache isn't ready yet. Padded bbox catches nearby buildings
  // so panning doesn't show empty edges.
  async function fetchViewportBuildings(map) {
    if (!map || !map.getStyle() || !map.getSource('fgb-buildings')) return;
    if (map.getZoom() < 13) return; // below baseplate zoom threshold (baseplates start at z13)
    if (buildingFGBRef.current) return; // cache is ready, no need for viewport fetch

    const bounds = map.getBounds();
    // Pad the viewport bbox by 50% in each direction for pan coverage
    const lngSpan = bounds.getEast() - bounds.getWest();
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const pad = 0.5;
    const rect = {
      minX: bounds.getWest()  - lngSpan * pad,
      minY: bounds.getSouth() - latSpan * pad,
      maxX: bounds.getEast()  + lngSpan * pad,
      maxY: bounds.getNorth() + latSpan * pad,
    };

    const zctaFeatures = geoDataRef.current?.features;
    const tiers = tiersRef.current;

    try {
      const features = [];
      for await (const feature of fgbDeserialize(BUILDING_FGB_URL, rect)) {
        if (!feature?.geometry?.coordinates) continue;

        const props = normalizeFGBProps(feature.properties);

        // Inline PiP for viewport buildings — bake all 5 tier columns using precomputed data.
        // This ensures _tier_0.._tier_4 are correct even before the full FGB cache arrives.
        const precomputed = precomputedTiersRef.current;
        if (zctaFeatures?.length && (tiers?.length || precomputed)) {
          const centroid = getGeomCentroid(feature.geometry);
          let foundZctaIdx = -1;
          for (let j = 0; j < zctaFeatures.length; j++) {
            if (zctaFeatures[j].properties?._special) continue;
            const geom = zctaFeatures[j].geometry;
            const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
            for (const poly of polys) {
              if (pointInRing(centroid[0], centroid[1], poly[0])) { foundZctaIdx = j; break; }
            }
            if (foundZctaIdx >= 0) break;
          }
          if (foundZctaIdx >= 0) {
            for (let t = 0; t < TIMESPAN_STEPS.length; t++) {
              const trs = precomputed?.[t]?.tiers;
              // Fallback to current timespan tiers if precomputed not ready for this slot
              const tierVal = (trs && trs.length > foundZctaIdx) ? (trs[foundZctaIdx] ?? 0)
                : (t === (timespanIdxRef.current ?? 4) ? (tiers?.[foundZctaIdx] ?? 0) : 0);
              props[`_tier_${t}`] = Math.max(0, tierVal);
            }
            props._tier = props[`_tier_${timespanIdxRef.current ?? 4}`];
          }
        }

        feature.properties = props;
        features.push(feature);
      }

      // Only set data if cache hasn't arrived in the meantime
      if (!buildingFGBRef.current && map.getSource('fgb-buildings') && map.getStyle()) {
        map.getSource('fgb-buildings').setData({ type: 'FeatureCollection', features });
        // Refresh paint so GPU reads updated _tier_X columns immediately
        if (real3DRef.current) refreshBuildingColors();
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('FGB viewport fetch failed:', err);
    }
  }

  // Bake all 5 timespan tiers into building properties (_tier_0.._tier_4).
  // After this, GPU reads ['get', '_tier_X'] directly — no feature-state or setData needed on timespan change.
  // Only called when BOTH pre-computed tiers AND building ZCTA index are ready.
  // Mutates features in place, then one final setData pushes the baked GeoJSON.
  function bakeAllTiersIntoBuildings() {
    const geojson = buildingFGBRef.current;
    const idxMap = buildingZctaMapRef.current;
    const precomputed = precomputedTiersRef.current;
    if (!geojson?.features?.length || !idxMap || !precomputed) return false;

    const features = geojson.features;
    for (let i = 0; i < features.length; i++) {
      const zIdx = idxMap[i];
      const props = features[i].properties;
      for (let t = 0; t < TIMESPAN_STEPS.length; t++) {
        const tiers = precomputed[t]?.tiers;
        props[`_tier_${t}`] = (zIdx >= 0 && tiers && tiers.length > zIdx) ? (tiers[zIdx] ?? 0) : 0;
      }
    }
    buildingTiersBakedRef.current = true;

    // Clear stale memoized expressions — they were built before baking when _tier_X were all 0.
    // Ensures subsequent paint calls regenerate correct expressions against real tier data.
    memoizedExprs.current = {};

    // Push baked data to map if source exists, then refresh paint expressions.
    // This guarantees correct colors even if the paint was set before baking completed.
    const map = mapRef.current;
    if (map?.getSource('fgb-buildings') && map.getStyle()) {
      map.getSource('fgb-buildings').setData(geojson);
      // refreshBuildingColors clears memoized cache and re-applies paint for all building layers.
      // Called unconditionally — setPaintProperty guards exist inside refreshBuildingColors.
      refreshBuildingColors();
    }
    return true;
  }

  // Create fgb-buildings source + building layers. Source starts empty.
  // Data loaded separately via deferred loading (instant toggle).
  function addBuildingLayers(map, isHeatmap, tsIdx = 0) {
    if (!map.getSource('fgb-buildings')) {
      map.addSource('fgb-buildings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        generateId: true,
      });
    }

    if (!map.getLayer('real3d-buildings-baseplate')) {
      map.addLayer({
        id: 'real3d-buildings-baseplate', type: 'fill-extrusion',
        source: 'fgb-buildings',
        minzoom: 13, maxzoom: 14,
        paint: {
          'fill-extrusion-color': baseplateColorExpr(isHeatmap, tsIdx),
          'fill-extrusion-height': 7,
          'fill-extrusion-base': 2,
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.5, 0.9],
          'fill-extrusion-vertical-gradient': false,
        },
      });
    }

    if (!map.getLayer('real3d-buildings')) {
      map.addLayer({
        id: 'real3d-buildings', type: 'fill-extrusion',
        source: 'fgb-buildings',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': buildingColorExprByState(isHeatmap, tsIdx),
          'fill-extrusion-height': ['coalesce', ['get', 'height_roof'], 8],
          'fill-extrusion-base': ['max', 2, ['coalesce', ['get', 'ground_elevation'], 0]],
          'fill-extrusion-opacity': 1.0,
          'fill-extrusion-vertical-gradient': false,
        },
      });
    }

    if (map.getLayer('real3d-roads-motorway')) map.moveLayer('real3d-roads-motorway');
    if (map.getLayer('borough-outline')) map.moveLayer('borough-outline');

    // Deferred data loading — does not block Real3D toggle
    setTimeout(() => {
      if (!map.getSource('fgb-buildings')) return;
      if (buildingFGBRef.current) {
        // If data is loaded but tiers not yet baked, bake now (covers race condition
        // where FGB cache finished before precomputed tiers, skipping bake at cache time)
        if (!buildingTiersBakedRef.current && buildingZctaMapRef.current && precomputedTiersRef.current) {
          bakeAllTiersIntoBuildings(); // bake handles setData + refreshBuildingColors internally
        } else {
          map.getSource('fgb-buildings').setData(buildingFGBRef.current);
          refreshBuildingColors();
        }
      } else {
        fetchViewportBuildings(map); // fetchViewportBuildings handles its own color refresh
      }
    }, 0);
  }

  // Initialize Real3D layers ONCE. After first call, all subsequent activations
  // just toggle visibility — no WebGL context rebuild, no source re-creation.
  function initReal3DLayers(map, isHeatmap, tsIdx = 0) {
    map.setLight({ anchor: 'map' });

    if (!map.getSource('openmaptiles')) {
      try {
        map.addSource('openmaptiles', { type: 'vector', url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}` });
      } catch (err) { console.warn('Real3D source add failed:', err); return; }
    }

    try {
      const waterBeforeId = map.getLayer('heat-underlay') ? 'heat-underlay' : undefined;
      map.addLayer({
        id: 'real3d-water', type: 'fill',
        source: 'openmaptiles', 'source-layer': 'water',
        paint: { 'fill-color': '#0e1f35', 'fill-opacity': 0.6 },
      }, waterBeforeId);

      map.addLayer({
        id: 'real3d-park', type: 'fill',
        source: 'openmaptiles', 'source-layer': 'landuse',
        filter: ['all', ['==', ['get', 'class'], 'park'], ['within', NYC_BBOX_GEOM]],
        paint: { 'fill-color': '#081408', 'fill-opacity': 0.8 },
      });

      map.addLayer({
        id: 'real3d-roads-motorway', type: 'line',
        source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 9, maxzoom: 14,
        paint: {
          'line-color': isHeatmap ? '#7a2000' : '#c41000',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 5],
          'line-blur': 1.5, 'line-opacity': 0.9,
        },
      });

      map.addLayer({
        id: 'real3d-roads-primary', type: 'line',
        source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 10, maxzoom: 14,
        paint: {
          'line-color': isHeatmap ? '#662200' : '#cc1800',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 3],
          'line-blur': 0.8, 'line-opacity': 0.75,
        },
      });

      map.addLayer({
        id: 'real3d-roads-tertiary', type: 'line',
        source: 'openmaptiles', 'source-layer': 'transportation',
        minzoom: 11, maxzoom: 14,
        paint: {
          'line-color': '#771100',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 13, 1.5],
          'line-blur': 0.3, 'line-opacity': 0.65,
        },
      });

      map.addLayer({
        id: 'real3d-landuse-baseplate', type: 'fill',
        source: 'openmaptiles', 'source-layer': 'landuse',
        maxzoom: 14,
        filter: ['all', ['match', ['get', 'class'], ['residential', 'commercial', 'industrial', 'retail'], true, false], ['within', NYC_BBOX_GEOM]],
        paint: {
          'fill-color': baseplateColorExpr(isHeatmap, tsIdx),
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 0.45, 13, 0.45, 14, 0],
        },
      });

      addBuildingLayers(map, isHeatmap, tsIdx);

      // Viewport listener for instant render when cache isn't ready.
      // Skip fetch when Real3D layers are hidden — no visible output to fill.
      let vpTimer = null;
      const onViewportChange = () => {
        if (!real3DRef.current) return; // Real3D not active, skip unnecessary fetch
        if (vpTimer) clearTimeout(vpTimer);
        vpTimer = setTimeout(() => fetchViewportBuildings(mapRef.current), 200);
      };
      map.on('moveend', onViewportChange);
      map.on('zoomend', onViewportChange);
      buildingAssignCleanupRef.current = () => {
        map.off('moveend', onViewportChange);
        map.off('zoomend', onViewportChange);
        if (vpTimer) clearTimeout(vpTimer);
      };

      if (map.getLayer('real3d-roads-motorway')) map.moveLayer('real3d-roads-motorway');
      if (map.getLayer('borough-outline')) map.moveLayer('borough-outline');

      real3dLayersCreatedRef.current = true;
    } catch (err) { console.error('Real3D layer init failed:', err); }
  }

  // Show/hide all Real3D layers. No source or layer destruction.
  function setReal3DLayersVisible(map, visible) {
    const vis = visible ? 'visible' : 'none';
    REAL3D_ALL_LAYER_IDS.forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  // Real3D toggle effect — create once, then toggle visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!real3D) {
      // Hide all Real3D layers (don't destroy)
      if (real3dLayersCreatedRef.current) {
        setReal3DLayersVisible(map, false);
      }
      // Stencil cleanup (legacy)
      if (map.getLayer('real3d-nyc-stencil')) map.removeLayer('real3d-nyc-stencil');
      if (map.getSource('real3d-stencil-source')) map.removeSource('real3d-stencil-source');
      if (!threeD) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      return;
    }

    const isHm = heatmapRef.current;

    if (!real3dLayersCreatedRef.current) {
      // Fallback — layers weren't pre-created (geoData was nil at map load). Create now.
      initReal3DLayers(map, isHm, timespanIdxRef.current ?? 4);
    } else {
      // Normal path — layers already exist (pre-created at map init). Just flip visibility.
      setReal3DLayersVisible(map, true);
      // Ensure correct colors — bake if tiers are ready but not yet baked
      if (!buildingTiersBakedRef.current && buildingFGBRef.current && buildingZctaMapRef.current && precomputedTiersRef.current) {
        bakeAllTiersIntoBuildings();
      } else {
        refreshBuildingColors();
      }
      if (map.getLayer('real3d-roads-motorway')) {
        map.setPaintProperty('real3d-roads-motorway', 'line-color', isHm ? '#884400' : '#ff2200');
      }
      if (map.getLayer('real3d-roads-primary')) {
        map.setPaintProperty('real3d-roads-primary', 'line-color', isHm ? '#662200' : '#cc1800');
      }
    }

    map.setLight({ anchor: 'map' });
    map.easeTo({ pitch: 55, bearing: -17, duration: 700 });
  }, [real3D, mapReady]);

  // Heatmap toggle in Real3D — just swap paint expressions (GPU-only, instant)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !real3D) return;
    // Safety: if tiers not yet baked but all prerequisites exist, bake now
    if (!buildingTiersBakedRef.current && buildingFGBRef.current && buildingZctaMapRef.current && precomputedTiersRef.current) {
      bakeAllTiersIntoBuildings(); // bake handles setData + refreshBuildingColors internally
    } else {
      refreshBuildingColors();
    }
    if (map.getLayer('real3d-roads-motorway')) {
      map.setPaintProperty('real3d-roads-motorway', 'line-color', heatmap ? '#884400' : '#ff2200');
    }
    if (map.getLayer('real3d-roads-primary')) {
      map.setPaintProperty('real3d-roads-primary', 'line-color', heatmap ? '#662200' : '#cc1800');
    }
    if (map.getLayer('zcta-safezone-extrusion')) {
      map.setPaintProperty('zcta-safezone-extrusion', 'fill-extrusion-opacity', 1.0);
    }
  }, [heatmap, real3D, mapReady]);

  // Timespan change in Real3D — just swap which _tier_X column the paint reads (GPU-only, instant)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !real3D) return;
    if (!heatmapRef.current) return;
    // Safety: if tiers not yet baked but all prerequisites exist, bake now
    if (!buildingTiersBakedRef.current && buildingFGBRef.current && buildingZctaMapRef.current && precomputedTiersRef.current) {
      bakeAllTiersIntoBuildings();
    } else {
      refreshBuildingColors();
    }
  }, [timespanIdx, real3D, mapReady]);

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
    // Location marker removed per user request.
  }, [userLocation, mapReady]);

  useEffect(() => {
    if (!hoveredZip) { setHoveredEvents([]); setHoveredColonists(null); return; }
    const isSafe = hoveredZip.startsWith('SAFE:');
    const rawZip = isSafe ? hoveredZip.slice(5) : hoveredZip;
    if (isSafe && isSafezoneModzcta(rawZip)) {
      // Safezone: find events geographically within this zone's polygon
      const szFeature = geoData?.features?.find(f => f.properties.MODZCTA === rawZip);
      setHoveredEvents(szFeature ? getEventsInSafezone(szFeature, events, timespanIdx) : []);
      setHoveredColonists(0);
    } else {
      // Normal zip — use cached zipMap
      const { zipMap } = cachedTierDataRef.current.zipMap
        ? { zipMap: cachedTierDataRef.current.zipMap }
        : buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days);
      setHoveredEvents(zipMap[rawZip] || []);
      getZipColonists(rawZip).then(c => setHoveredColonists(c.length)).catch(() => setHoveredColonists(0));
    }
  }, [hoveredZip, timespanIdx, events]);

  async function openSidePanel(zip) {
    const isSafezone = zip.startsWith('SAFE:');
    const rawZip = isSafezone ? zip.slice(5) : zip;
    // Store the full SAFEZONE_N string so the label can show "Safe Zone 3" etc.
    setSideZip(rawZip);
    if (isSafezone && isSafezoneModzcta(rawZip)) {
      // Look up events geographically within this specific safezone polygon
      const szFeature = geoData?.features?.find(f => f.properties.MODZCTA === rawZip);
      setSideEvents(szFeature ? getEventsInSafezone(szFeature, events, timespanIdx) : []);
      setSideColonists([]);
    } else {
      // Normal zip — use cached zipMap
      const { zipMap } = cachedTierDataRef.current.zipMap
        ? { zipMap: cachedTierDataRef.current.zipMap }
        : buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days);
      setSideEvents(zipMap[rawZip] || []);
      let colonists = await getZipColonists(rawZip).catch(() => []);
      if (SAMPLE_MODE) {
        const samples = getSampleUsersForZip(rawZip);
        colonists = [...colonists, ...samples].sort((a, b) => b.clout_points - a.clout_points);
      }
      setSideColonists(colonists);
    }
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

  const isSafezoneHover = hoveredZip?.startsWith('SAFE:');
  const displayHoverZip = isSafezoneHover ? hoveredZip.slice(5) : hoveredZip;
  const zipLabel  = isSafezoneHover ? getSafezoneLabel(displayHoverZip) : hoveredZip ? `ZIP ${hoveredZip}` : '';
  const sideLabel = isSafezoneModzcta(sideZip) ? getSafezoneLabel(sideZip) : sideZip ? `ZIP ${sideZip}` : '';

  return (
    // Outer div is the positioning root for everything
    <div ref={containerRef} className="absolute inset-0 overflow-hidden" style={{ background: '#0d0000' }}>

      {/* FIX CRT: Wrap CRTEffect at z-index 20 so it renders ABOVE the map canvas
          as a visible overlay on all views and combos, while remaining below
          popups (z:30+). pointer-events-none ensures it never blocks interaction. */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
        <CRTEffect active={true} limitMobile={isMobile} />
      </div>

      {/* Single map canvas — all layers (satellite, topo, DS, buildings) on one MapLibre instance.
          No separate canvases needed. ['within'] handles NYC restriction. */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 3, background: 'transparent' }}
      />

      {!entered && <MapIntro onEnter={() => setEntered(true)} />}

      {entered && (
        <>
          {/* Controls — shift down when header collapsed to make room for expand button */}
          <div className={`absolute left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 ${headerCollapsed ? 'top-14' : 'top-3'}`}>
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
              <div className="flex flex-col items-center gap-2">
                <div className="relative flex flex-col items-center gap-2">
                  <button onClick={() => { setHeatmap(v => { if (!v) setTopoOn(false); return !v; }); }}
                    className={`px-4 py-2 rounded-2xl font-black text-sm border-2 transition-all ${heatmap ? 'bg-gradient-to-r from-cyan-500 via-yellow-400 to-red-500 border-yellow-300 text-white' : 'bg-black/70 border-white/30 text-white hover:border-orange-400'}`}>
                    🌡️ Heatmap
                  </button>
                  {heatmap && !isMobile && (
                    <button onClick={() => setTopoOn(v => !v)}
                      className={`w-10 h-10 rounded-2xl border-3 p-0 flex items-center justify-center transition-all ${topoOn ? 'ring-2 ring-yellow-300 border-yellow-300' : 'border-white/50 hover:border-yellow-300'}`}
                      title="Topo Heatmap Toggle"
                      style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#000' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, backgroundImage: `url('${PUBLIC_BASE}data/topo-thumb.png')`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: topoOn ? 1 : 0.8 }} />
                    </button>
                  )}
                  {heatmap && isMobile && (
                    <button onClick={() => setTopoOn(v => !v)}
                      className={`absolute left-[-44px] top-0 w-9 h-9 rounded-2xl border-3 p-0 flex items-center justify-center transition-all ${topoOn ? 'ring-2 ring-yellow-300 border-yellow-300' : 'border-white/50 hover:border-yellow-300'}`}
                      title="Topo Heatmap Toggle (mobile)"
                      style={{ transform: 'translateX(-4px)', backgroundColor: '#000' }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, backgroundImage: `url('${PUBLIC_BASE}data/topo-thumb.png')`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: topoOn ? 1 : 0.8 }} />
                    </button>
                  )}
                </div>
              </div>
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

          {/* Center-to-location — positioned above the zoom nav control in bottom-left */}
          <button onClick={handleCenterLocation} disabled={locLoading}
            className="absolute bottom-[140px] right-6 z-30 w-12 h-12 bg-black/90 border border-white/30 rounded-xl flex items-center justify-center hover:bg-[#7C3AED]/80 hover:border-[#7C3AED] transition-all shadow-lg"
            style={{ padding: 0 }}>
            {locLoading
              ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
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
                  {isSafezoneHover
                   ? <p className="text-white/40 text-xs italic">🛡️ {zipLabel} — {hoveredEvents.length} event{hoveredEvents.length !== 1 ? 's' : ''}</p>
                    : <p className="text-white/60 text-xs">{hoveredEvents.length} upcoming events</p>
                  }
                </div>
                {hoveredEvents.slice(0, 3).map(e => (
                  <div key={e.id} className="px-3 py-1.5 border-b border-white/5">
                    <p className="text-white text-xs font-bold truncate">{e.representative_emoji} {e.event_name}</p>
                    <p className="text-white/40 text-xs">{e.event_date}</p>
                  </div>
                ))}
                {hoveredEvents.length > 3 && <p className="text-white/30 text-xs px-3 py-1">+{hoveredEvents.length - 3} more</p>}
                {hoveredColonists !== null && !isSafezoneHover && (
                  <div className="px-3 py-2 border-t border-white/10">
                    <p className="text-green-400/70 text-xs italic">{hoveredColonists} colonist{hoveredColonists !== 1 ? 's' : ''} in {zipLabel}</p>
                  </div>
                )}
                {isSafezoneHover && (
                  <div className="px-3 py-2 border-t border-white/10">
                    <p className="text-emerald-400/70 text-xs italic">🛡️ There are no colonists in safezones</p>
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
                  <p className="text-white/40 text-xs">{isSafezoneModzcta(sideZip) ? `🛡️ ${getSafezoneLabel(sideZip)} · ${sideEvents.length} events` : `${sideEvents.length} events · ${sideColonists.length} colonists`}</p>
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
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl relative"
                        style={{ background: (event.hex_color || '#7C3AED') + '33', border: `2px solid ${event.hex_color || '#7C3AED'}` }}>
                        {/* Emoji always visible as base layer — shown when image absent/broken */}
                        <span className="absolute inset-0 flex items-center justify-center text-xl pointer-events-none">{event.representative_emoji || '🎉'}</span>
                        {event.photos?.[0] && (
                          <img src={event.photos[0]} className="w-full h-full object-cover relative z-10" alt=""
                            onError={e => e.target.style.display = 'none'} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-sm truncate">
                          {event.photos?.[0] && (event.representative_emoji || '')} {event.event_name}
                        </p>
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

              {!isSafezoneModzcta(sideZip) && (
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
              {isSafezoneModzcta(sideZip) && (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center">
                    <p className="text-4xl mb-3">🛡️</p>
                    <p className="text-emerald-400 font-black text-sm">There are no colonists in safezones</p>
                    <p className="text-white/30 text-xs mt-1">Protected area</p>
                  </div>
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
                  <p className="text-white/40 text-xs">{isSafezoneModzcta(sideZip) ? `🛡️ ${getSafezoneLabel(sideZip)} · ${sideEvents.length} events` : `${sideEvents.length} events · ${sideColonists.length} colonists`}</p>
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
                {!isSafezoneModzcta(sideZip) && (
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
                {isSafezoneModzcta(sideZip) && (
                  <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center">
                      <p className="text-2xl mb-2">🛡️</p>
                      <p className="text-emerald-400 font-black text-xs">No colonists in safezones</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Desktop hologram */}
          {holoFeature && !isMobile && (
            <ZipHologram feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)} />
          )}

          {/* Location active marker removed per user request */}
        </>
      )}

      {selectedEvent && <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />}

      {/* FGB cache status indicator — bottom-left corner with progress bar */}
      {fgbCacheStatus !== 'idle' && (
        <div
          className="fixed z-50 flex flex-col gap-1.5 px-3 py-2 rounded-xl border border-white/20 bg-black/75 backdrop-blur-sm shadow-lg"
          style={{
            bottom: 28, left: 28, pointerEvents: 'none', minWidth: 180,
            transition: 'opacity 0.4s ease',
            opacity: fgbCacheStatus === 'done' ? 0 : 1,
          }}
        >
          <div className="flex items-center gap-2">
            {fgbCacheStatus === 'building' && (
              <span className="text-white text-[11px] font-bold tracking-wide">Map cache is building</span>
            )}
            {fgbCacheStatus === 'paused' && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <span className="text-white text-[11px] font-bold tracking-wide">Cache building is paused</span>
              </>
            )}
            {fgbCacheStatus === 'done' && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 12 9 17 20 6" />
                </svg>
                <span className="text-[#4ade80] text-[11px] font-bold tracking-wide">Cache building complete</span>
              </>
            )}
            {fgbCacheStatus === 'building' && (
              <span className="text-white/60 text-[10px] font-semibold ml-auto">{Math.round(fgbCacheProgress)}%</span>
            )}
          </div>
          {(fgbCacheStatus === 'building' || fgbCacheStatus === 'paused') && (
            <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${fgbCacheProgress}%`,
                  backgroundColor: fgbCacheStatus === 'paused' ? '#f59e0b' : '#7C3AED',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
