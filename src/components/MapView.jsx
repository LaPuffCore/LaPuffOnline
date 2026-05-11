import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol as PMTilesProtocol } from 'pmtiles';
import { generateAutoTags } from '../lib/autoTags';
import EventDetailPopup from './EventDetailPopup';
import mapCacheStore from '../lib/mapCacheStore';
import CRTEffect from './CRTEffect';
import { getZipColonists, getBoroughColonists } from '../lib/pointsSystem';
import { pingNYCLocation, getLastLocation } from '../lib/locationService';
import { isEventHappeningNow, isAftersWindow, isEventLive } from '../lib/eventUtils';
import { SAMPLE_MODE } from '../lib/sampleConfig';
import { getSampleUsersForZip } from '../lib/sampleUsers';
import { fetchGeoPostFeed, fetchReactionsForPosts } from '../lib/supabase';

const GEOJSON_URL = './data/MODZCTA_2010_WGS1984.geo.json';
const BOROUGH_GEOJSON_URL = './data/borough.geo.json';

// MapLoadingScreen gate keys
const MAP_CACHE_DONE_KEY     = 'lapuff_map_cache_v4';
const MAP_CACHE_BUILDING_KEY = 'lapuff_map_cache_building';

// Buildings PMTiles — same-origin GitHub Pages, SW range-cached. ~71MB, never fully loaded
// at runtime; MapLibre fetches only viewport tiles via HTTP Range. SW pre-warms full file
// in MapLoadingScreen Phase 2A so warm tiles serve from in-memory slicing (~0ms).
// Layer: 'building'. Per-feature props: { z=zip(string), b=bid(int), h=height_ft, m=min_h_ft, c=colour }
// NOTE: h and m are stored in FEET. Always multiply by 0.3048 in fill-extrusion-height/base expressions.
const BUILDINGS_PMTILES_URL = (typeof window !== 'undefined')
  ? `${window.location.origin}${import.meta.env.BASE_URL}data/nyc_buildings_final.pmtiles`
  : '/data/nyc_buildings_final.pmtiles';
const BUILDINGS_PMTILES_LAYER = 'building';

// Roads PMTiles: hierarchical-dissolve road polygons (~8.5K features, 14MB) on OCI PAR.
// Schema: layer 'final6deciroads', props { id, fclass, _z }.
// fclass values: motorway, trunk, primary, secondary, tertiary, residential.
const ROADS_PMTILES_URL = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/yGTOMC4N2uc1uIGkliFRgP51VbnPm96W8vebh_sOqeoGil3PErp8dvWmy74pEH70/n/idfnjqqb9g0p/b/nyc-map-data/o/realfinaldeciroads.pmtiles';
const ROADS_PMTILES_LAYER = 'final6deciroads';
// Register the pmtiles:// protocol with MapLibre once at module load.
const _pmtilesProtocol = new PMTilesProtocol();
maplibregl.addProtocol('pmtiles', _pmtilesProtocol.tile.bind(_pmtilesProtocol));


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
const OUTLINE_COLOR = '#ff0000';
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
  hot:    '#ff0000',
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

// Borough overlay — geographic centers (WSG84) in the same order as borough.geo.json:
//   Manhattan (0), Staten Island (1), Bronx (2), Queens (3), Brooklyn (4)
const BOROUGH_DATA = [
  { name: 'Manhattan',     lng: -73.9712, lat: 40.7831 },
  { name: 'Staten Island', lng: -74.1502, lat: 40.5795 },
  { name: 'Bronx',         lng: -73.8648, lat: 40.8448 },
  { name: 'Queens',        lng: -73.7949, lat: 40.7282 },
  { name: 'Brooklyn',      lng: -73.9442, lat: 40.6782 },
];

// Heat rank label + color for borough overlay (absolute tier → label)
function tierHeatLabel(tier) {
  if (tier >= 4) return { label: 'Hottest Zone', color: '#cc0d00' };
  if (tier >= 3) return { label: 'Hot Zone',     color: '#dd6600' };
  if (tier >= 2) return { label: 'Warm Zone',    color: '#f5c800' };
  if (tier >= 1) return { label: 'Cool Zone',    color: '#00dd66' };
  return                 { label: 'Cold Zone',    color: '#00ccdd' };
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
    // Auto-scraped events do NOT affect heatmap — only user-submitted events count.
    // Sample events ARE included (they simulate user events during development).
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
// z9→z9.5: thin ramp. z10→z12: reduced. z12+: scales up for visual weight.
// GPU-evaluated per-frame — no JS zoom listener needed.
function zctaLineWidthExpr(mult = 1) {
  return ['interpolate', ['linear'], ['zoom'],
    9,   0.8 * mult,   // z9 start — thin far out
    9.5, 1.0 * mult,   // z9.5 — subtle
    10,  1.2 * mult,   // z10 — slightly thicker
    11,  1.6 * mult,   // z11 — moderate
    12,  2.2 * mult,   // z12 — close zoom growth
    16,  6.0 * mult,   // z16 — full visual weight at close
  ];
}

// T3 3D PIXELIZATION: Smooth continuous zoom-aware width scaling.
// ZCTA (base 14m): 14m flat until zoom 10.5, then ramps to 64m at zoom 9.
// Borough (base 18m): 1x at zoom≥11, 2x ramp at zoom 10-11, 3x ramp at zoom ≤9.
// zoomOverride / pitchOverride: supply integer zoom / pitch for pre-baking geometry at
// a specific zoom band without relying on the live map state.
function getZoomAwareOutlineWidth(map, baseMeters = 14, is3D = false, zoomOverride = null, pitchOverride = null) {
  if (!map || typeof map.getZoom !== 'function') return baseMeters;
  // If 3D/Real3D mode is active, use the new split-scale logic.
  if (is3D) {
    const zoom = zoomOverride ?? map.getZoom();
    const pitch = pitchOverride ?? (map.getPitch ? map.getPitch() : 0);
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
  const zoom = zoomOverride ?? map.getZoom();
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
  const pitch = pitchOverride ?? (map.getPitch ? map.getPitch() : 0);
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

// All Real3D layer IDs — ordered for optimal visibility toggling (roads before buildings
// so GPU submission order matches visual stack; buildings last = they occlude roads).
// Keep in sync with layers created by initReal3DLayers + addOpenmaptilesSourceAndLayers.
const REAL3D_ALL_LAYER_IDS = [
  'real3d-water',
  // PMTiles roads — 2D fill ONLY per fclass (z9-z16). 3D extrusions removed: 2D fills paint
  // below all fill-extrusion layers (separate GPU pass), so buildings + borough-outline
  // automatically occlude roads from z14+. Eliminates 3D road compute entirely.
  'real3d-pm-roads-motorway-fill',
  'real3d-pm-roads-trunk-fill',
  'real3d-pm-roads-primary-fill',
  'real3d-pm-roads-secondary-fill',
  'real3d-pm-roads-tertiary-fill',
  'real3d-pm-roads-residential-fill',
  // Road width line overlays (z9–z13): GPU-interpolated zoom-width for far-zoom visibility.
  // Same color as fill. maxzoom:13 — fill polygon is wide enough above z13.
  'real3d-pm-roads-motorway-line',
  'real3d-pm-roads-trunk-line',
  'real3d-pm-roads-primary-line',
  'real3d-pm-roads-secondary-line',
  'real3d-pm-roads-tertiary-line',
  'real3d-pm-roads-residential-line',
  // Unified building layer last — drawn on top of roads (occluding them correctly).
  // Single layer covers z12.5+ with height interpolation:
  //   z13–z13.9: flat 7m (baseplate appearance — locked constant)
  //   z13.9–z14: smooth growth to actual building height
  //   z14+: full roof height
  'real3d-buildings',
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
        _color: isHeatmap ? (
          avgTiers[i] >= 4 ? midTierColor(4) :   // hot — standard HEAT_MID
          avgTiers[i] >= 3 ? '#ff3300' :          // orange
          avgTiers[i] >= 2 ? midTierColor(2) :    // warm — standard HEAT_MID
          avgTiers[i] >= 1 ? '#02f733' :          // cool → bright green
          '#057ef7'                                // cold → bright blue
        ) : '#ff0000',
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
function PaginatedSection({ items, renderItem, emptyMsg, headerLabel, headerColor = 'text-white/30', pageSize = PAGE_SIZE }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(items.length / pageSize);
  const visible = items.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div className="flex flex-col min-h-0">
      <p className={`px-4 py-2 text-xs font-black uppercase tracking-widest sticky top-0 bg-gray-950/90 flex-shrink-0 ${headerColor}`}>{headerLabel}</p>
      {items.length === 0
        ? <p className="px-4 py-6 text-white/20 text-sm text-center">{emptyMsg}</p>
        : visible.map((item, i) => renderItem(item, page * pageSize + i))
      }
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 border-t border-white/10 flex-shrink-0">
          {page > 0
            ? <button onClick={() => setPage(p => p - 1)} className="text-white/50 hover:text-white text-xs font-black px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors">{'<'}</button>
            : <span className="w-5" />
          }
          <span className="text-white/30 text-[10px] font-black">{page + 1} / {totalPages}</span>
          {page < totalPages - 1
            ? <button onClick={() => setPage(p => p + 1)} className="text-white/50 hover:text-white text-xs font-black px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors">{'>'}</button>
            : <span className="w-5" />
          }
        </div>
      )}
    </div>
  );
}

// ── AftersCheckInModal ────────────────────────────────────────────────────────
function AftersCheckInModal({ event, onClose }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const attendanceCount = event.attendance_count || 0;

  async function handleCheckIn() {
    setLoading(true);
    setStatus(null);
    try {
      const { pingLocation, isWithin750ft, markCheckedIn, isCheckedIn } = await import('../lib/locationService.js');
      const { awardPoints, POINTS, isEligibleForPoints } = await import('../lib/pointsSystem.js');
      const { getValidSession } = await import('../lib/supabaseAuth.js');
      const { isCheckInWindowOpen } = await import('../lib/eventUtils.js');
      if (isCheckedIn(event.id, 'afters')) { setStatus({ ok: true, msg: '✅ Already checked into afters!' }); return; }
      if (!isCheckInWindowOpen(event)) { setStatus({ ok: false, msg: '🕐 Afters window not open' }); return; }
      const aLat = parseFloat(event.afters_lat), aLng = parseFloat(event.afters_lng);
      if (isNaN(aLat) || isNaN(aLng)) { setStatus({ ok: false, msg: '📍 No afters location set' }); return; }
      const loc = await pingLocation();
      if (!isWithin750ft(loc.lat, loc.lng, aLat, aLng)) { setStatus({ ok: false, msg: '📡 You are not in range of the afters' }); return; }
      markCheckedIn(event.id, 'afters');
      const session = await getValidSession();
      if (isEligibleForPoints(session)) awardPoints(session, POINTS.AFTERS_ATTEND_CHECKIN, `Afters Attendance: ${event.event_name}`, event.id, 'afters');
      setStatus({ ok: true, msg: '🎉 Afters check-in confirmed! +200 pts' });
    } catch { setStatus({ ok: false, msg: '📍 Could not get location — enable location access' }); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-white border-4 border-[#7c3aed] rounded-3xl shadow-[8px_8px_0px_black] max-w-sm w-full p-6"
      onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎉</span>
          <div>
            <p className="text-[9px] font-black uppercase text-purple-600 tracking-widest">Afters Check-In</p>
            <h3 className="font-black text-sm leading-tight line-clamp-2">{event.event_name}</h3>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full border-2 border-black font-black hover:bg-black hover:text-white transition-colors">✕</button>
      </div>
      {event.afters_address && (
        <p className="text-xs font-bold text-gray-600 mb-3">📍 {event.afters_address}</p>
      )}
      {attendanceCount > 0 && (
        <p className="text-[11px] font-black text-purple-700 mb-3">👥 {attendanceCount} {attendanceCount === 1 ? 'person has' : 'people have'} checked in</p>
      )}
      {status && (
        <div className={`mb-3 px-3 py-2 rounded-xl border-2 text-xs font-black ${status.ok ? 'bg-green-50 border-green-400 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
          {status.msg}
        </div>
      )}
      <button
        onClick={handleCheckIn}
        disabled={loading || status?.ok}
        className="w-full py-3 bg-[#7c3aed] text-white font-black rounded-2xl border-3 border-black shadow-[4px_4px_0px_black] hover:bg-[#6d28d9] disabled:opacity-50 transition-all active:shadow-none active:translate-x-1 active:translate-y-1"
      >
        {loading ? 'Getting location…' : status?.ok ? '✅ Checked In' : '📍 Check Into Afters (+200 pts)'}
      </button>
    </div>
  );
}

// ── ZipHologram desktop ───────────────────────────────────────────────────────
// ── ZipHologram — unified desktop + mobile (mobile prop) ──────────────────
// Consolidated from old ZipHologram + ZipHologramMobile (95% duplicated).
// `mobile`   → smaller canvas, lower depth, no scanline overlay / CRT flash
// `embedded` → mobile only: render inline (no fixed positioning, no header)
function ZipHologram({ feature, color, onClose, leftOffset = 0, mobile = false, embedded = false }) {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const timeRef   = useRef(0);

  const W_PX     = mobile ? 400 : 460;
  const H_PX     = mobile ? (embedded ? 220 : 260) : 340;
  const DEPTH    = mobile ? 14 : 18;
  const GLITCH_N = mobile ? 3 : null; // null = randomized desktop count

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
      for (let d = DEPTH; d >= 0; d--) drawShape(Math.sin(rotY) * d * 1.8, -d * 0.7, 0.08 + (1 - d / DEPTH) * 0.18, d > 0);
      const ts = Math.sin(rotY) * DEPTH * 1.8;
      ctx.globalAlpha = 1; drawShape(ts, -DEPTH * 0.7, 0.55, false);
      if (Math.random() < 0.04) {
        const gn = GLITCH_N ?? (Math.floor(Math.random() * 5) + 2);
        for (let g = 0; g < gn; g++) {
          ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color;
          ctx.fillRect((Math.random() - 0.5) * 20, Math.random() * H, W, Math.random() * 6 + 2);
          ctx.restore();
        }
      }
      ctx.save(); ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2; ctx.shadowColor = color; ctx.shadowBlur = 20;
      drawShape(ts, -DEPTH * 0.7, 0.9, true); ctx.restore();
      if (!mobile && Math.sin(t * 7) > 0.92) { ctx.fillStyle = color + '22'; ctx.fillRect(0, 0, W, H); }
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color, mobile, DEPTH, GLITCH_N]);

  useEffect(() => {
    if (mobile) return; // mobile escape handled by parent UI
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, mobile]);

  const zipLabel = feature?.properties?.MODZCTA;

  if (mobile && embedded) {
    return (
      <div className="flex flex-col w-full flex-1 min-h-0">
        <canvas ref={canvasRef} width={W_PX} height={H_PX} style={{ width: '100%', flex: 1, minHeight: 0, borderTop: `1px solid ${color}44`, background: '#000000bb' }} />
        <div className="text-center py-1 text-[10px] font-black tracking-widest opacity-40 uppercase flex-shrink-0" style={{ color }}>◈ Hologram ◈</div>
      </div>
    );
  }
  if (mobile) {
    return (
      <div className="absolute inset-x-0 top-0 z-40 flex flex-col" style={{ height: '50%', background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)' }}>
        <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
          <div style={{ color, textShadow: `0 0 12px ${color}` }} className="font-black text-sm tracking-widest uppercase">ZIP {zipLabel} — ISOLATED</div>
          <button onClick={onClose} className="w-8 h-8 rounded-full border font-black text-xs flex items-center justify-center hover:bg-white/20" style={{ borderColor: color, color }}>✕</button>
        </div>
        <canvas ref={canvasRef} width={W_PX} height={H_PX} style={{ width: '100%', flex: 1, minHeight: 0, borderTop: `1px solid ${color}44`, background: '#000000bb' }} />
        <div className="text-center py-1 text-[10px] font-black tracking-widest opacity-40 uppercase flex-shrink-0" style={{ color }}>◈ Hologram ◈</div>
      </div>
    );
  }
  return (
    <div className="absolute z-40 pointer-events-none" style={{ left: leftOffset, right: 400, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} />
      <div className="relative pointer-events-auto flex flex-col items-center" style={{ width: 480, maxWidth: '90%', zIndex: 1 }}>
        <div className="flex items-center justify-between w-full mb-3 px-1">
          <div style={{ color, textShadow: `0 0 12px ${color}` }} className="font-black text-lg tracking-widest uppercase">ZIP {zipLabel} — ISOLATED</div>
          <button onClick={onClose} className="w-9 h-9 rounded-full border-2 font-black text-sm flex items-center justify-center hover:bg-white/20" style={{ borderColor: color, color }}>✕</button>
        </div>
        <canvas ref={canvasRef} width={W_PX} height={H_PX} style={{ width: '100%', height: H_PX, borderRadius: 18, border: `2px solid ${color}`, boxShadow: `0 0 40px ${color}66, 0 0 80px ${color}33`, background: '#000000cc' }} />
        <div className="absolute pointer-events-none" style={{ top: 44, left: 0, right: 0, height: H_PX, background: 'repeating-linear-gradient(transparent, transparent 3px, rgba(0,0,0,0.25) 3px, rgba(0,0,0,0.25) 4px)', borderRadius: 18 }} />
        <div className="mt-3 text-xs font-black tracking-widest opacity-50 uppercase" style={{ color }}>◈ Holographic Extrusion Mode ◈</div>
      </div>
    </div>
  );
}



// ── MapPostsPanelView ──────────────────────────────────────────────────────────
const POSTS_PER_PAGE = 6;

function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function truncateText(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

function MapPostsPanelView({ panel, posts, reactions, sort, setSort, page, setPage, loading, headerCollapsed, isMobile = false, onClose }) {
  const accentPurple = '#7C3AED';
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  const visiblePosts = posts.slice(page * POSTS_PER_PAGE, (page + 1) * POSTS_PER_PAGE);

  const topStyle = headerCollapsed ? '0px' : isMobile ? '62px' : '72px';
  const title = panel.type === 'borough' ? `🏙 ${panel.value}` : `📍 ZIP ${panel.value}`;

  const containerStyle = isMobile
    ? { position: 'absolute', left: 0, right: 0, bottom: 0, top: topStyle, zIndex: 60, background: 'rgba(3,0,10,0.93)', backdropFilter: 'blur(16px)', borderTop: '1px solid rgba(124,58,237,0.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'top 300ms' }
    : { position: 'absolute', left: 0, top: topStyle, bottom: 0, width: '33.333%', zIndex: 50, background: 'rgba(3,0,10,0.58)', backdropFilter: 'blur(18px)', borderRight: '1px solid rgba(124,58,237,0.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'top 300ms' };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, background: 'rgba(0,0,0,0.3)' }}>
        <div>
          <p style={{ color: '#a78bfa', fontWeight: 900, fontSize: 13, lineHeight: 1 }}>{title}</p>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 2 }}>{posts.length} posts</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Sort toggle */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.07)', borderRadius: 99, padding: 2, gap: 2 }}>
            {['newest', 'top'].map(s => (
              <button key={s} onClick={() => { setSort(s); setPage(0); }}
                style={{ padding: '3px 10px', borderRadius: 99, fontSize: 10, fontWeight: 900, cursor: 'pointer', border: 'none', background: sort === s ? accentPurple : 'transparent', color: sort === s ? '#fff' : 'rgba(255,255,255,0.5)', transition: 'all 0.15s' }}>
                {s === 'newest' ? '⏱ New' : '🔥 Top'}
              </button>
            ))}
          </div>
          <button onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 99, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900 }}>✕</button>
        </div>
      </div>

      {/* Post list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {loading && <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '24px 0', fontSize: 12 }}>Loading...</p>}
        {!loading && posts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 16px' }}>
            <p style={{ fontSize: 28, marginBottom: 8 }}>🌀</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700 }}>No posts here yet</p>
          </div>
        )}
        {!loading && visiblePosts.map(post => {
          const plain = truncateText(stripHtml(post.content?.html || post.content || ''), 200);
          const emojiCounts = {};
          (reactions[post.id] || []).forEach(r => { emojiCounts[r.emoji_text] = (emojiCounts[r.emoji_text] || 0) + 1; });
          const topEmojis = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
          const dateStr = new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const cardBg = post.post_fill ? post.post_fill + 'dd' : 'rgba(255,255,255,0.06)';
          const cardBdr = post.post_outline || 'rgba(255,255,255,0.12)';
          return (
            <div key={post.id} style={{ marginBottom: 8, borderRadius: 14, border: `2px solid ${cardBdr}`, background: cardBg, overflow: 'hidden', boxShadow: '2px 2px 0px rgba(0,0,0,0.4)' }}>
              {post.image_url && (
                <img src={post.image_url} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} loading="lazy" />
              )}
              <div style={{ padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 900, fontSize: 11, color: post.post_fill ? '#000' : '#fff' }}>{post.username || 'Orbiter'}</span>
                  <span style={{ fontSize: 9, fontWeight: 900, padding: '1px 5px', borderRadius: 99, background: post.is_participant ? '#22c55e' : '#ef4444', color: '#fff' }}>
                    ● {post.is_participant ? 'PART.' : 'ORB.'}
                  </span>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto' }}>{dateStr}</span>
                </div>
                {plain && <p style={{ fontSize: 11, lineHeight: 1.45, color: post.post_fill ? '#111' : 'rgba(255,255,255,0.85)', marginBottom: 5, wordBreak: 'break-word' }}>{plain}</p>}
                {topEmojis.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {topEmojis.map(([emoji, count]) => (
                      <span key={emoji} style={{ fontSize: 10, background: 'rgba(255,255,255,0.1)', borderRadius: 99, padding: '1px 6px', color: 'rgba(255,255,255,0.7)' }}>{emoji} {count}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '4px 12px', borderRadius: 99, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: page === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)', cursor: page === 0 ? 'default' : 'pointer', fontSize: 11, fontWeight: 900 }}>← Prev</button>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ padding: '4px 12px', borderRadius: 99, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: page >= totalPages - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontSize: 11, fontWeight: 900 }}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MapView({ events, headerCollapsed = false, interactive = true, phase2ADone = false }) {
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
  const timespanIdxRef  = useRef(2);
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
  const zipToZctaIdxMapRef  = useRef(null);  // {[MODZCTA]: zctaFeatureIdx} — needed by buildTierByZipExpr for PMTiles heatmap
  // Real3D layer lifecycle — create once, toggle visibility
  const real3dLayersCreatedRef = useRef(false); // true after first initReal3DLayers
  // Tracks borough outline 3D mode — defers opacity on FIRST entry to avoid spike artifact
  const boroughWas3DRef = useRef(false);
  // Cache key for borough outline geometry — skip expensive safezone PiP when only Real3D/opacity changes
  const boroughGeoKeyRef = useRef(null);
  // Interaction control — disabled during Phase 2B loading, enabled on reveal
  const interactiveRef = useRef(interactive);

  // Persist topo toggle across sessions
  useEffect(() => {
    try { localStorage.setItem('lapuff_topo_on', topoOn ? '1' : '0'); } catch (e) { /* ignore */ }
  }, [topoOn]);

  const [timespanIdx,   setTimespanIdx]   = useState(2);
  const [heatmap,       setHeatmap]       = useState(false);
  const [satellite,     setSatellite]     = useState(false);
  const [threeD,        setThreeD]        = useState(false);
  const [real3D,        setReal3D]        = useState(false);
  const [geoData,       setGeoData]       = useState(null);
  const [boroughGeoData, setBoroughGeoData] = useState(null);
  const [adjacency,     setAdjacency]     = useState([]);
  const [mapReady,      setMapReady]      = useState(false);
  const [hoveredZip,    setHoveredZip]    = useState(null);
  const [hoveredBorough, setHoveredBorough] = useState(null);
  const [hoveredEvents, setHoveredEvents] = useState([]);
  const [hoveredColonists, setHoveredColonists] = useState(null);
  const [tooltipPos,    setTooltipPos]    = useState(null);
  const [sideZip,       setSideZip]       = useState(null);
  const [sideEvents,    setSideEvents]    = useState([]);
  const [sideColonists, setSideColonists] = useState([]);
  const [sideBorough,   setSideBorough]   = useState(null);
  const [sideBoroughEvents,    setSideBoroughEvents]    = useState([]);
  const [sideBoroughColonists, setSideBoroughColonists] = useState([]);
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
  // MapPostsPanel state
  const [mapPostsPanel, setMapPostsPanel] = useState(null); // null | { type: 'zip'|'borough', value: string }
  const [mapPosts, setMapPosts] = useState([]);
  const [mapPostsSort, setMapPostsSort] = useState('newest');
  const [mapPostsPage, setMapPostsPage] = useState(0);
  const [mapPostsLoading, setMapPostsLoading] = useState(false);
  const [mapPostsReactions, setMapPostsReactions] = useState({});
  const hoveredBoroughIdRef = useRef(null);
  // Event pin markers toggle
  const [showPins, setShowPins] = useState(false);
  // Borough region overlay toggle
  const [showRegion, setShowRegion] = useState(false);
  const regionMarkersRef = useRef([]);
  const regionZoomHandlerRef = useRef(null);
  const [hoveredPinEvent, setHoveredPinEvent] = useState(null);
  const [hoveredPinPos, setHoveredPinPos] = useState(null);
  const pinEventsLookupRef = useRef(new Map());
  const pinHandlersAttachedRef = useRef(false);
  const hoveredPinEventRef = useRef(null);
  // Pill badge markers (live/afters above each pin)
  const pillMarkersRef = useRef([]);
  // Afters pin markers
  const aftersMarkersRef = useRef([]);
  // Selected afters event for check-in popup
  const [aftersCheckInEvent, setAftersCheckInEvent] = useState(null);
  // Valhalla walking route — abort controller, debounce timer, and session cache
  const valhallaAbortRef  = useRef(null);   // AbortController for in-flight request
  const valhallaTimerRef  = useRef(null);   // debounce timer handle
  const valhallaRouteCache = useRef(new Map()); // eventId → GeoJSON LineString (session cache)

  // (legacy auto-dismiss effect for FGB cache UI removed — PMTiles handles loading natively,
  // no user-visible cache indicator needed)

  heatmapRef.current   = heatmap;
  threeDRef.current    = threeD;
  real3DRef.current    = real3D;
  satelliteRef.current = satellite;
  timespanIdxRef.current = timespanIdx;
  geoDataRef.current   = geoData;
  boroughGeoDataRef.current = boroughGeoData;
  hoveredPinEventRef.current = hoveredPinEvent;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Pre-warm PMTiles headers into HTTP cache when map is ready.
  // Pre-warm roads PMTiles header — MapLibre needs first 16KB before fetching any road tiles.
  useEffect(() => {
    if (!mapReady) return;
    fetch(ROADS_PMTILES_URL, { headers: { Range: 'bytes=0-16383' } }).catch(() => {});
  }, [mapReady]);

  // Build zip→ZCTA index map as soon as geoData is available (no `interactive` gate).
  // This ensures buildTierByZipExpr can produce correct paint expressions for the
  // PMTiles building heatmap on both desktop and mobile.
  // Also hydrates precomputedTiersRef from mapCacheStore (set by Phase 2A) and triggers
  // an initial paint refresh so building colors are correct on first frame.
  useEffect(() => {
    if (!geoData?.features) return;
    if (!zipToZctaIdxMapRef.current) {
      const lookup = {};
      geoData.features.forEach((f, i) => {
        const z = f.properties?.MODZCTA;
        if (z) lookup[String(z)] = i;
      });
      zipToZctaIdxMapRef.current = lookup;
    }
    if (mapCacheStore.precomputedTiers && !precomputedTiersRef.current) {
      precomputedTiersRef.current = mapCacheStore.precomputedTiers;
    }
    refreshBuildingColors();
  }, [geoData]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // GeoJSON — hydrate from mapCacheStore if Phase 2A ran, else fetch
  useEffect(() => {
    // If Phase 2A already fetched and processed the GeoJSON, use it directly
    if (mapCacheStore.geoData) {
      const { features } = mapCacheStore.geoData;
      setGeoData(mapCacheStore.geoData);
      if (mapCacheStore.adjacency) setAdjacency(mapCacheStore.adjacency);
      else setAdjacency(buildAdjacency(features));
      if (mapCacheStore.zctaSkeleton) zctaSkeletonRef.current = mapCacheStore.zctaSkeleton;
      else zctaSkeletonRef.current = buildZctaSkeleton(mapCacheStore.geoData);
      return;
    }
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

  // Borough GeoJSON — hydrate from mapCacheStore if Phase 2A ran, else fetch
  useEffect(() => {
    if (mapCacheStore.boroughGeoData) {
      setBoroughGeoData(mapCacheStore.boroughGeoData);
      if (mapCacheStore.boroughSkeleton) boroughSkeletonRef.current = mapCacheStore.boroughSkeleton;
      else boroughSkeletonRef.current = buildBoroughSkeleton(mapCacheStore.boroughGeoData);
      if (mapCacheStore.zipBoroughMap) zipBoroughMapRef.current = mapCacheStore.zipBoroughMap;
      // Force the heatmap effect to re-run the full PiP path with the now-ready skeleton.
      // Prevents fragmentation caused by createOutlineGeoJSON fallback producing wrong quad indices.
      boroughGeoKeyRef.current = null;
      boroughQuadFilterRef.current = null;
      return;
    }
    fetch(BOROUGH_GEOJSON_URL).then(r => r.json()).then(data => {
      setBoroughGeoData(data);
      boroughSkeletonRef.current = buildBoroughSkeleton(data);
      // Same reset — ensures first render after fetch uses skeleton (not fallback) indices
      boroughGeoKeyRef.current = null;
      boroughQuadFilterRef.current = null;
    }).catch(err => console.warn('Borough GeoJSON load failed:', err));
  }, []);

  // Compute zip→borough mapping once both datasets are ready
  useEffect(() => {
    if (!geoData || !boroughGeoData) return;
    zipBoroughMapRef.current = computeZipBoroughMap(geoData.features, boroughGeoData.features);
    // Populate borough hover source with raw borough polygons for interaction
    const mapInst = mapRef.current;
    if (mapInst && mapInst.getSource('borough-hover-source')) {
      mapInst.getSource('borough-hover-source').setData(boroughGeoData);
    }
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
      // Session tile cache: keeps infrastructure tiles (roads, water, outlines) warm
      // across pan/zoom so zooming out never shows black squares. Mobile gets a smaller
      // cache to stay under iOS Safari's ~4GB RAM ceiling.
      maxTileCacheSize: window.innerWidth < 768 ? 100 : 300,
      // Fade duration 0 = paint changes apply instantly, no cross-fade flash on outlines.
      fadeDuration: 0,
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
    // WebGL context loss recovery — prevent crash on mobile GPU pressure
    map.getCanvas().addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost — will attempt recovery');
    });
    map.getCanvas().addEventListener('webglcontextrestored', () => {
      console.log('WebGL context restored');
      setStyleVersion(v => v + 1); // trigger style re-application
    });
    map.on('load', () => {
      map.getCanvas().style.backgroundColor = 'transparent';
      mapCacheStore.mapLibreReady = true;
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
    // Filter excludes _special (safe zone) features — handled by zcta-safezone-fill (2D).
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
    // Filter excludes _special (safe zone) features — handled by zcta-safe-extrude (3D) or zcta-safezone-fill (2D).
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

    // Safezone extrusion — white flat slab that participates in the fill-extrusion depth buffer.
    // In 3D mode this is the correct way to show safezones: the tall adjacent zip extrusions
    // will properly occlude this from the camera's perspective (depth-tested inside the FBO).
    // A 2D fill (zcta-safezone-fill) would composite ON TOP of the FBO — the x-ray artifact.
    // Hidden by default (opacity=0); activated in 3D mode by the heatmap effect.
    map.addLayer({
      id: 'zcta-safe-extrude', type: 'fill-extrusion', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: {
        'fill-extrusion-color': '#ffffff',
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,
      },
    });

    // Flat fill — slightly transparent dark red to differentiate regions from bg without solid fill.
    // Excludes _special (safe zone) features — those are handled by zcta-safe-extrude (3D) or zcta-safezone-fill (2D).
    map.addLayer({
      id: 'zcta-fill', type: 'fill', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        'fill-color': '#1a0505',
        'fill-opacity': sat ? 0.38 : 0.55,
      },
    });

    // Safezone fill — 2D fill (not extrusion) so it renders in the 2D pass and never
    // z-fights with buildings or 3D fill-extrusions. Hover is handled by zcta-safezone-hover.
    map.addLayer({
      id: 'zcta-safezone-fill', type: 'fill', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: {
        'fill-color': '#ffffff',
        'fill-opacity': sat ? 0.22 : 1.0,
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

    // Safe zone outline — always visible in 2D/Real3D; hidden in 3D mode where 2D lines
    // pass through fill-extrusions (x-ray artifact). zcta-safe-extrude provides the ground color in 3D.
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': zctaLineWidthExpr(0.8), 'line-offset': 1, 'line-opacity': is3D ? 0 : 1 },
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
      paint: {
        'line-color': OUTLINE_COLOR, 'line-width': zctaLineWidthExpr(1.25),
        'line-opacity': is3D ? 0 : (sat ? 0.55 : 0.75), 'line-blur': 3,
        'line-opacity-transition': { duration: 0 }, 'line-width-transition': { duration: 0 },
      },
    });
    map.addLayer({
      id: 'zcta-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        'line-color': OUTLINE_COLOR, 'line-width': zctaLineWidthExpr(1),
        'line-opacity': is3D ? 0 : 1,
        'line-opacity-transition': { duration: 0 }, 'line-width-transition': { duration: 0 },
      },
    });

    // 3D far-zoom boundary line — interpolates 3px→0px from z9→z12 to bridge the gap while
    // zcta-outline (annular ring cap) is frozen at z12 size. Only shown in 3D mode.
    // Width transitions smoothly so zcta-outline ring is unneeded at low zoom.
    map.addLayer({
      id: 'zcta-3d-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      minzoom: 9, maxzoom: 12,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': OUTLINE_COLOR,
        'line-opacity': 0,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 12, 0],
        'line-offset': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 0],
        'line-width-transition': { duration: 0 },
        'line-opacity-transition': { duration: 0 },
      },
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
          'fill-extrusion-opacity-transition': { duration: 0 },
          'fill-extrusion-color-transition': { duration: 0 },
        },
      });
    }
    // Borough line overlay — raw borough MultiPolygon edges, GPU zoom-interpolated line-width.
    // Handles far-zoom (z<13) visibility smoothly without 3D geometry rebuilds.
    // The 3D fill-extrusion stays at constant z13+ size; this line layer grows instead.
    // Color matches the per-borough heatmap/standard tier color via _color property.
    if (!map.getSource('borough-line-source')) {
      map.addSource('borough-line-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: false, tolerance: 0 });
      map.addLayer({
        id: 'borough-line-overlay', type: 'line', source: 'borough-line-source',
        maxzoom: 13,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color':   ['coalesce', ['get', '_color'], OUTLINE_COLOR],
          'line-opacity': 0,
          // Outward-only: line-offset = half line-width. Fades out by z14.
          'line-width':   ['interpolate', ['linear'], ['zoom'], 9,2.5, 10,2, 11,1.5, 12,1, 13,0],
          'line-offset':  ['interpolate', ['linear'], ['zoom'], 9,1.25, 10,1, 11,0.75, 12,0.5, 13,0],
          'line-opacity-transition': { duration: 0 },
        },
      }, map.getLayer('zcta-fill') ? 'zcta-fill' : undefined);
    }
    // Borough hover fill + outline for interaction (uses raw borough polygons)
    if (!map.getSource('borough-hover-source')) {
      map.addSource('borough-hover-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: true });
      map.addLayer({
        id: 'borough-hover-fill', type: 'fill', source: 'borough-hover-source',
        paint: {
          'fill-color': '#7C3AED',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.18, 0],
        },
      });
      map.addLayer({
        id: 'borough-hover-outline', type: 'line', source: 'borough-hover-source',
        paint: {
          'line-color': '#4C1D95',
          'line-width': ['case', ['boolean', ['feature-state', 'hovered'], false], 3, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 1, 0],
        },
      });
      // No borough-border-hit line layer — we use 'borough-hover-fill' events directly,
      // with a queryRenderedFeatures guard that skips when a ZCTA zip is under the cursor.
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
      // If a pin is currently hovered, don't open zip panel — pin click takes priority
      if (hoveredPinEventRef.current) return;
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

    // Right-click on zip → geopost panel; right-click in borough border area → borough geopost panel
    map.on('contextmenu', e => {
      e.originalEvent.preventDefault();
      const features = map.queryRenderedFeatures(e.point, { layers: ['zcta-fill', 'zcta-safezone-hover'] });
      if (features.length > 0) {
        const zip = String(features[0].properties.MODZCTA || '');
        if (zip) { setMapPostsPanel({ type: 'zip', value: zip }); setMapPostsPage(0); return; }
      }
      // Check borough border area (no zip under cursor)
      const boroughFeatures = map.queryRenderedFeatures(e.point, { layers: ['borough-hover-fill'] });
      if (boroughFeatures.length > 0) {
        const boroughName = String(boroughFeatures[0].properties.BoroName || '');
        if (boroughName) { setMapPostsPanel({ type: 'borough', value: boroughName }); setMapPostsPage(0); }
      }
    });

    // Borough hover via 'borough-hover-fill' layer.
    // When cursor is inside a borough polygon, we check if a ZCTA zip is also under the cursor.
    // If yes → zip takes priority (return early, existing ZCTA handlers manage it).
    // If no (cursor in harbour/water border area) → borough hover activates.
    const handleBoroughFillHover = e => {
      if (!e.features.length) return;
      // Check all possible ZCTA layers (varies by 2D/3D mode) for zip under cursor
      const zctaLayers = ['zcta-fill', 'zcta-extrude', 'zcta-safezone-hover', 'zcta-safezone-fill']
        .filter(l => map.getLayer(l));
      if (zctaLayers.length > 0 && map.queryRenderedFeatures(e.point, { layers: zctaLayers }).length > 0) {
        // A zip is under the cursor — clear borough hover and let ZCTA handlers manage
        if (hoveredBoroughIdRef.current !== null) {
          map.setFeatureState({ source: 'borough-hover-source', id: hoveredBoroughIdRef.current }, { hovered: false });
          hoveredBoroughIdRef.current = null;
          setHoveredBorough(null);
        }
        return;
      }
      // No zip under cursor → this is harbour/water border area: activate borough hover
      const f = e.features[0];
      if (hoveredBoroughIdRef.current !== f.id) {
        if (hoveredBoroughIdRef.current !== null)
          map.setFeatureState({ source: 'borough-hover-source', id: hoveredBoroughIdRef.current }, { hovered: false });
        hoveredBoroughIdRef.current = f.id;
        map.setFeatureState({ source: 'borough-hover-source', id: f.id }, { hovered: true });
      }
      map.getCanvas().style.cursor = 'pointer';
      setHoveredBorough(String(f.properties.BoroName || ''));
      setTooltipPos({ x: e.point.x, y: e.point.y });
    };
    const handleBoroughFillLeave = () => {
      if (hoveredBoroughIdRef.current !== null) {
        map.setFeatureState({ source: 'borough-hover-source', id: hoveredBoroughIdRef.current }, { hovered: false });
        hoveredBoroughIdRef.current = null;
      }
      setHoveredBorough(null);
      if (hoveredIdRef.current === null) map.getCanvas().style.cursor = '';
    };
    // Left-click on borough border area → events+colonists side panel (right)
    const handleBoroughFillClick = e => {
      if (!e.features.length) return;
      // Zip takes priority for clicks too
      const zctaLayers = ['zcta-fill', 'zcta-extrude', 'zcta-safezone-hover', 'zcta-safezone-fill']
        .filter(l => map.getLayer(l));
      if (zctaLayers.length > 0 && map.queryRenderedFeatures(e.point, { layers: zctaLayers }).length > 0) return;
      const boroughName = String(e.features[0].properties.BoroName || '');
      if (boroughName) openBoroughSidePanel(boroughName);
    };
    map.on('mousemove', 'borough-hover-fill', handleBoroughFillHover);
    map.on('mouseleave', 'borough-hover-fill', handleBoroughFillLeave);
    map.on('click', 'borough-hover-fill', handleBoroughFillClick);

    // Mobile long-press: 1 second hold on zip opens MapPostsPanel; hold on borough border opens borough events panel
    const canvas = map.getCanvas();
    let touchTimer = null;
    let touchPoint = null;
    const onTouchStart = e => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      touchPoint = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      touchTimer = setTimeout(() => {
        if (!touchPoint) return;
        const zipFeats = map.queryRenderedFeatures([touchPoint.x, touchPoint.y], { layers: ['zcta-fill', 'zcta-safezone-hover'] });
        if (zipFeats.length > 0) {
          const zip = String(zipFeats[0].properties.MODZCTA || '');
          if (zip) { setMapPostsPanel({ type: 'zip', value: zip }); setMapPostsPage(0); }
          return;
        }
        // Borough border area long-press (no zip under cursor) — opens borough events side panel
        const boroughFeats = map.queryRenderedFeatures([touchPoint.x, touchPoint.y], { layers: ['borough-hover-fill'] });
        if (boroughFeats.length > 0) {
          const bn = String(boroughFeats[0].properties.BoroName || '');
          if (bn) openBoroughSidePanel(bn);
        }
      }, 1000);
    };
    const onTouchCancel = () => { clearTimeout(touchTimer); touchPoint = null; };
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchCancel, { passive: true });
    canvas.addEventListener('touchend', onTouchCancel, { passive: true });
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

  // Stage 4 + 6: pre-bake heatmap data + outline geocaches at end of Phase 2B warmup.
  // Once these are populated, every heatmap toggle / timespan switch / zoom-band change
  // is reduced to a single setData / setPaintProperty call — zero per-toggle iteration.
  // Fingerprinted by events so a fresh events load auto-invalidates and rebuilds.
  function runPrebakeAfterWarmup(map) {
    if (!geoData || !adjacency) return;
    const tiersByTs = precomputedTiersRef.current || mapCacheStore.precomputedTiers;
    if (!tiersByTs) return;

    // 1) precomputedZctaFills[ts] — withHeat FeatureCollection per timespan.
    // 2) precomputedHeatPoints[ts] — heat-underlay weighted point GeoJSON.
    const zctaFills = {};
    const heatPoints = {};
    const boroughTiers = {};
    const boroughExprs = {};
    const TIER_COLORS = ['#00ccdd', '#00dd66', '#f5c800', '#dd6600', '#cc0d00'];
    const boroughCount = (mapCacheStore.boroughGeoData?.features || []).length || 0;

    for (let ts = 0; ts < 5; ts++) {
      const pre = tiersByTs[ts];
      if (!pre) continue;
      const { zipMap, maxCount, tiers } = pre;
      const withHeat = {
        ...geoData,
        features: geoData.features.map((f, i) => {
          const tier = tiers[i];
          const zip = String(f.properties.MODZCTA || '');
          const rawHeat = f.properties._special ? 0 : normalizeHeat(zipMap[zip]?.length || 0, maxCount);
          return { ...f, properties: { ...f.properties, _heat: rawHeat, _tier: tier < 0 ? 0 : tier } };
        }),
      };
      zctaFills[ts] = withHeat;
      heatPoints[ts] = buildHeatUnderlayPoints(withHeat, tiers);

      // Per-borough avg tier + match expression. Populated only if boroughGeoData + zipBoroughMap exist.
      if (boroughCount && mapCacheStore.zipBoroughMap) {
        const avgTiers = computeBoroughAvgTiers(tiers, mapCacheStore.zipBoroughMap, boroughCount);
        boroughTiers[ts] = avgTiers;
        const onExpr = ['match', ['get', '_boroughIdx']];
        const offExpr = ['match', ['get', '_boroughIdx']];
        for (let bi = 0; bi < boroughCount; bi++) {
          const t = avgTiers[bi] ?? 0;
          onExpr.push(bi, TIER_COLORS[Math.max(0, Math.min(4, t))]);
          offExpr.push(bi, '#ff2200');
        }
        onExpr.push('#ff2200');
        offExpr.push('#ff2200');
        boroughExprs[ts] = { on: onExpr, off: offExpr };
      }
    }

    mapCacheStore.precomputedZctaFills = zctaFills;
    mapCacheStore.precomputedHeatPoints = heatPoints;
    mapCacheStore.precomputedBoroughTiers = boroughTiers;
    mapCacheStore.precomputedBoroughExprs = boroughExprs;

    // 3) outlineGeoCache[intZoom] — ZCTA outline GeoJSON per integer zoom band (z9–z16).
    // Static for the session (no heatmap dependency for geometry; widths only).
    const outCache = {};
    const boroughOutCache = {};
    const tsRef = (timespanIdxRef.current ?? 2);
    const baseFc = zctaFills[tsRef] || zctaFills[2] || zctaFills[0];
    if (baseFc) {
      for (let z = 9; z <= 16; z++) {
        try {
          const w = getZoomAwareOutlineWidth(map, z, threeD);
          outCache[z] = createZctaOutlineGeoJSON(baseFc, w);
        } catch (_e) { /* skip this zoom band */ }
      }
    }
    if (mapCacheStore.boroughSkeleton) {
      // Pre-bake borough outline geometry for each integer zoom band z9–z16.
      // Width is computed at each integer zoom with a fixed reference pitch (55 = real3D max),
      // which is at most 3% wider than 3D-mode pitch (48) — imperceptible difference.
      // Color overrides are NOT baked in; they are merged live in doOutlineRebuild so that
      // heatmap recolors and timespan changes update correctly without re-baking.
      const PREBAKE_PITCH = 55;
      for (let z = 9; z <= 16; z++) {
        try {
          const w = getZoomAwareOutlineWidth(map, 18, true, z, PREBAKE_PITCH);
          boroughOutCache[z] = generateBoroughQuadsFromSkeleton(mapCacheStore.boroughSkeleton, w, null);
        } catch (_e) { /* skip bad zoom band */ }
      }
    }
    mapCacheStore.outlineGeoCache = outCache;
    mapCacheStore.boroughOutlineGeoCache = boroughOutCache;

    // Fingerprint = bind to current events signature so a fresh events load invalidates.
    mapCacheStore.prebakeFingerprint = lastTierFingerprintRef.current || null;
  }

  const warmupStartedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData) return;
    // addLayers fires immediately on mapReady+geoData (no phase2ADone gate) so that
    // zcta-fill is inserted into the MapLibre style list BEFORE road fill layers
    // (added later by initReal3DLayers). Later-added fills paint on top in painter's pass,
    // so road fills must come after zcta-fill to appear above it visually.
    addLayers(map, geoData, satellite);
    // Signal MapLoadingScreen Phase 2B that layers are ready → overlay will reveal the map
    mapCacheStore.layersReady = true;
    // Gate: Phase 2A must complete before the warmup sweep so precomputedTiers is
    // populated in mapCacheStore when warmup's expression pre-build runs.
    if (!phase2ADone) return;
    // Phase 2A just finished — sync its precomputedTiers + zipToZcta refs NOW so the
    // expression pre-build at the end of the sweep always has data. Without this,
    // the geoData effect (which fires before Phase 2A finishes) would have found
    // mapCacheStore.precomputedTiers null and left precomputedTiersRef unset.
    if (mapCacheStore.precomputedTiers && !precomputedTiersRef.current) {
      precomputedTiersRef.current = mapCacheStore.precomputedTiers;
    }
    if (!zipToZctaIdxMapRef.current && geoData?.features) {
      const lookup = {};
      geoData.features.forEach((f, i) => {
        const z = f.properties?.MODZCTA;
        if (z) lookup[String(z)] = i;
      });
      zipToZctaIdxMapRef.current = lookup;
    }
    // Warmup runs ONCE per session — even if effect deps change (geoData re-fetch etc),
    // we never want a second sweep firing after the user is interacting with the map.
    if (warmupStartedRef.current) return;
    warmupStartedRef.current = true;
    // GPU warm-up: thoroughly pan across all 5 boroughs at every zoom level so the
    // session tile cache contains every roads/water/zip-outline tile NYC will ever need.
    // After this completes, every pan and zoom in the user's session is instant —
    // no fetch, no parse, no flicker. Skip on mobile to save battery + bandwidth.
    if (window.innerWidth >= 768) {
      requestAnimationFrame(() => {
        try {
          const origCenter = map.getCenter();
          const origZoom = map.getZoom();

          // ── Aggressive grid-based warm sweep ──────────────────────────────
          // Goal: cover the ENTIRE NYC bbox at every integer zoom so MapLibre
          // fetches + parses every vector tile (water, roads, buildings, outlines)
          // and compiles every fill-extrusion paint shader. Tiles land in the session
          // tile cache so subsequent pans/zooms in-session have zero fetch cost.
          //
          // Tile-grid sweep counts (NYC bbox ~25mi × 25mi):
          //   z9-10  : 1 jump (whole NYC fits in screen at min zoom)
          //   z11    : 2 jumps (W/E split)
          //   z12    : 4 jumps (2×2)
          //   z13    : 9 jumps (3×3)
          //   z14-16 : 16 jumps (4×4) — tile-dense, GPU stress test
          // Total ≈ 65 jumps. RAF-paced ≈ 1s on desktop.
          const NYC_BBOX = { lng1: -74.27, lat1: 40.47, lng2: -73.68, lat2: 40.93 };
          const gridForZoom = (z, divs) => {
            const pts = [];
            const dLng = (NYC_BBOX.lng2 - NYC_BBOX.lng1) / divs;
            const dLat = (NYC_BBOX.lat2 - NYC_BBOX.lat1) / divs;
            for (let i = 0; i < divs; i++) {
              for (let j = 0; j < divs; j++) {
                pts.push([NYC_BBOX.lng1 + dLng * (i + 0.5), NYC_BBOX.lat1 + dLat * (j + 0.5)]);
              }
            }
            return pts;
          };

          const realLayers = REAL3D_ALL_LAYER_IDS;
          const setRealVis = (vis) => {
            for (const id of realLayers) {
              if (map.getLayer(id)) {
                try { map.setLayoutProperty(id, 'visibility', vis); } catch (_e) { /* */ }
              }
            }
          };
          const setExtruded3D = (on) => {
            try {
              if (map.getLayer('zcta-extrude')) map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', on ? 0.9 : 0);
              if (map.getLayer('zcta-outline')) map.setPaintProperty('zcta-outline', 'fill-extrusion-opacity', on ? 0.95 : 0);
            } catch (_e) { /* */ }
          };
          // Briefly enable heat-underlay during sweep so heatmap shaders compile too.
          const setHeatVis = (on) => {
            if (map.getLayer('heat-underlay')) {
              try { map.setPaintProperty('heat-underlay', 'heatmap-opacity', on ? 0.5 : 0); } catch (_e) { /* */ }
            }
          };
          // Briefly add satellite raster sources during sweep so MapLibre fetches +
          // composites every satellite tile across NYC at every zoom. Cleared at end.
          // 3-tier: ArcGIS z9-10, Wayback z11-12 (2018-01-18 lock), Clarity z13-16.
          const addSatLayersForWarmup = () => {
            try {
              const layersStyle = map.getStyle().layers;
              const firstLayerId = layersStyle.length > 0 ? layersStyle[0].id : undefined;
              // Source maxzoom MUST be higher than layer maxzoom: MapLibre adds +1 to
              // tile zoom for 256px raster tiles. Source max=19 ensures native-resolution
              // tiles are fetched at every layer-visible zoom (no overscaling = no blur).
              if (!map.getSource('sat-source-arcgis')) {
                map.addSource('sat-source-arcgis', { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, minzoom: 0, maxzoom: 19 });
              }
              if (!map.getSource('sat-source-wayback')) {
                map.addSource('sat-source-wayback', { type: 'raster', tiles: ['https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13045/{z}/{y}/{x}'], tileSize: 256, minzoom: 0, maxzoom: 19 });
              }
              if (!map.getSource('sat-source')) {
                map.addSource('sat-source', { type: 'raster', tiles: ['https://clarity.maptiles.arcgis.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, minzoom: 0, maxzoom: 19 });
              }
              if (!map.getLayer('sat-layer-arcgis')) map.addLayer({ id: 'sat-layer-arcgis', type: 'raster', source: 'sat-source-arcgis', minzoom: 9, maxzoom: 10.5, paint: { 'raster-opacity': 0.01, 'raster-fade-duration': 0 } }, firstLayerId);
              if (!map.getLayer('sat-layer-wayback')) map.addLayer({ id: 'sat-layer-wayback', type: 'raster', source: 'sat-source-wayback', minzoom: 10.5, maxzoom: 13, paint: { 'raster-opacity': 0.01, 'raster-fade-duration': 0 } }, firstLayerId);
              if (!map.getLayer('sat-layer')) map.addLayer({ id: 'sat-layer', type: 'raster', source: 'sat-source', minzoom: 13, maxzoom: 17, paint: { 'raster-opacity': 0.01, 'raster-fade-duration': 0 } }, firstLayerId);
            } catch (_e) { /* */ }
          };
          const removeSatLayersAfterWarmup = () => {
            if (satellite) return;
            try {
              if (map.getLayer('sat-layer')) map.removeLayer('sat-layer');
              if (map.getLayer('sat-layer-wayback')) map.removeLayer('sat-layer-wayback');
              if (map.getLayer('sat-layer-arcgis')) map.removeLayer('sat-layer-arcgis');
              if (map.getSource('sat-source')) map.removeSource('sat-source');
              if (map.getSource('sat-source-wayback')) map.removeSource('sat-source-wayback');
              if (map.getSource('sat-source-arcgis')) map.removeSource('sat-source-arcgis');
            } catch (_e) { /* */ }
          };

          addSatLayersForWarmup();

          // Build the full sweep: tile-dense grid per zoom
          // Sweep value: shader compilation across all zooms + tile-fetch coverage at z9-z14.
          // SW cache makes raw tile fetches ~0ms; warmup's main job is GPU shader compile.
          const sweep = [];
          for (const z of [9, 10]) for (const c of gridForZoom(z, 1)) sweep.push({ center: c, zoom: z });
          for (const c of gridForZoom(11, 2)) sweep.push({ center: c, zoom: 11 });
          for (const c of gridForZoom(12, 2)) sweep.push({ center: c, zoom: 12 });
          for (const c of gridForZoom(13, 4)) sweep.push({ center: c, zoom: 13 });
          for (const c of gridForZoom(14, 6)) sweep.push({ center: c, zoom: 14 });
          for (const c of gridForZoom(15, 6)) sweep.push({ center: c, zoom: 15 });
          for (const c of gridForZoom(16, 6)) sweep.push({ center: c, zoom: 16 });

          let i = 0;
          const step = () => {
            if (i >= sweep.length) {
              // Restore: default 2D state — original camera, no pitch/bearing,
              // all Real3D layers hidden, satellite removed (unless user enabled it),
              // heat-underlay opacity off, 3D extrusions off.
              setRealVis('none');
              setExtruded3D(false);
              setHeatVis(false);
              removeSatLayersAfterWarmup();
              map.jumpTo({ center: origCenter, zoom: origZoom, pitch: 0, bearing: 0 });
              // Pre-build all 10 building heatmap match expressions (5 timespans × 2 modes)
              // and store in memoizedExprs cache so first heatmap/timespan toggle is instant
              // (no per-toggle expression construction). Only valid if tiers + zip→ZCTA are ready.
              try {
                if (precomputedTiersRef.current && zipToZctaIdxMapRef.current) {
                  for (let ts = 0; ts < 5; ts++) {
                    buildingColorExprByState(false, ts);
                    buildingColorExprByState(true, ts);
                  }
                }
              } catch (_e) { /* prebuild best-effort */ }
              // Stage 4 + 6: pre-bake heatmap data + outline geometry caches so all
              // future toggles are instant setData/setPaintProperty calls.
              try { runPrebakeAfterWarmup(map); } catch (_e) { /* best-effort */ }
              mapCacheStore.warmupComplete = true;
              return;
            }
            const { center, zoom } = sweep[i++];
            // Briefly show Real3D layers at z>=13 (baseplates start there)
            setRealVis(zoom >= 13 ? 'visible' : 'none');
            // 3D extrusion shader compile at z>=11
            setExtruded3D(zoom >= 11);
            // Heatmap underlay shader compile at all zooms briefly
            setHeatVis(true);
            // Pitch matrix: real3d (55) at z>=14 for real3d shader compile, 3D (48) at z11-13.
            const pitchSweep = zoom >= 14 ? 55 : (zoom >= 11 ? 48 : 0);
            map.jumpTo({ center, zoom, pitch: pitchSweep, bearing: zoom >= 11 ? -17 : 0 });
            requestAnimationFrame(step);
          };
          // Defer one frame so layer pre-creation effect runs first.
          requestAnimationFrame(step);
        } catch (_e) { mapCacheStore.warmupComplete = true; /* warmup best-effort */ }
      });
    } else {
      // Mobile: lite warmup sweep + expression pre-build + prebake.
      // Smaller grid (≈16 jumps vs 65 desktop) keeps total mobile sweep ~600-800ms.
      // All runs reset to 2D state at end so no active GPU drag during normal usage.
      requestAnimationFrame(() => {
        try {
          const origCenter = map.getCenter();
          const origZoom = map.getZoom();
          const NYC_BBOX_M = { lng1: -74.27, lat1: 40.47, lng2: -73.68, lat2: 40.93 };
          const gridForZoomM = (z, divs) => {
            const pts = [];
            const dLng = (NYC_BBOX_M.lng2 - NYC_BBOX_M.lng1) / divs;
            const dLat = (NYC_BBOX_M.lat2 - NYC_BBOX_M.lat1) / divs;
            for (let i = 0; i < divs; i++) for (let j = 0; j < divs; j++)
              pts.push([NYC_BBOX_M.lng1 + dLng * (i + 0.5), NYC_BBOX_M.lat1 + dLat * (j + 0.5)]);
            return pts;
          };
          const realLayersM = REAL3D_ALL_LAYER_IDS;
          const setRealVisM = (vis) => {
            for (const id of realLayersM) {
              if (map.getLayer(id)) { try { map.setLayoutProperty(id, 'visibility', vis); } catch (_e) {} }
            }
          };
          const setExtruded3DM = (on) => {
            try {
              if (map.getLayer('zcta-extrude')) map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', on ? 0.9 : 0);
              if (map.getLayer('zcta-outline')) map.setPaintProperty('zcta-outline', 'fill-extrusion-opacity', on ? 0.95 : 0);
            } catch (_e) {}
          };
          const setHeatVisM = (on) => {
            if (map.getLayer('heat-underlay')) {
              try { map.setPaintProperty('heat-underlay', 'heatmap-opacity', on ? 0.5 : 0); } catch (_e) {}
            }
          };
          // Lite mobile sweep: cover all integer zooms once with reduced grid density.
          // Total ≈ 16 jumps vs desktop's 65. Real3D pitch=55 at z>=14 to compile real3d shaders.
          const sweepM = [];
          for (const z of [9, 10, 11, 12]) for (const c of gridForZoomM(z, 1)) sweepM.push({ center: c, zoom: z });
          for (const c of gridForZoomM(13, 2)) sweepM.push({ center: c, zoom: 13 });
          for (const c of gridForZoomM(14, 2)) sweepM.push({ center: c, zoom: 14 });
          for (const c of gridForZoomM(15, 2)) sweepM.push({ center: c, zoom: 15 });
          for (const c of gridForZoomM(16, 2)) sweepM.push({ center: c, zoom: 16 });
          let mi = 0;
          const stepM = () => {
            if (mi >= sweepM.length) {
              setRealVisM('none');
              setExtruded3DM(false);
              setHeatVisM(false);
              map.jumpTo({ center: origCenter, zoom: origZoom, pitch: 0, bearing: 0 });
              try {
                if (precomputedTiersRef.current && zipToZctaIdxMapRef.current) {
                  for (let ts = 0; ts < 5; ts++) {
                    buildingColorExprByState(false, ts);
                    buildingColorExprByState(true, ts);
                  }
                }
              } catch (_e) {}
              try { runPrebakeAfterWarmup(map); } catch (_e) {}
              mapCacheStore.warmupComplete = true;
              return;
            }
            const { center, zoom } = sweepM[mi++];
            setRealVisM(zoom >= 13 ? 'visible' : 'none');
            setExtruded3DM(zoom >= 11);
            setHeatVisM(true);
            // Use real3d pitch (55) at z>=14 so real3d shaders compile under correct projection
            const pitch = zoom >= 14 ? 55 : (zoom >= 11 ? 48 : 0);
            map.jumpTo({ center, zoom, pitch, bearing: zoom >= 11 ? -17 : 0 });
            requestAnimationFrame(stepM);
          };
          requestAnimationFrame(stepM);
        } catch (_e) { mapCacheStore.warmupComplete = true; }
      });
    }
  }, [mapReady, geoData, phase2ADone]); // eslint-disable-line react-hooks/exhaustive-deps
  // Also pre-adds nyc-buildings PMTiles source so the SW-cached PMTiles directory
  // is fetched/parsed before Real3D is ever toggled — eliminates header-fetch hang on toggle.
  // Mobile: source is added (cheap), but layers are deferred to first Real3D toggle to save GPU memory.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData) return;
    // Pre-add PMTiles source on both desktop AND mobile so MapLibre parses the
    // PMTiles directory immediately (16KB range fetch, served from SW in-memory = ~0ms warm).
    if (!map.getSource('nyc-buildings')) {
      map.addSource('nyc-buildings', {
        type: 'vector',
        url: `pmtiles://${BUILDINGS_PMTILES_URL}`,
        minzoom: 13,
        maxzoom: 16,
        promoteId: 'b',
      });
    }
    // Mobile: pre-create Real3D layers too (cheap; visibility=none after warmup ⇒ 0 GPU draw cost,
    // but layers + paint exprs exist so first toggle is instant).
    if (real3dLayersCreatedRef.current) return;
    initReal3DLayers(map, heatmapRef.current, timespanIdxRef.current ?? 2);
    setReal3DLayersVisible(map, false);
  }, [mapReady, geoData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-compute tiers for all 5 timespans in background.
  // Hydrate from mapCacheStore if Phase 2A already computed them; else compute fresh.
  const lastTierFingerprintRef = useRef(null);
  useEffect(() => {
    if (!geoData || !adjacency || !events?.length) return;
    // Fingerprint check: skip recompute if events array signature is unchanged.
    // Tier data only changes downstream of event data — same events ⇒ same tiers.
    // Strong fingerprint: hash of sorted event IDs catches adds/removes/reorders.
    let h = 5381 ^ events.length;
    const ids = events.map(e => String(e?.id ?? '')).sort();
    for (let k = 0; k < ids.length; k++) {
      const s = ids[k];
      for (let j = 0; j < s.length; j++) h = ((h << 5) + h) ^ s.charCodeAt(j);
    }
    const fp = `${events.length}:${(h >>> 0).toString(36)}`;
    if (lastTierFingerprintRef.current === fp && precomputedTiersRef.current) return;
    lastTierFingerprintRef.current = fp;
    // Stage 6: invalidate prebake caches when events change (will be rebuilt next time
    // runPrebakeAfterWarmup runs OR consumed-as-fallback meanwhile).
    if (mapCacheStore.prebakeFingerprint && mapCacheStore.prebakeFingerprint !== fp) {
      mapCacheStore.precomputedZctaFills = null;
      mapCacheStore.precomputedHeatPoints = null;
      mapCacheStore.precomputedBoroughTiers = null;
      mapCacheStore.precomputedBoroughExprs = null;
      mapCacheStore.prebakeFingerprint = null;
    }
    if (mapCacheStore.precomputedTiers) {
      precomputedTiersRef.current = mapCacheStore.precomputedTiers;
      memoizedExprs.current = {};
      refreshBuildingColors();
    }
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
        // PMTiles tier coloring is via [match, ['get','z'], ...] expression — just
        // refresh the paint expression to pick up new tier values.
        memoizedExprs.current = {};
        refreshBuildingColors();
        // Stage 6: rebuild prebake caches in background using the fresh tiers.
        try {
          const map = mapRef.current;
          if (map) requestIdleCallback ? requestIdleCallback(() => runPrebakeAfterWarmup(map)) : setTimeout(() => runPrebakeAfterWarmup(map), 0);
        } catch (_e) { /* */ }
      }
    })();
    return () => { cancelled = true; };
  }, [events, geoData, adjacency]);

  // interactive prop — disable/enable all MapLibre handlers when changed.
  // Set to false during Phase 2B loading so nothing can be accidentally interacted with.
  // Also acts as "Gear 2": when interactive flips true (Phase 2A + warmup done), load
  // precomputedTiers from mapCacheStore and fire an initial buildingColors refresh so
  // heatmap colors are correct on the very first toggle without user re-triggering.
  useEffect(() => {
    interactiveRef.current = interactive;
    const map = mapRef.current;
    if (!map) return;
    const handlers = [
      map.scrollZoom, map.boxZoom, map.dragRotate, map.dragPan,
      map.keyboard, map.doubleClickZoom, map.touchZoomRotate, map.touchPitch,
    ];
    if (interactive) {
      handlers.forEach(h => h?.enable?.());
      // Phase 2A just finished — sync cached tiers into render refs so first heatmap
      // toggle is instant and shows correct colors without a redundant recompute.
      if (mapCacheStore.precomputedTiers && !precomputedTiersRef.current) {
        precomputedTiersRef.current = mapCacheStore.precomputedTiers;
      }
      if (precomputedTiersRef.current) {
        memoizedExprs.current = {};
        refreshBuildingColors();
      }
    } else {
      handlers.forEach(h => h?.disable?.());
    }
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manage hover layers based on 3D/Real3D state.
  // 3D: hover on zcta-extrude + zcta-safezone-fill (2D fill, no z-fighting in 3D).
  // 2D/Real3D: hover on zcta-fill + zcta-safezone-hover.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer('zcta-fill')) return;
    
    const { handleZctaHover, handleZctaLeave, handleZctaClick } = layerHandlersRef.current;
    if (!handleZctaHover) return;

    // Clear all previous hover registrations first
    ['zcta-fill', 'zcta-extrude', 'zcta-safezone-hover', 'zcta-safezone-fill'].forEach(layerId => {
      if (!map.getLayer(layerId)) return;
      map.off('mousemove', layerId, handleZctaHover);
      map.off('mouseleave', layerId, handleZctaLeave);
      map.off('click', layerId, handleZctaClick);
    });

    if (threeD) {
      // 3D mode: hover on extruded zips + safezone fill
      map.on('mousemove', 'zcta-extrude', handleZctaHover);
      map.on('mouseleave', 'zcta-extrude', handleZctaLeave);
      map.on('click', 'zcta-extrude', handleZctaClick);
      if (map.getLayer('zcta-safezone-fill')) {
        map.on('mousemove', 'zcta-safezone-fill', handleZctaHover);
        map.on('mouseleave', 'zcta-safezone-fill', handleZctaLeave);
        map.on('click', 'zcta-safezone-fill', handleZctaClick);
      }
    } else {
      // 2D / Real3D: hover on flat fill + safezone hover fill
      map.on('mousemove', 'zcta-fill', handleZctaHover);
      map.on('mouseleave', 'zcta-fill', handleZctaLeave);
      map.on('click', 'zcta-fill', handleZctaClick);
      map.on('mousemove', 'zcta-safezone-hover', handleZctaHover);
      map.on('mouseleave', 'zcta-safezone-hover', handleZctaLeave);
      map.on('click', 'zcta-safezone-hover', handleZctaClick);
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
      // Stage 6: prefer pre-baked data when available (instant, no per-feature mapping).
      const preFill = mapCacheStore.precomputedZctaFills?.[timespanIdx];
      const precomputed = precomputedTiersRef.current?.[timespanIdx];
      if (precomputed) {
        ({ zipMap, maxCount, tiers } = precomputed);
      } else {
        ({ zipMap, maxCount } = buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days));
        tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
      }
      if (preFill) {
        withHeat = preFill;
      } else {
        withHeat = {
          ...geoData,
          features: geoData.features.map((f, i) => {
            const tier = tiers[i];
            const zip = String(f.properties.MODZCTA || '');
            const rawHeat = f.properties._special ? 0 : normalizeHeat(zipMap[zip]?.length || 0, maxCount);
            return { ...f, properties: { ...f.properties, _heat: rawHeat, _tier: tier < 0 ? 0 : tier } };
          }),
        };
      }
      cachedTierDataRef.current = { events, timespanIdx, geoData, zipMap, maxCount, tiers, withHeat };
      tiersRef.current = tiers;
      withHeatRef.current = withHeat;
      // Bump revision so the per-integer-zoom outline cache key invalidates.
      outlineCacheRevRef.current = (outlineCacheRevRef.current + 1) | 0;
      // Publish zip heat index to localStorage — used by roaming points + future features.
      // Updated every time the heatmap data changes (events or timespan).
      try {
        const zipHeat = {};
        if (maxCount > 0) {
          for (const [zip, evts] of Object.entries(zipMap)) {
            zipHeat[zip] = normalizeHeat(evts.length, maxCount);
          }
        }
        localStorage.setItem('lapuff_zip_heat', JSON.stringify(zipHeat));
      } catch (e) { /* storage unavailable */ }
      if (map.getSource('zcta')) map.getSource('zcta').setData(withHeat);
      if (map.getSource('zcta-outline')) {
        map.getSource('zcta-outline').setData(createZctaOutlineGeoJSON(withHeat, getZoomAwareOutlineWidth(map, undefined, threeD || real3D)));
      }
    } else {
      ({ zipMap, maxCount, tiers, withHeat } = cached);
    }


    // Topographic heat underlay — update point data from zip centroids.
    // Enabled when heatmap is ON and the topo toggle is on. Visible in ALL modes (2D, 3D, Real3D).
    // No separate canvas needed — `['within']` handles NYC restriction, topo glow radiates naturally.
    if (map.getSource('heat-underlay')) {
      if (heatmap && topoOn) {
        const prePts = mapCacheStore.precomputedHeatPoints?.[timespanIdx];
        map.getSource('heat-underlay').setData(prePts || buildHeatUnderlayPoints(withHeat, tiers));
        map.setPaintProperty('heat-underlay', 'heatmap-opacity', satellite ? 0.5 : 0.9);
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
          // Real3D 4-combo zcta-fill matrix (same as 2D behavior):
          // heatmap OFF + sat OFF → 1.0  |  heatmap ON + sat OFF → 1.0
          // heatmap OFF + sat ON  → 0.4  |  heatmap ON + sat ON  → 0.4
          if (real3D) {
            map.setPaintProperty('zcta-fill', 'fill-opacity', satellite ? 0.6 : 1.0);
          } else if (!satellite && !topoOn) {
            map.setPaintProperty('zcta-fill', 'fill-opacity', 1.0);
          } else {
            map.setPaintProperty('zcta-fill', 'fill-opacity', satellite || topoOn ? 0.35 : 0.45);
          }
        }


      if (threeD) {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 0);
        // In 3D mode: use zcta-safe-extrude (fill-extrusion) so safezones depth-test against
        // zip extrusions. zcta-safezone-fill (2D) would composite above the FBO — x-ray artifact.
        if (map.getLayer('zcta-safe-extrude')) {
          map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-color', '#ffffff');
          map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-height', 1);
          map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-opacity', 0.72);
        }
        if (map.getLayer('zcta-safezone-fill')) map.setPaintProperty('zcta-safezone-fill', 'fill-opacity', 0);
        // Show far-zoom 2D line to bridge z9–z12 (zcta-outline annular cap is frozen at z12 size)
        if (map.getLayer('zcta-3d-line')) map.setPaintProperty('zcta-3d-line', 'line-opacity', 1);

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
        // 2D heatmap — also used for Real3D (2D zcta-fill + zcta-line stay visible;
        // opaque 3D buildings and roads occlude them via render order).
        // safe-line visible in Real3D (zcta-safezone-fill is 2D, no z-fighting).
        if (map.getLayer('zcta-safe-extrude')) map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-opacity', 0);
        if (map.getLayer('zcta-3d-line')) map.setPaintProperty('zcta-3d-line', 'line-opacity', 0);
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 1);
        if (map.getLayer('zcta-safezone-fill')) map.setPaintProperty('zcta-safezone-fill', 'fill-opacity', satellite ? 0.22 : 1.0);
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
      // In pure 2D mode (no 3D/Real3D/satellite) use a slightly lighter fill so zips are
      // distinguishable from the #0d0000 canvas background without overpowering the bright outlines.
      const noHeatFill = (!threeD && !real3D && !satellite) ? '#2d0a0a' : '#1a0505';
      map.setPaintProperty('zcta-fill', 'fill-color', noHeatFill);
      // FIX ADDITIVE STATE / 3D ARTIFACTING: zero opacity in 3D so the flat fill
      // doesn't appear as stray 2D surfaces beneath or through extrusions.
      // In 2D and Real3D non-heatmap modes make the dark fill more visible; leave 3D unchanged
        if (threeD) {
          map.setPaintProperty('zcta-fill', 'fill-opacity', 0);
        } else {
          // Real3D 4-combo zcta-fill matrix (same as 2D behavior):
          // sat OFF → 1.0 opaque  |  sat ON → 0.4
          map.setPaintProperty('zcta-fill', 'fill-opacity',
            real3D ? (satellite ? 0.6 : 1.0) : (satellite ? 0.65 : 0.75));
        }

      if (threeD) {
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 0);
        // In 3D mode: use zcta-safe-extrude (fill-extrusion) so safezones depth-test against
        // zip extrusions. zcta-safezone-fill (2D) would composite above the FBO — x-ray artifact.
        if (map.getLayer('zcta-safe-extrude')) {
          map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-color', '#ffffff');
          map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-height', 1);
          map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-opacity', 0.72);
        }
        if (map.getLayer('zcta-safezone-fill')) map.setPaintProperty('zcta-safezone-fill', 'fill-opacity', 0);
        // Show far-zoom 2D line to bridge z9–z12 (zcta-outline annular cap is frozen at z12 size)
        if (map.getLayer('zcta-3d-line')) map.setPaintProperty('zcta-3d-line', 'line-opacity', 1);
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
        // 2D non-heatmap — also used for Real3D (2D zcta-fill + zcta-line stay visible).
        // safe-line visible in Real3D (zcta-safezone-fill is 2D, no z-fighting).
        if (map.getLayer('zcta-safe-extrude')) map.setPaintProperty('zcta-safe-extrude', 'fill-extrusion-opacity', 0);
        if (map.getLayer('zcta-3d-line')) map.setPaintProperty('zcta-3d-line', 'line-opacity', 0);
        map.setPaintProperty('zcta-safe-line', 'line-opacity', 1);
        if (map.getLayer('zcta-safezone-fill')) map.setPaintProperty('zcta-safezone-fill', 'fill-opacity', satellite ? 0.22 : 1.0);
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

    // Re-apply locked outline widths for 2D / Real3D (defensive: enforce after any style swap)
    if (!threeD) {
      try {
        if (map.getLayer('zcta-safe-line')) map.setPaintProperty('zcta-safe-line', 'line-width', zctaLineWidthExpr(0.8));
        if (map.getLayer('zcta-line-glow2')) map.setPaintProperty('zcta-line-glow2', 'line-width', zctaLineWidthExpr(1.6));
        if (map.getLayer('zcta-line-glow')) map.setPaintProperty('zcta-line-glow', 'line-width', zctaLineWidthExpr(1.25));
        if (map.getLayer('zcta-line')) map.setPaintProperty('zcta-line', 'line-width', zctaLineWidthExpr(1));
      } catch (e) { /* ignore */ }
      if (!heatmap) {
        try {
          if (map.getLayer('zcta-line')) map.setPaintProperty('zcta-line', 'line-color', OUTLINE_COLOR);
          if (map.getLayer('zcta-line-glow')) map.setPaintProperty('zcta-line-glow', 'line-color', OUTLINE_COLOR);
          if (map.getLayer('zcta-line-glow2')) map.setPaintProperty('zcta-line-glow2', 'line-color', OUTLINE_GLOW);
          if (map.getLayer('zcta-safe-line')) map.setPaintProperty('zcta-safe-line', 'line-color', '#000000');
        } catch (e) { /* ignore */ }
      }
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
      if (boroughGeoDataRef.current) {
        const avgTiers = computeBoroughAvgTiers(
          tiers,
          zipBoroughMapRef.current,
          boroughGeoDataRef.current.features.length
        );
        boroughAvgTiersRef.current = avgTiers;
        const coloredBorough = buildColoredBoroughFeatures(boroughGeoDataRef.current, avgTiers, heatmap);
        boroughWithColorRef.current = coloredBorough;

        // Key = geometry-affecting parameters. is3D MUST be included: 2D vs 3D quads have
        // different physical widths → different safezone PiP results → different filterSet indices.
        // Reusing a 2D-derived filterSet on 3D quads (or vice versa) causes fragmentation.
        const is3D = threeD || real3D;
        const boroughGeoKey = `${heatmap ? 1 : 0}|${timespanIdx}|${events?.length ?? 0}|${is3D ? 1 : 0}`;
        // Real3D: freeze at z13 equivalent — 2D line overlay handles far-zoom growth.
        // 3D (threeD): no freeze — fill-extrusion itself resizes per zoom (no 2D line in 3D mode).
        const widthMeters = getZoomAwareOutlineWidth(map, 18, is3D, real3D ? 13 : null);

        // Use precomputed skeleton path (O(vertices) linear math, no polygon normalization).
        // Fall back to createOutlineGeoJSON only on first render before skeleton is ready.
        const overrides = coloredBorough.features.map(f => f.properties);
        let boroughQuads;
        if (boroughSkeletonRef.current) {
          boroughQuads = generateBoroughQuadsFromSkeleton(boroughSkeletonRef.current, widthMeters, overrides);
        } else {
          boroughQuads = createOutlineGeoJSON(coloredBorough, widthMeters);
        }

        // Only redo the expensive safezone PiP filter when tier/heatmap data actually changed.
        // On Real3D/3D toggle the geometry key doesn't change — reuse boroughQuadFilterRef.
        if (boroughGeoKey !== boroughGeoKeyRef.current || !boroughQuadFilterRef.current) {
          const safezoneFeatures = geoData?.features?.filter(f => f.properties?._special) || [];
          const { filtered, removedIdxSet } = removeSafezoneOverlapQuads(boroughQuads, safezoneFeatures);
          boroughQuadFilterRef.current = removedIdxSet;
          boroughGeoKeyRef.current = boroughGeoKey;
          map.getSource('borough-source').setData(filtered);
        } else {
          // Fast path: re-apply cached filter (O(n) index filter, no PiP)
          const filterSet = boroughQuadFilterRef.current;
          const filtered = filterSet.size > 0
            ? { ...boroughQuads, features: boroughQuads.features.filter((_, i) => !filterSet.has(i)) }
            : boroughQuads;
          map.getSource('borough-source').setData(filtered);
        }
        // Borough line overlay (z<13 smooth visibility): update raw borough source with colored features.
        // Uses the same coloredBorough (with _color per feature) so color stays in sync with heatmap.
        if (map.getSource('borough-line-source')) {
          map.getSource('borough-line-source').setData(coloredBorough);
        }
        // Borough color: read baked _color from features — mid-brightness for visibility
        map.setPaintProperty('borough-outline', 'fill-extrusion-color', ['coalesce', ['get', '_color'], OUTLINE_COLOR]);
        // Base 0 → full extrusion blocks from ground to max height.
        // Height stagger by _boroughIdx * 0.1m prevents Z-fighting at shared top edges.
        map.setPaintProperty('borough-outline', 'fill-extrusion-base',   0.5);
        map.setPaintProperty('borough-outline', 'fill-extrusion-height', ['+', 32.5, ['*', 0.1, ['coalesce', ['get', '_boroughIdx'], 0]]]);
        // Borough outlines only visible in 3D and Real3D modes (fill-extrusions appear
        // as flat rings at pitch=0 which looks wrong in 2D). Render immediately —
        // the camera easeTo animation is just a visual transition and should not block
        // geometry from appearing. MapLibre blends the geometry naturally as pitch changes.
        boroughWas3DRef.current = is3D;
        map.setPaintProperty('borough-outline', 'fill-extrusion-opacity', is3D ? 1.0 : 0);
        // Line overlay: only in Real3D (z<13). In 3D mode borough fill-extrusion resizes per zoom instead.
        if (map.getLayer('borough-line-overlay')) {
          map.setPaintProperty('borough-line-overlay', 'line-opacity', real3D ? 1.0 : 0);
        }
      } else {
        map.setPaintProperty('borough-outline', 'fill-extrusion-opacity', 0);
        if (map.getLayer('borough-line-overlay')) {
          map.setPaintProperty('borough-line-overlay', 'line-opacity', 0);
        }
        boroughWithColorRef.current = null;
        boroughAvgTiersRef.current = [];
        boroughQuadFilterRef.current = null;
      }
    }

    // Real3D: heatmap/timespan changes handled by the dedicated Real3D useEffect below.
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
    // RAF-debounced wrapper — coalesces multi-event 'zoom' bursts into a single
    // paint update per frame. Heat-radius doesn't need to update mid-tick.
    let radiusRafId = null;
    const updateHeatRadiusDebounced = () => {
      if (radiusRafId) return;
      radiusRafId = requestAnimationFrame(() => {
        radiusRafId = null;
        updateHeatRadius();
      });
    };
    updateHeatRadius();
    map.on('zoom', updateHeatRadiusDebounced);
    return () => {
      try { map.off('zoom', updateHeatRadiusDebounced); } catch (e) { /* ignore */ }
      if (radiusRafId) cancelAnimationFrame(radiusRafId);
    };
  }, [mapReady, heatmap, topoOn]);


  // 3D pitch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.easeTo({ pitch: threeD ? 48 : 0, bearing: threeD ? -17 : 0, duration: 700 });
  }, [threeD, mapReady]);

  // Cache rev for per-integer-zoom outline rebuild — bumped any time the underlying
  // heat data (withHeat, boroughWithColor) changes so the next zoom tick re-runs
  // generateZctaQuadsFromSkeleton with fresh overrides. Idle pan/zoom inside the same
  // integer-zoom band reuses the previous setData (no rebuild).
  const outlineCacheRevRef = useRef(0);
  const lastOutlineKeyRef = useRef('');

  // Outline ring width regeneration on zoom AND pitch — covers 3D and Real3D modes.
  // ZCTA outline only rebuilds in 3D (layer only exists in 3D). Borough outline rebuilds in both.
  // 30ms RAF debounce batches rapid zoom ticks without adding visible lag.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let prevZoom = map.getZoom();
    let rafId = null;
    const isMob = window.innerWidth < 768;

    const doOutlineRebuild = () => {
      const is3D  = threeDRef.current;
      const isR3D = real3DRef.current;
      if (!is3D && !isR3D) return;
      // Per-integer-zoom guard: rebuild only when the integer zoom band crosses or
      // when the underlying data revision changes (heatmap recolor / events update).
      // Pan and fractional zoom (e.g., 14.3 → 14.7) reuse the prior setData → instant.
      const intZoom = Math.floor(map.getZoom());
      // In 3D mode, zcta-outline is frozen at z12 size — use 12 as the key so there are no
      // per-zoom rebuilds. zcta-3d-line (CSS interpolation) handles far-zoom bandwidth smoothly.
      const zctaKeyZoom = is3D ? 12 : intZoom;
      const key = `${zctaKeyZoom}:${is3D ? 1 : 0}:${isR3D ? 1 : 0}:${outlineCacheRevRef.current}`;
      if (key === lastOutlineKeyRef.current) return;
      lastOutlineKeyRef.current = key;
      // ZCTA outline — 3D only; frozen at z12 width for smooth far-zoom (zcta-3d-line bridges z9–z12)
      if (is3D && map.getSource('zcta-outline')) {
        if (zctaSkeletonRef.current && withHeatRef.current) {
          const overrides = withHeatRef.current.features.map(f => f.properties);
          map.getSource('zcta-outline').setData(
            generateZctaQuadsFromSkeleton(zctaSkeletonRef.current, getZoomAwareOutlineWidth(map, undefined, true, 12), overrides)
          );
        } else if (withHeatRef.current) {
          map.getSource('zcta-outline').setData(createZctaOutlineGeoJSON(withHeatRef.current, getZoomAwareOutlineWidth(map, undefined, true, 12)));
        }
      }
      // Borough outline — all modes
      if (map.getSource('borough-source')) {
        const filterSet = boroughQuadFilterRef.current;
        if (boroughSkeletonRef.current && boroughWithColorRef.current) {
          const overrides = boroughWithColorRef.current.features.map(f => f.properties);
          const filterSet = boroughQuadFilterRef.current;
          // Always regenerate from skeleton with live color overrides — 5 boroughs = trivially fast.
          // Real3D: frozen at z13 equivalent (2D line handles far-zoom). 3D: per-zoom resize.
          let quads = generateBoroughQuadsFromSkeleton(boroughSkeletonRef.current, getZoomAwareOutlineWidth(map, 18, true, isR3D ? 13 : null), overrides);
          if (!isR3D && is3D) {
            // 3D mode quads change size per zoom → cached filterSet is stale across zoom changes.
            // Recompute safezone PiP fresh to prevent gaps/overlaps near safezone boundaries.
            const safezoneFeatures = withHeatRef.current?.features?.filter(f => f.properties?._special) || [];
            const { filtered, removedIdxSet } = removeSafezoneOverlapQuads(quads, safezoneFeatures);
            boroughQuadFilterRef.current = removedIdxSet;
            map.getSource('borough-source').setData(filtered);
          } else {
            if (filterSet && filterSet.size > 0) quads = { ...quads, features: quads.features.filter((_, i) => !filterSet.has(i)) };
            map.getSource('borough-source').setData(quads);
          }
        } else if (boroughWithColorRef.current) {
          let quads = createOutlineGeoJSON(boroughWithColorRef.current, getZoomAwareOutlineWidth(map, 18, true, isR3D ? 13 : null));
          const filterSet = boroughQuadFilterRef.current;
          if (filterSet && filterSet.size > 0) quads = { ...quads, features: quads.features.filter((_, i) => !filterSet.has(i)) };
          map.getSource('borough-source').setData(quads);
        }
      }
    };

    const onZoom = () => {
      const is3D  = threeDRef.current;
      const isR3D = real3DRef.current;
      const zoom  = map.getZoom();

      // Outlines FIRST — they're cheapest to redraw and visible first to the user.
      // Schedule the outline rebuild before any viewport fetch / paint refresh below
      // so the GPU is already drawing fresh outline geometry while the heavier work
      // is debounced behind it.
      if (is3D || isR3D) {
        if (!isMob) {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(doOutlineRebuild);
        } else if (is3D) {
          if (rafId) clearTimeout(rafId);
          // 100ms debounce — matches the mobile viewport timer for predictable cadence.
          rafId = setTimeout(doOutlineRebuild, 100);
        }
      }

      // Mobile Real3D: trigger viewport fetch when crossing z13/z14 thresholds.
      // PMTiles handles building viewport tiles natively — no manual fetch on threshold crossings.

      // Real3D paint expression refresh on zoom threshold crossing (cheap, sync).
      if (isR3D && heatmapRef.current) {
        const crossedBaseplates = (prevZoom < 13 && zoom >= 13) || (prevZoom >= 13 && zoom < 13);
        const crossedBuildings  = (prevZoom < 14 && zoom >= 14) || (prevZoom >= 14 && zoom < 14);
        if (crossedBaseplates || crossedBuildings) refreshBuildingColors();
      }

      prevZoom = zoom;
    };

    // ── Safety nets ────────────────────────────────────────────────────────
    // zoomend: force a full outline rebuild after a zoom completes — guarantees
    //   the final integer-zoom band has fresh quad geometry even if the in-progress
    //   debounce was cancelled mid-flight.
    // moveend: cheap building/baseplate paint refresh after a pan completes.
    //   PMTiles streams tiles natively, but the heatmap tier expression is a
    //   per-zip match expression that benefits from a final paint touch on settle.
    const onZoomEnd = () => { try { doOutlineRebuild(); } catch (_e) { /* */ } };
    const onMoveEnd = () => {
      // PMTiles buildings use a [match, ['get','z'], ...] data-driven expression set
      // via setPaintProperty — this expression is persistent on the layer and MapLibre
      // automatically applies it to all newly streamed tiles on pan/zoom. No need to
      // call refreshBuildingColors() on moveend. (This was needed in the feature-state
      // era but is dead/harmful overhead for the match-expression approach.)
    };
    map.on('zoom', onZoom);
    map.on('pitch', onZoom);
    map.on('zoomend', onZoomEnd);
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('zoom', onZoom);
      map.off('pitch', onZoom);
      map.off('zoomend', onZoomEnd);
      map.off('moveend', onMoveEnd);
      if (!isMob && rafId) cancelAnimationFrame(rafId);
      else if (rafId) clearTimeout(rafId);
    };
  }, [mapReady]);

  // SATELLITE: Hybrid raster — ArcGIS World Imagery for z<13 (sharp at low zoom),
  // Clarity for z≥13 (uniform NYC mosaic at high zoom). Both rasters always present
  // when satellite is ON; MapLibre auto-handles the handoff at the source maxzoom edge.
  // Inserted at bottom of layer stack so they render behind all other layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (satellite) {
      // 3-tier satellite (restored — matches the proven tile quality mix):
      //   z<11   → ArcGIS World Imagery (sharp at low zoom, free)
      //   z=11-12→ Esri Wayback release 13045 (2018-01-18) — timestamp-locked mosaic,
      //            avoids the blurry/inconsistent tiles clarity serves at these zooms
      //   z≥13   → Clarity (uniform high-res NYC mosaic at high zoom)
      // Source maxzoom MUST be higher than layer maxzoom: MapLibre adds +1 to tile zoom
      // for 256px raster tiles. Source max=19 ensures native-resolution tiles fetched
      // at every layer-visible zoom (no overscaling = no blur). Layer min/maxzoom
      // controls the visibility band handoff between tiers.
      if (!map.getSource('sat-source-arcgis')) {
        map.addSource('sat-source-arcgis', {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
        });
      }
      if (!map.getSource('sat-source-wayback')) {
        map.addSource('sat-source-wayback', {
          type: 'raster',
          tiles: ['https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13045/{z}/{y}/{x}'],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
        });
      }
      if (!map.getSource('sat-source')) {
        map.addSource('sat-source', {
          type: 'raster',
          tiles: ['https://clarity.maptiles.arcgis.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
        });
      }
      const layers = map.getStyle().layers;
      const firstLayerId = layers.length > 0 ? layers[0].id : undefined;
      if (!map.getLayer('sat-layer-arcgis')) {
        map.addLayer({
          id: 'sat-layer-arcgis', type: 'raster', source: 'sat-source-arcgis',
          minzoom: 9, maxzoom: 10.5,  // visible z9–z10.499
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 300 },
        }, firstLayerId);
      }
      if (!map.getLayer('sat-layer-wayback')) {
        map.addLayer({
          id: 'sat-layer-wayback', type: 'raster', source: 'sat-source-wayback',
          minzoom: 10.5, maxzoom: 13,  // visible z10.5–z12.999
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 300 },
        }, firstLayerId);
      }
      if (!map.getLayer('sat-layer')) {
        map.addLayer({
          id: 'sat-layer', type: 'raster', source: 'sat-source',
          minzoom: 13, maxzoom: 17,  // visible z13–z16.999 (maxzoom exclusive)
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 300 },
        }, firstLayerId);
      }
      // === NYC DoITT Orthophoto overlay at z13+ ===
      // REVERTED — DoITT tiles are not continuous (NYC only) causing visible edges.
      // Clarity-only is the active z13+ source. DoITT code kept as comment for reference.
      // if (!map.getSource('sat-source-doitt')) {
      //   map.addSource('sat-source-doitt', {
      //     type: 'raster',
      //     tiles: ['https://orthos.its.ny.gov/ArcGIS/rest/services/wms/2022/MapServer/tile/{z}/{y}/{x}'],
      //     tileSize: 256, minzoom: 0, maxzoom: 19,
      //   });
      // }
      // if (!map.getLayer('sat-layer-doitt')) {
      //   map.addLayer({
      //     id: 'sat-layer-doitt', type: 'raster', source: 'sat-source-doitt',
      //     minzoom: 13, maxzoom: 17,
      //     paint: { 'raster-opacity': 1, 'raster-fade-duration': 300 },
      //   }, firstLayerId);
      // }
      // === End NYC DoITT block ===
    } else {
      if (map.getLayer('sat-layer')) map.removeLayer('sat-layer');
      if (map.getLayer('sat-layer-wayback')) map.removeLayer('sat-layer-wayback');
      if (map.getLayer('sat-layer-arcgis')) map.removeLayer('sat-layer-arcgis');
      if (map.getSource('sat-source')) map.removeSource('sat-source');
      if (map.getSource('sat-source-wayback')) map.removeSource('sat-source-wayback');
      if (map.getSource('sat-source-arcgis')) map.removeSource('sat-source-arcgis');
    }

    // Water opacity: 1.0 when satellite off (full dark water color), 0.5 when satellite on (imagery shows through)
    if (map.getLayer('real3d-water')) {
      map.setPaintProperty('real3d-water', 'fill-opacity', satellite ? 0.5 : 1.0);
    }
  }, [satellite, real3D, mapReady]);

  // SATELLITE PAN PREFETCH: On movestart, compute tiles for a viewport + 25% buffer
  // and fire fire-and-forget fetches. SW caches them so MapLibre requests hit SW cache
  // instead of network, eliminating the blank-edge delay during panning.
  // On moveend, fires a second pass to catch any tiles missed during rapid movement.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Convert lng/lat/zoom to tile x/y (standard Web Mercator slippy tile math)
    function lngLatToTileXY(lng, lat, z) {
      const n = Math.pow(2, z);
      const x = Math.floor((lng + 180) / 360 * n);
      const latRad = lat * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
      return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
    }

    // Pick tile URL template and zoom for the current map zoom
    function getTileUrlFn(mapZoom) {
      const z = Math.floor(mapZoom);
      if (mapZoom < 10.5) {
        // ArcGIS band
        return { tileZ: Math.min(z, 10), fn: (tz, y, x) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tz}/${y}/${x}` };
      } else if (mapZoom < 13) {
        // Wayback band
        return { tileZ: Math.min(z, 12), fn: (tz, y, x) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13045/${tz}/${y}/${x}` };
      } else {
        return { tileZ: Math.min(z, 16), fn: (tz, y, x) => `https://clarity.maptiles.arcgis.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tz}/${y}/${x}` };
      }
    }

    // Prefetch tiles in the current viewport + 25% buffer on each side
    function prefetchSatTiles() {
      if (!satelliteRef.current) return;
      try {
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        const { tileZ, fn } = getTileUrlFn(zoom);
        // Expand bounds by ~25% in each direction
        const lngSpan = bounds.getEast() - bounds.getWest();
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const w = bounds.getWest()  - lngSpan * 0.25;
        const e = bounds.getEast()  + lngSpan * 0.25;
        const n = Math.min(85, bounds.getNorth() + latSpan * 0.25);
        const s = Math.max(-85, bounds.getSouth() - latSpan * 0.25);
        const tl = lngLatToTileXY(w, n, tileZ);
        const br = lngLatToTileXY(e, s, tileZ);
        const urls = [];
        for (let x = tl.x; x <= br.x; x++) {
          for (let y = tl.y; y <= br.y; y++) {
            urls.push(fn(tileZ, y, x));
          }
        }
        // Fire via SW for cache persistence; fallback to direct fetch if SW unavailable
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_SATELLITE', urls });
        } else {
          urls.forEach(u => fetch(u, { credentials: 'omit' }).catch(() => {}));
        }
      } catch (_e) { /* best-effort */ }
    }

    const onMoveStart = () => prefetchSatTiles();
    const onMoveEndSat = () => prefetchSatTiles(); // confirm pass
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEndSat);
    return () => {
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEndSat);
    };
  }, [mapReady]); // eslint-disable-line react-hooks/exhaustive-deps


  // Building color expression — uses bid % 7 (standard) / bid % 5 (heatmap shade clusters).
  // For heatmap mode, tier comes from per-zip lookup via match expression on `z` property.
  // GPU reads property directly — no feature-state needed, no CPU loop.
  const memoizedExprs = useRef({});

  // Build a [match, ['get','z'], '10001', tier, '10002', tier, ..., 0] expression
  // that maps each ZIP to its tier (0–4) for the given timespan index.
  function buildTierByZipExpr(tsIdx) {
    const precomputed = precomputedTiersRef.current;
    const zipToZcta = zipToZctaIdxMapRef.current;
    if (!precomputed || !zipToZcta) return 0;
    const tiers = precomputed[tsIdx]?.tiers;
    if (!tiers) return 0;
    const expr = ['match', ['get', 'z']];
    for (const zip in zipToZcta) {
      const idx = zipToZcta[zip];
      const tier = tiers[idx] ?? 0;
      expr.push(zip, tier);
    }
    expr.push(0); // default
    return expr;
  }

  function buildingColorExprByState(isHeatmap, tsIdx = 0) {
    const key = `bldg_${isHeatmap}_${tsIdx}`;
    if (memoizedExprs.current[key]) return memoizedExprs.current[key];

    let expr;
    if (!isHeatmap) {
      const shadeIdx = ['%', ['coalesce', ['get', 'b'], 0], 7];
      expr = ['case',
        ['==', shadeIdx, 0], '#0d0101',
        ['==', shadeIdx, 1], '#1a0303',
        ['==', shadeIdx, 2], '#260606',
        ['==', shadeIdx, 3], '#330909',
        ['==', shadeIdx, 4], '#400c0c',
        ['==', shadeIdx, 5], '#1f0404',
        '#7a1818',
      ];
    } else {
      const tierExpr = buildTierByZipExpr(tsIdx);
      const shadeIdx = ['%', ['coalesce', ['get', 'b'], 0], 5];
      const shades = (tones) => ['case',
        ['==', shadeIdx, 0], tones[0],
        ['==', shadeIdx, 1], tones[1],
        ['==', shadeIdx, 2], tones[2],
        ['==', shadeIdx, 3], tones[3],
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

  // Central helper — re-applies building colors using memoized expressions.
  // Single layer covers baseplate (z13–13.9) and full-height (z14+) via interpolated height.
  // Heatmap toggle: rebuilds color expression to switch between standard red-cluster palette
  // and tier-based heat palette — same _s7/_s5 shade clustering applies at all zoom states.
  // NOTE: memoizedExprs is NOT cleared here — expressions are keyed by (isHeatmap, tsIdx)
  // so they auto-invalidate on key change. Only clear when tiers actually change (see tier effect).
  function refreshBuildingColors() {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    const isHm = heatmapRef.current;
    const tsIdx = timespanIdxRef.current ?? 2;
    if (map.getLayer('real3d-buildings')) {
      map.setPaintProperty('real3d-buildings', 'fill-extrusion-color', buildingColorExprByState(isHm, tsIdx));
    }
  }


  // Update 2D ZCTA line widths based on current zoom — called on every zoom event and on
  // heatmap effect for initial state. Gentle linear increase at z10+ so lines don't
  // appear to shrink relative to the growing zip polygons, without becoming too thick.
  // z9-z10: original ramp/lock — DO NOT change this range.
  // z10+: +1px per zoom level from 6px base, capped at 12px at z16.


  // Create nyc-buildings PMTiles vector source + building layers.
  // Source-layer 'building'. Per-feature props: { z=zip, b=bid, h=height_m, m=min_height, c=colour }.
  // Tippecanoe was built with --detect-shared-borders + --coalesce-densest-as-needed
  // which handles seam dedup at build-time. NO client-side feature-state dedup —
  // that approach paints features transparent globally (since IDs are global to the
  // source-layer) AND OOMs from unbounded querySourceFeatures + Set growth.
  function addBuildingLayers(map, isHeatmap, tsIdx = 0) {
    if (!map.getSource('nyc-buildings')) {
      map.addSource('nyc-buildings', {
        type: 'vector',
        url: `pmtiles://${BUILDINGS_PMTILES_URL}`,
        // Stage 3: source minzoom 13 (no z12 tile fetches — saves bandwidth + SW cache).
        minzoom: 13,
        maxzoom: 16,
        promoteId: 'b',
      });
    }

    if (!map.getLayer('real3d-buildings')) {
      map.addLayer({
        id: 'real3d-buildings', type: 'fill-extrusion',
        source: 'nyc-buildings',
        'source-layer': BUILDINGS_PMTILES_LAYER,
        // Stage 3 baseplate retune:
        //   z13–z14.1:  locked flat 7m baseplate appearance
        //   z14.1–z14.2: ~1s grow to full height
        //   z14.2+:     constant full roof height
        minzoom: 13,
        paint: {
          'fill-extrusion-color': buildingColorExprByState(isHeatmap, tsIdx),
          // h and m are stored in FEET in the PMTiles. Multiply by 0.3048 to convert to meters
          // (MapLibre fill-extrusion-height is always in meters).
          // Baseplate phase: z13-z14.1 = flat 1m slab (visual footprint only, no real height).
          // Growth phase:    z14.1-z14.2 = zoom-driven interpolation from 1m → actual roof height.
          // Full height:     z14.2+ = constant at actual h*0.3048 meters.
          // Default fallback for missing h: 25ft ≈ 7.6m (typical 2-story NYC walk-up).
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'],
            13,   1,
            14.1, 1,
            14.2, ['*', ['coalesce', ['get', 'h'], 25], 0.3048],
          ],
          // Base is 0 at z13-14.1. At z14.2+ use m (min_height in feet → meters).
          // Most buildings have m=0 so base stays 0.
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'],
            13,   0,
            14.1, 0,
            14.2, ['*', ['coalesce', ['get', 'm'], 0], 0.3048],
          ],
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false,
          'fill-extrusion-opacity-transition': { duration: 0 },
          'fill-extrusion-color-transition': { duration: 0 },
        },
      });
    }
  }
  // water_static.geojson: 2304 features, z=10+z11 composite, dissolved tile-seams.
  // Static = same geometry at all zoom levels → warms ONCE in SW cache, never re-renders.
  // Cache-bust query (?v=6) forces re-fetch when SW version bumps so old misaligned
  // copies cached client-side cannot persist past a deploy.
  function addOpenmaptilesSourceAndLayers(map, isHeatmap, tsIdx = 0) {
    if (map.getSource('water-static') && map.getSource('roads-pm')) return; // already exists
    try {
      if (!map.getSource('water-static')) {
        map.addSource('water-static', {
          type: 'geojson',
          data: `${import.meta.env.BASE_URL}data/finalwatercomplex.json?v=1`,
        });
      }

      if (!map.getLayer('real3d-water')) {
        // Insert BEFORE heat-underlay = position 0 in the style list (below every fill-extrusion).
        // This was the working position in d156a04. MapLibre composites fill-extrusion FBO groups
        // inline at each group boundary. Having a 2D fill at the very bottom ensures all
        // fill-extrusion groups (zcta, borough, buildings, roads) are contiguous above it and
        // composite IN ORDER on top of zcta-fill — so buildings/roads always occlude zcta-fill. ✓
        const waterBeforeId = map.getLayer('heat-underlay') ? 'heat-underlay' : undefined;
        map.addLayer({
          id: 'real3d-water', type: 'fill',
          source: 'water-static',
          paint: { 'fill-color': '#0e1f35', 'fill-opacity': 0.85 },
        }, waterBeforeId);
      }

      // ── PMTILES ROADS (Real3D mode) ──────────────────────────────────────────
      // 2D fill ONLY per fclass at z9-z16. 3D extrusions removed: 2D fill renders in the
      // 2D pass below all fill-extrusion layers (buildings, borough-outline) so they
      // automatically occlude roads at z14+ via painter's algorithm — no shared depth
      // buffer needed. Eliminates ALL 3D road compute and seamlessness/perspective issues.
      // Layer order (bottom→top in 2D pass): water → roads → (FE pass: borough-outline → buildings).
      const ROAD_FCLASSES = [
        { fclass: 'motorway',    minz: 9,  colorOff: '#6b0000', opacityOff: 1.0 },
        { fclass: 'trunk',       minz: 9,  colorOff: '#6b0000', opacityOff: 1.0 },
        { fclass: 'primary',     minz: 10, colorOff: '#6b0000', opacityOff: 1.0 },
        { fclass: 'secondary',   minz: 10, colorOff: '#6b0000', opacityOff: 1.0 },
        // fade in z12→z12.5 (0.3→1.0)
        { fclass: 'tertiary',    minz: 12, colorOff: '#e02424', opacityOff: 1.0, opacityFadeExpr: ['interpolate', ['linear'], ['zoom'], 12, 0.3, 12.5, 1.0] },
        { fclass: 'residential', minz: 12, colorOff: '#e02424', opacityOff: 1.0, opacityFadeExpr: ['interpolate', ['linear'], ['zoom'], 12, 0.3, 12.5, 1.0] },
      ];
      // Item 4: heatmap opacity rework.
      // Below z12: 50% of previous values (fill=0.1, line=0.1; combined=0.2).
      // z12–z13: 20% more visible (fill=0.25, line=0.25; combined=0.5).
      // z13+: line gone, fill steps to 0.5 to maintain visual weight (20% more than old 0.4).
      const HM_FILL_OPACITY = ['step', ['zoom'], 0.1, 12, 0.25, 13, 0.5];
      const HM_LINE_OPACITY = ['step', ['zoom'], 0.4, 12, 0.25]; // 0.4 below z12 (reduced from full opaque to avoid patchiness); z12+ 0.25
      if (!map.getSource('roads-pm')) {
        map.addSource('roads-pm', { type: 'vector', url: `pmtiles://${ROADS_PMTILES_URL}` });
      }
      for (const r of ROAD_FCLASSES) {
        const fillId = `real3d-pm-roads-${r.fclass}-fill`;
        // 2D fill: full polygon footprint, antialiased. Visible z9→z16 (no fade-out).
        if (!map.getLayer(fillId)) {
          map.addLayer({
            id: fillId, type: 'fill',
            source: 'roads-pm', 'source-layer': ROADS_PMTILES_LAYER,
            minzoom: r.minz,
            filter: ['==', ['get', 'fclass'], r.fclass],
            paint: {
              'fill-color':     isHeatmap ? '#000000' : r.colorOff,
              'fill-opacity':   isHeatmap ? HM_FILL_OPACITY : (r.opacityFadeExpr || r.opacityOff),
              'fill-antialias': false,
            },
          });
        }
      }

      // Road width line overlays (z9–z13): zoom-interpolated line-width for far-zoom
      // road visibility. Uses same roads-pm source — line layers trace the road geometry.
      // All widths are GPU paint-property interpolation: zero CPU per frame, no z-fighting.
      // maxzoom:13 — fill polygon footprint is wide enough at z13+ to stand alone.
      const ROAD_LINE_WIDTHS = [
        // z9/z10 primary/secondary: -50%/-40% per user tuning (item 7)
        // tertiary/residential: start at z12 only (item 6)
        // Item 1: motorway/trunk z9 -50%, z10 -40%, z11 -20%
        { fclass: 'motorway',    minz: 9,  color: '#6b0000', stops: [9,1.375, 10,1.62, 11,2.8, 12,2.25, 12.9,1] },
        { fclass: 'trunk',       minz: 9,  color: '#6b0000', stops: [9,1.375, 10,1.62, 11,2.8, 12,2.25, 12.9,1] },
        // Item 2 (this session): primary/secondary minzoom z10; z10 width -20% (0.88)
        { fclass: 'primary',     minz: 10, color: '#6b0000', stops: [10,0.88, 11,2.25, 12,1.5, 12.9,0.75] },
        { fclass: 'secondary',   minz: 10, color: '#6b0000', stops: [10,0.88, 11,2.25, 12,1.5, 12.9,0.75] },
        { fclass: 'tertiary',    minz: 12, color: '#e02424', stops: [12,1,   12.9,0.5] },
        { fclass: 'residential', minz: 12, color: '#e02424', stops: [12,0.75, 12.9,0.4] },
      ];
      for (const rl of ROAD_LINE_WIDTHS) {
        const lineId = `real3d-pm-roads-${rl.fclass}-line`;
        if (!map.getLayer(lineId)) {
          map.addLayer({
            id: lineId, type: 'line',
            source: 'roads-pm', 'source-layer': ROADS_PMTILES_LAYER,
            minzoom: rl.minz,
            maxzoom: 13,
            filter: ['==', ['get', 'fclass'], rl.fclass],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color':   isHeatmap ? '#000000' : rl.color,
              'line-width':   ['interpolate', ['linear'], ['zoom'], ...rl.stops],
              'line-opacity': isHeatmap ? HM_LINE_OPACITY : 1.0,
            },
          });
        }
      }
      // Buildings: FGB pipeline (addBuildingLayers called separately in initReal3DLayers).
    } catch (err) { console.warn('addOpenmaptilesSourceAndLayers failed:', err); }
  }

  // Initialize Real3D layers ONCE.
  // Layer-add order matters (newer layers go on top by default):
  //   1. addOpenmaptilesSourceAndLayers — roads (PMTiles)
  //   2. addBuildingLayers — baseplate then buildings
  // Net stack (bottom→top, with 2D layers from main style still below):
  //   sat → water → zip outlines → borough outline → roads → baseplate → buildings
  function initReal3DLayers(map, isHeatmap, tsIdx = 0) {
    map.setLight({ anchor: 'map' });
    addOpenmaptilesSourceAndLayers(map, isHeatmap, tsIdx);
    addBuildingLayers(map, isHeatmap, tsIdx);
    buildingAssignCleanupRef.current = () => {};
    // DO NOT moveLayer('borough-outline') to top — it must stay below roads + buildings.
    real3dLayersCreatedRef.current = true;

    // Layer-order moveLayer (Option B) reverted: it could not solve the underlying
    // depth issue — translucent fill-extrusions go through the painter's path where
    // 2D fills earlier in the list paint over them regardless of moveLayer position.
    // Real fix: Fix A (opacity 1.0 forces FBO depth-tested path) + Fix B (base bump).

    // Apply correct paint expressions immediately so layers have proper colors from frame 1.
    // Must run after real3dLayersCreatedRef=true so refreshBuildingColors can find the layers.
    refreshBuildingColors();
  }

  // Show/hide all Real3D layers. No source or layer destruction.
  // Visibility is toggled synchronously — no deferred logic, no idle listeners.
  // REAL3D_ALL_LAYER_IDS is ordered: water → roads → buildings, matching the GPU
  // draw stack so occlusion is correct from the very first visible frame.
  function setReal3DLayersVisible(map, visible) {
    if (!visible) {
      // Hide everything immediately when turning off
      REAL3D_ALL_LAYER_IDS.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      });
      return;
    }
    // Show all layers synchronously in render-stack order.
    // SW-cached PMTiles tiles arrive in ~0ms so there is no visual benefit to deferring
    // buildings — they appear as flat 7m plates at z13 (via height interpolation) and
    // grow to full height as the user zooms, all from frame 1.
    REAL3D_ALL_LAYER_IDS.forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    });
  }

  // Real3D toggle effect — create once, then toggle visibility.
  // Layer show order: paint colors → visibility → light → easeTo.
  // easeTo starts AFTER layers are visible so camera animation never blocks tile render.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!real3D) {
      if (real3dLayersCreatedRef.current) {
        setReal3DLayersVisible(map, false);
      }
      if (!threeD) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      return;
    }

    const isHm = heatmapRef.current;

    // Same path for desktop and mobile — PMTiles serves from SW cache at ~0ms.
    // zipToZctaIdxMapRef is populated by the geoData effect (line ~1647) for both platforms,
    // so heatmap tier expressions work without any per-toggle setup.
    // 1. Paint first: correct colors baked into GPU expression before first frame.
    // 2. Visibility: all layers sync (water→roads→buildings order = correct occlusion frame 1).
    // 3. setLight + easeTo: tilt camera only (NO zoom snap — user controls zoom themselves).
    if (!real3dLayersCreatedRef.current) {
      initReal3DLayers(map, isHm, timespanIdxRef.current ?? 2);
      setReal3DLayersVisible(map, true);
    } else {
      refreshBuildingColors();
      setReal3DLayersVisible(map, true);
    }
    map.setLight({ anchor: 'map' });
    // Tilt only — no zoom change. Buildings render naturally once user is at z13+.
    map.easeTo({
      pitch: 55,
      bearing: -17,
      duration: 700,
    });
  }, [real3D, mapReady]);

  // Heatmap toggle in Real3D — swap paint expressions (GPU-only on desktop, viewport re-fetch on mobile)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !real3D) return;
    if (!real3dLayersCreatedRef.current) return; // layers not yet initialized — skip

    // PMTiles roads: update color + zoom-interpolated opacity expressions.
    const ROAD_FCLASS_PAINT = [
      { fclass: 'motorway',    colorOff: '#6b0000', opacityOff: 1.0 },
      { fclass: 'trunk',       colorOff: '#6b0000', opacityOff: 1.0 },
      { fclass: 'primary',     colorOff: '#6b0000', opacityOff: 1.0 },
      { fclass: 'secondary',   colorOff: '#6b0000', opacityOff: 1.0 },
      { fclass: 'tertiary',    colorOff: '#e02424', opacityOff: 1.0, opacityFadeExpr: ['interpolate', ['linear'], ['zoom'], 12, 0.3, 12.5, 1.0] },
      { fclass: 'residential', colorOff: '#e02424', opacityOff: 1.0, opacityFadeExpr: ['interpolate', ['linear'], ['zoom'], 12, 0.3, 12.5, 1.0] },
    ];
    // Item 4: heatmap opacity rework (same values as addOpenmaptilesSourceAndLayers).
    const HM_FILL_OPACITY = ['step', ['zoom'], 0.1, 12, 0.25, 13, 0.5];
    const HM_LINE_OPACITY = ['step', ['zoom'], 0.4, 12, 0.25]; // 0.4 below z12; z12+ 0.25
    ROAD_FCLASS_PAINT.forEach(({ fclass, colorOff, opacityOff, opacityFadeExpr }) => {
      const fillId = `real3d-pm-roads-${fclass}-fill`;
      if (map.getLayer(fillId)) {
        map.setPaintProperty(fillId, 'fill-color',   heatmap ? '#000000' : colorOff);
        map.setPaintProperty(fillId, 'fill-opacity', heatmap ? HM_FILL_OPACITY : (opacityFadeExpr || opacityOff));
      }
      // Update matching line overlay (color + opacity; line-width expression stays constant)
      const lineId = `real3d-pm-roads-${fclass}-line`;
      if (map.getLayer(lineId)) {
        map.setPaintProperty(lineId, 'line-color',   heatmap ? '#000000' : colorOff);
        map.setPaintProperty(lineId, 'line-opacity', heatmap ? HM_LINE_OPACITY : 1.0);
      }
    });
    // Safezone opacity
    const isSat = satelliteRef?.current ?? satellite;
    if (map.getLayer('zcta-safezone-fill')) {
      map.setPaintProperty('zcta-safezone-fill', 'fill-opacity', isSat ? 0.22 : 1.0);
    }

    // PMTiles buildings paint refresh — identical desktop/mobile, no fetch needed.
    refreshBuildingColors();
  }, [heatmap, real3D, mapReady]);

  // Timespan change in Real3D — paint expression refresh (zip→tier match expression rebuild)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !real3D) return;
    if (!heatmapRef.current) return;
    refreshBuildingColors();
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
      getZipColonists(rawZip).then(c => {
        let total = c.length;
        if (SAMPLE_MODE) total += getSampleUsersForZip(rawZip).length;
        setHoveredColonists(total);
      }).catch(() => {
        const sampleCount = SAMPLE_MODE ? getSampleUsersForZip(rawZip).length : 0;
        setHoveredColonists(sampleCount);
      });
    }
  }, [hoveredZip, timespanIdx, events]);

  // Fetch posts for MapPostsPanel
  useEffect(() => {
    if (!mapPostsPanel) { setMapPosts([]); setMapPostsReactions({}); return; }
    let cancelled = false;
    (async () => {
      setMapPostsLoading(true);
      try {
        const data = await fetchGeoPostFeed({
          type: mapPostsPanel.type,
          value: mapPostsPanel.value,
          sortByTop: mapPostsSort === 'top',
        });
        if (cancelled) return;
        setMapPosts(data || []);
        setMapPostsPage(0);
        if (data?.length > 0) {
          const rxns = await fetchReactionsForPosts(data.map(p => p.id));
          if (cancelled) return;
          const byPost = {};
          (rxns || []).forEach(r => { if (!byPost[r.post_id]) byPost[r.post_id] = []; byPost[r.post_id].push(r); });
          setMapPostsReactions(byPost);
        }
      } catch {}
      if (!cancelled) setMapPostsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mapPostsPanel, mapPostsSort]);

  async function openSidePanel(zip) {
    const isSafezone = zip.startsWith('SAFE:');
    const rawZip = isSafezone ? zip.slice(5) : zip;
    // Opening zip events panel (right) takes over from borough events panel
    setSideBorough(null); setSideBoroughEvents([]); setSideBoroughColonists([]);
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

  async function openBoroughSidePanel(boroughName) {
    setSideBorough(boroughName);
    setSideZip(null); setSideEvents([]); setSideColonists([]); setHoloFeature(null);
    // Filter events by borough from the already-loaded events array
    const boroughEvts = events.filter(e => e.borough === boroughName && !e._auto && !e._sample);
    setSideBoroughEvents(boroughEvts);
    try {
      const colonists = await getBoroughColonists(boroughName);
      setSideBoroughColonists(colonists);
    } catch { setSideBoroughColonists([]); }
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

  // ── Event pin markers — native GeoJSON symbol layer for correct geo-positioning ──
  // Two layers from same source: dots at far zoom (z<12), full pins at close zoom (z>=12).
  // MapLibre handles viewport clipping, pitch/rotation, zoom scaling automatically.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Toggle visibility if layers exist
    ['event-pins-dots', 'event-pins-layer'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showPins ? 'visible' : 'none');
    });

    // Clear pill and afters markers
    pillMarkersRef.current.forEach(m => m.remove());
    pillMarkersRef.current = [];
    aftersMarkersRef.current.forEach(m => m.remove());
    aftersMarkersRef.current = [];
    // Cancel any pending Valhalla request and debounce timer on re-run
    if (valhallaTimerRef.current) { clearTimeout(valhallaTimerRef.current); valhallaTimerRef.current = null; }
    if (valhallaAbortRef.current) { valhallaAbortRef.current.abort(); valhallaAbortRef.current = null; }
    // Clear route line
    if (map.getSource('afters-route')) map.getSource('afters-route').setData({ type: 'FeatureCollection', features: [] });

    if (!showPins || !events?.length) {
      pinEventsLookupRef.current = new Map();
      if (map.getSource('event-pins')) map.getSource('event-pins').setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    // Filter: show events in timespan window OR currently live/afters (persist duration+1hr)
    const nowTs = Date.now();
    const nowDay = new Date(); nowDay.setHours(0, 0, 0, 0);
    const days = TIMESPAN_STEPS[timespanIdx]?.days || 180;
    const maxDate = new Date(nowDay.getTime() + days * 86400000);

    const pinEvents = events.filter(e => {
      if (e._auto) return false;
      const lat = parseFloat(e.lat), lng = parseFloat(e.lng);
      if (isNaN(lat) || isNaN(lng)) return false;
      // Always show if happening now or in afters window (persist live events)
      if (isEventHappeningNow(e)) return true;
      // Also show future events within timespan
      const ed = new Date(e.event_date + 'T00:00:00');
      return ed >= nowDay && ed <= maxDate;
    });

    // Build lookup map for click/hover handlers
    const lookup = new Map();
    pinEvents.forEach(evt => lookup.set(String(evt.id), evt));
    pinEventsLookupRef.current = lookup;

    // Darken helper
    const darkenHex = (hex, amount = 50) => {
      try {
        const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
        const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
        const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
        return `rgb(${r},${g},${b})`;
      } catch { return '#000'; }
    };

    pinEvents.forEach(evt => {
      const color = evt.hex_color || '#7C3AED';
      const emoji = evt.representative_emoji || '🎉';

      // DOT image — small solid circle for far zoom (z<12)
      const dotKey = `dot-${color}`;
      if (!map.hasImage(dotKey)) {
        const S = 32;
        const dc = document.createElement('canvas');
        dc.width = S * 2; dc.height = S * 2;
        const dctx = dc.getContext('2d');
        dctx.scale(2, 2);
        dctx.beginPath();
        dctx.arc(S / 2, S / 2, 12, 0, 2 * Math.PI);
        dctx.fillStyle = color;
        dctx.fill();
        dctx.strokeStyle = darkenHex(color, 70);
        dctx.lineWidth = 3;
        dctx.stroke();
        const dotData = dctx.getImageData(0, 0, S * 2, S * 2);
        map.addImage(dotKey, { width: S * 2, height: S * 2, data: dotData.data }, { pixelRatio: 2 });
      }

      // FULL PIN image — circle + triangle pointer for close zoom (z>=12)
      const pinKey = `pin-${color}-${emoji}`;
      if (!map.hasImage(pinKey)) {
        const W = 80, H = 110;
        const canvas = document.createElement('canvas');
        canvas.width = W * 2; canvas.height = H * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);

        const cx = W / 2, circleR = 30, circleY = 34;
        const tipY = H - 2;

        // Triangle pointer from circle bottom to tip
        ctx.beginPath();
        ctx.moveTo(cx - 14, circleY + circleR - 6);
        ctx.lineTo(cx, tipY);
        ctx.lineTo(cx + 14, circleY + circleR - 6);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // Main circle body
        ctx.beginPath();
        ctx.arc(cx, circleY, circleR, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = darkenHex(color, 70);
        ctx.lineWidth = 3;
        ctx.stroke();

        // White inner circle (large, fills most of the pin head)
        const innerR = 22;
        ctx.beginPath();
        ctx.arc(cx, circleY, innerR, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = darkenHex(color, 30);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Emoji centered in the white circle — with drop shadow for visibility
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.font = '24px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, cx, circleY + 1);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        const imgData = ctx.getImageData(0, 0, W * 2, H * 2);
        map.addImage(pinKey, { width: W * 2, height: H * 2, data: imgData.data }, { pixelRatio: 2 });
      }
    });

    // Build GeoJSON with both image keys
    const geojson = {
      type: 'FeatureCollection',
      features: pinEvents.map(evt => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [parseFloat(evt.lng), parseFloat(evt.lat)] },
        properties: {
          _eventId: String(evt.id),
          pinImage: `pin-${evt.hex_color || '#7C3AED'}-${evt.representative_emoji || '🎉'}`,
          dotImage: `dot-${evt.hex_color || '#7C3AED'}`,
        }
      }))
    };

    // Create or update source + layers
    if (map.getSource('event-pins')) {
      map.getSource('event-pins').setData(geojson);
    } else {
      map.addSource('event-pins', { type: 'geojson', data: geojson });

      // Dot layer — far zoom (below z12)
      map.addLayer({
        id: 'event-pins-dots',
        type: 'symbol',
        source: 'event-pins',
        maxzoom: 12,
        layout: {
          'icon-image': ['get', 'dotImage'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 11.5, 0.6],
          'icon-anchor': 'center',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 1.0 },
      });

      // Full pin layer — close zoom (z11+ with ramp, full at z12+)
      map.addLayer({
        id: 'event-pins-layer',
        type: 'symbol',
        source: 'event-pins',
        minzoom: 11,
        layout: {
          'icon-image': ['get', 'pinImage'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 0.55, 14, 0.75, 16, 0.9],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 1.0],
        },
      });
    }

    // Ensure pins always render on top of all other layers
    ['event-pins-dots', 'event-pins-layer'].forEach(id => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', 'visible');
        try { map.moveLayer(id); } catch {}
      }
    });

    // Attach click/hover handlers once (persists for component lifetime)
    if (!pinHandlersAttachedRef.current && map.getLayer('event-pins-layer')) {
      pinHandlersAttachedRef.current = true;

      const handleClick = (e) => {
        if (!e.features?.length) return;
        e.stopPropagation(); // prevent ZCTA click from also firing on mobile pin tap
        const id = e.features[0].properties._eventId;
        const evt = pinEventsLookupRef.current.get(id);
        if (evt) { setHoveredPinEvent(null); setSelectedEvent(evt); }
      };
      const handleEnter = (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features?.length) {
          const id = e.features[0].properties._eventId;
          const evt = pinEventsLookupRef.current.get(id);
          if (evt) {
            setHoveredPinEvent(evt);
            const rect = map.getContainer().getBoundingClientRect();
            setHoveredPinPos({ x: rect.left + e.point.x, y: rect.top + e.point.y });
          }
        }
      };
      const handleMove = (e) => {
        if (e.point) {
          const rect = map.getContainer().getBoundingClientRect();
          setHoveredPinPos({ x: rect.left + e.point.x, y: rect.top + e.point.y });
        }
      };
      const handleLeave = () => {
        map.getCanvas().style.cursor = '';
        setHoveredPinEvent(null);
        setHoveredPinPos(null);
      };

      // Attach to both layers
      ['event-pins-dots', 'event-pins-layer'].forEach(id => {
        map.on('click', id, handleClick);
        map.on('mouseenter', id, handleEnter);
        map.on('mousemove', id, handleMove);
        map.on('mouseleave', id, handleLeave);
      });
    }

    // ── PILL BADGES + AFTERS PINS ─────────────────────────────────────────────
    pinEvents.forEach(evt => {
      const evtLive = isEventLive(evt);
      const evtAfters = isAftersWindow(evt);

      // LIVE / AFTERS pill badge above the main pin
      if (evtLive || evtAfters) {
        const lat = parseFloat(evt.lat), lng = parseFloat(evt.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          const el = document.createElement('div');
          el.style.cssText = 'pointer-events:none;display:flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:900;color:#fff;box-shadow:1px 1px 4px rgba(0,0,0,0.5);animation:pulse 2s infinite;white-space:nowrap;margin-bottom:2px;';
          el.style.backgroundColor = evtAfters ? '#7c3aed' : '#16a34a';
          const dot = document.createElement('span');
          dot.style.cssText = 'width:5px;height:5px;border-radius:50%;background:#fff;display:inline-block;flex-shrink:0;';
          el.appendChild(dot);
          el.appendChild(document.createTextNode(evtAfters ? 'AFTERS' : 'LIVE'));
          const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -112] })
            .setLngLat([lng, lat])
            .addTo(map);
          pillMarkersRef.current.push(marker);
        }
      }

      // AFTERS PIN — spawn when in afters window and afters coords exist
      if (evtAfters && evt.afters_lat && evt.afters_lng) {
        const aLat = parseFloat(evt.afters_lat), aLng = parseFloat(evt.afters_lng);
        if (!isNaN(aLat) && !isNaN(aLng)) {
          // Build afters pin DOM element (purple pin with 🎉)
          const canvas = document.createElement('canvas');
          const W = 60, H = 82;
          canvas.width = W * 2; canvas.height = H * 2;
          const ctx = canvas.getContext('2d');
          ctx.scale(2, 2);
          const cx = W / 2, circleR = 22, circleY = 25, tipY = H - 2;
          ctx.beginPath();
          ctx.moveTo(cx - 10, circleY + circleR - 4);
          ctx.lineTo(cx, tipY);
          ctx.lineTo(cx + 10, circleY + circleR - 4);
          ctx.closePath();
          ctx.fillStyle = '#7c3aed';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, circleY, circleR, 0, 2 * Math.PI);
          ctx.fillStyle = '#7c3aed';
          ctx.fill();
          ctx.strokeStyle = '#4c1d95';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, circleY, 16, 0, 2 * Math.PI);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.font = '18px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🎉', cx, circleY + 1);
          const pinEl = document.createElement('canvas');
          pinEl.width = W * 2; pinEl.height = H * 2;
          pinEl.style.width = `${W}px`; pinEl.style.height = `${H}px`;
          pinEl.style.cursor = 'pointer';
          pinEl.getContext('2d').drawImage(canvas, 0, 0);

          const aftersMarker = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
            .setLngLat([aLng, aLat])
            .addTo(map);

          // Afters pin click → open check-in popup
          pinEl.addEventListener('click', (e) => {
            e.stopPropagation();
            setAftersCheckInEvent(evt);
          });

          aftersMarkersRef.current.push(aftersMarker);

          // Draw walking route between main pin and afters pin using Valhalla
          const mainLat = parseFloat(evt.lat), mainLng = parseFloat(evt.lng);
          if (!isNaN(mainLat) && !isNaN(mainLng)) {
            const cacheKey = String(evt.id);
            const applyRouteGeojson = (geojson) => {
              if (map.getSource('afters-route')) {
                map.getSource('afters-route').setData(geojson);
              } else {
                map.addSource('afters-route', { type: 'geojson', data: geojson });
                map.addLayer({
                  id: 'afters-route-line', type: 'line', source: 'afters-route',
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#7c3aed', 'line-width': 3, 'line-dasharray': [3, 4], 'line-opacity': 0.8 },
                });
              }
            };
            const straightLineGeojson = () => ({
              type: 'FeatureCollection',
              features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[mainLng, mainLat], [aLng, aLat]] }, properties: {} }],
            });
            // Session cache hit — apply immediately, no network call
            if (valhallaRouteCache.current.has(cacheKey)) {
              applyRouteGeojson(valhallaRouteCache.current.get(cacheKey));
            } else {
              // Debounce: cancel any pending timer so only the last event in the loop fires
              if (valhallaTimerRef.current) clearTimeout(valhallaTimerRef.current);
              valhallaTimerRef.current = setTimeout(() => {
                // Abort any previous in-flight request
                if (valhallaAbortRef.current) valhallaAbortRef.current.abort();
                valhallaAbortRef.current = new AbortController();
                fetch('https://valhalla1.openstreetmap.de/route', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    locations: [{ lon: mainLng, lat: mainLat }, { lon: aLng, lat: aLat }],
                    costing: 'pedestrian',
                  }),
                  signal: valhallaAbortRef.current.signal,
                })
                  .then(r => { if (!r.ok) throw new Error(`Valhalla ${r.status}`); return r.json(); })
                  .then(data => {
                    const shape = data?.trip?.legs?.[0]?.shape;
                    if (!shape) throw new Error('No route shape');
                    // Decode Valhalla encoded polyline (precision 6, [lng,lat] output for MapLibre)
                    const coords = [];
                    let idx = 0, lat6 = 0, lng6 = 0;
                    while (idx < shape.length) {
                      let result = 1, shift = 0, b;
                      do { b = shape.charCodeAt(idx++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
                      lat6 += (result & 1) ? ~(result >> 1) : (result >> 1);
                      result = 1; shift = 0;
                      do { b = shape.charCodeAt(idx++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
                      lng6 += (result & 1) ? ~(result >> 1) : (result >> 1);
                      coords.push([lng6 / 1e6, lat6 / 1e6]);
                    }
                    const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] };
                    valhallaRouteCache.current.set(cacheKey, geojson);
                    applyRouteGeojson(geojson);
                  })
                  .catch(err => {
                    if (err?.name === 'AbortError') return; // intentionally cancelled, no fallback
                    applyRouteGeojson(straightLineGeojson());
                  });
              }, 500);
            }
          }
        }
      }
    });

  }, [showPins, events, mapReady, timespanIdx]);

  // Borough region overlay — creates MapLibre Marker boxes for each NYC borough.
  // Shows future event count, participant count (async), and heat rank when heatmap is ON.
  // Zoom-responsive scale: larger at z9-10, smaller at z13+.
  useEffect(() => {
    const map = mapRef.current;

    // Cleanup existing markers + zoom listener
    regionMarkersRef.current.forEach(m => m.remove());
    regionMarkersRef.current = [];
    if (regionZoomHandlerRef.current && map) {
      map.off('zoom', regionZoomHandlerRef.current);
      regionZoomHandlerRef.current = null;
    }

    if (!showRegion || !map || !mapReady) return;

    const nowDay = new Date(); nowDay.setHours(0, 0, 0, 0);
    const avgTiers = boroughAvgTiersRef.current || [];
    const domBoxes = {};

    BOROUGH_DATA.forEach((bd, idx) => {
      const eventCount = (events || []).filter(e =>
        !e._auto && !e._sample &&
        e.borough === bd.name &&
        new Date(e.event_date + 'T00:00:00') >= nowDay
      ).length;
      const tier = avgTiers[idx] ?? -1;
      const rank = (heatmap && tier >= 0) ? tierHeatLabel(tier) : null;

      const el = document.createElement('div');
      el.style.cssText = [
        'background:rgba(0,0,0,0.72)',
        'color:#fff',
        'font-family:Nunito,sans-serif',
        'border:1.5px solid rgba(255,255,255,0.22)',
        'border-radius:10px',
        'padding:8px 14px',
        'pointer-events:none',
        'z-index:99999',
        'font-size:13px',
        'font-weight:700',
        'text-align:center',
        'min-width:140px',
        'backdrop-filter:blur(4px)',
        '-webkit-backdrop-filter:blur(4px)',
        'transform-origin:bottom center',
      ].join(';');

      const nameEl = document.createElement('div');
      nameEl.textContent = bd.name;
      nameEl.style.cssText = 'font-size:15px;font-weight:900;margin-bottom:5px;letter-spacing:0.01em;';
      el.appendChild(nameEl);

      const evEl = document.createElement('div');
      evEl.textContent = `🎉 ${eventCount} upcoming`;
      evEl.style.cssText = 'font-size:12px;opacity:0.9;margin-bottom:3px;';
      el.appendChild(evEl);

      const pEl = document.createElement('div');
      pEl.textContent = '👥 loading…';
      pEl.style.cssText = 'font-size:12px;opacity:0.75;';
      el.appendChild(pEl);
      domBoxes[bd.name] = { pEl };

      if (rank) {
        const hEl = document.createElement('div');
        hEl.textContent = `🔥 ${rank.label}`;
        hEl.style.cssText = `font-size:11px;font-weight:900;margin-top:5px;color:${rank.color};`;
        el.appendChild(hEl);
      }

      const marker = new maplibregl.Marker({ element: el, offset: [0, -52], anchor: 'bottom' })
        .setLngLat([bd.lng, bd.lat])
        .addTo(map);
      regionMarkersRef.current.push(marker);
    });

    // Zoom-responsive sizing
    const updateScale = () => {
      const z = map.getZoom();
      const scale = Math.min(1.25, Math.max(0.6, 1.25 - (z - 9) * 0.13));
      regionMarkersRef.current.forEach(m => {
        m.getElement().style.transform = `scale(${scale.toFixed(3)})`;
      });
    };
    updateScale();
    regionZoomHandlerRef.current = updateScale;
    map.on('zoom', updateScale);

    // Async: load participant counts per borough
    BOROUGH_DATA.forEach(async (bd) => {
      try {
        const colonists = await getBoroughColonists(bd.name);
        const box = domBoxes[bd.name];
        if (box?.pEl) box.pEl.textContent = `👥 ${colonists.length} in borough`;
      } catch (_e) { /* ignore */ }
    });

    return () => {
      regionMarkersRef.current.forEach(m => m.remove());
      regionMarkersRef.current = [];
      if (regionZoomHandlerRef.current && map) {
        map.off('zoom', regionZoomHandlerRef.current);
        regionZoomHandlerRef.current = null;
      }
    };
  }, [showRegion, mapReady, heatmap]);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') { setHoloFeature(null); setSideZip(null); setSideEvents([]); setSideColonists([]); setSideBorough(null); setSideBoroughEvents([]); setSideBoroughColonists([]); } };
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


      {/* Controls — below header when expanded, below expand button when collapsed */}
      <div className={`absolute left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 transition-[top] duration-300 ${headerCollapsed ? 'top-[68px]' : 'top-[134px] md:top-[84px]'}`}>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowRegion(v => !v)}
                className={`px-2 py-1 rounded-xl text-xs font-black border transition-all bg-black/80 backdrop-blur ${showRegion ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'border-white/20 text-white hover:border-white/60'}`}
                title={showRegion ? 'Hide borough regions' : 'Show borough regions'}>
                🏝️
              </button>
              <div className="flex items-center gap-1 bg-black/80 backdrop-blur border border-white/20 rounded-2xl px-3 py-1.5">
                <span className="text-white text-xs font-black mr-1">📅</span>
                {TIMESPAN_STEPS.map((s, i) => (
                  <button key={s.label} onClick={() => setTimespanIdx(i)}
                    className={`px-3 py-1 rounded-xl text-xs font-black border transition-all ${timespanIdx === i ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'bg-transparent text-white border-white/30 hover:border-white/60'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowPins(v => !v)}
                className={`px-2 py-1 rounded-xl text-xs font-black border transition-all bg-black/80 backdrop-blur ${showPins ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'border-white/20 text-white hover:border-white/60'}`}
                title={showPins ? 'Hide event pins' : 'Show event pins'}>
                📍
              </button>
            </div>
            {/* Row 2: Heatmap + Satellite + 3D + Real3D — single row on mobile, all 4 */}
            <div className="flex gap-1.5 md:gap-2 justify-center items-start">
              {/* Heatmap button + topo button stacked (topo only on mobile, below heatmap) */}
              <div className="flex flex-col items-center gap-1">
                <div className="relative">
                  {heatmap && (
                    <button onClick={() => setTopoOn(v => !v)}
                      className={`hidden md:flex absolute right-full mr-2 w-10 h-10 rounded-2xl border-3 p-0 items-center justify-center transition-all ${topoOn ? 'border-yellow-300 ring-2 ring-yellow-300' : 'border-white hover:border-yellow-300'}`}
                      title="Topo Heatmap Toggle"
                      style={{ backgroundColor: '#000' }}>
                      <div className="w-[36px] h-[36px] rounded-lg bg-cover bg-center" style={{ backgroundImage: `url('${PUBLIC_BASE}data/topo-thumb.png')` }} />
                    </button>
                  )}
                  <button onClick={() => { setHeatmap(v => { if (!v) setTopoOn(false); return !v; }); }}
                    className={`px-2 py-1.5 md:px-4 md:py-2 rounded-2xl font-black text-[11px] md:text-sm border-2 transition-all ${heatmap ? 'bg-gradient-to-r from-cyan-500 via-yellow-400 to-red-500 border-yellow-300 text-white' : 'bg-black/70 border-white/30 text-white md:hover:border-orange-400'}`}>
                    🌡️ Heatmap
                  </button>
                </div>
                {/* Mobile topo — centered directly below heatmap button */}
                {heatmap && (
                  <button onClick={() => setTopoOn(v => !v)}
                    className={`md:hidden w-9 h-9 rounded-xl border-2 p-0 flex items-center justify-center transition-all ${topoOn ? 'border-yellow-300 ring-2 ring-yellow-300' : 'border-white hover:border-yellow-300'}`}
                    title="Topo Heatmap Toggle"
                    style={{ backgroundColor: '#000' }}>
                    <div className="w-[26px] h-[26px] rounded-md bg-cover bg-center" style={{ backgroundImage: `url('${PUBLIC_BASE}data/topo-thumb.png')` }} />
                  </button>
                )}
              </div>
              <button onClick={() => setSatellite(v => !v)}
                className={`px-2 py-1.5 md:px-4 md:py-2 rounded-2xl font-black text-[11px] md:text-sm border-2 transition-all ${satellite ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'bg-black/70 border-white/30 text-white md:hover:border-violet-400'}`}>
                🛰️ Satellite
              </button>
              <button onClick={handleThreeDToggle}
                className={`px-2 py-1.5 md:px-4 md:py-2 rounded-2xl font-black text-[11px] md:text-sm border-2 transition-all ${threeD ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-black/70 border-white/30 text-white md:hover:border-emerald-400'}`}>
                🏙️ 3D
              </button>
              <button onClick={handleReal3DToggle}
                className={`px-2 py-1.5 md:px-4 md:py-2 rounded-2xl font-black text-[11px] md:text-sm border-2 transition-all ${real3D ? 'bg-amber-600 border-amber-400 text-white' : 'bg-black/70 border-white/30 text-white md:hover:border-amber-400'}`}>
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

          {notInNYC && createPortal(
            <div
              className="fixed inset-0 z-[9999999] flex items-center justify-center pointer-events-none"
              onClick={e => e.stopPropagation()}
            >
              <div className="pointer-events-auto bg-yellow-950/95 border border-yellow-600 rounded-2xl px-5 py-3 flex items-center gap-3 shadow-lg">
                <span className="text-yellow-400 text-xl">⚠️</span>
                <div>
                  <p className="text-yellow-200 font-black text-sm">You are not in NYC</p>
                  <p className="text-yellow-400/70 text-xs mt-0.5">Orbiter mode — view only.</p>
                </div>
                {/* X close button — always on top via portal to document.body */}
                <button
                  className="ml-2 w-6 h-6 flex items-center justify-center rounded-full bg-yellow-900/80 hover:bg-yellow-800 text-yellow-200 text-xs font-black flex-shrink-0"
                  onClick={e => { e.stopPropagation(); e.preventDefault(); setNotInNYC(false); }}
                >✕</button>
              </div>
            </div>,
            document.body
          )}

          {/* Borough hover tooltip — shown when hovering in harbour/border area */}
          {hoveredBorough && !hoveredZip && tooltipPos && (
            <div className="absolute z-30 pointer-events-none"
              style={{ left: Math.min(tooltipPos.x + 12, window.innerWidth - 220), top: tooltipPos.y + 20, width: 210 }}>
              <div className="bg-gray-950/95 border border-purple-800/60 rounded-2xl overflow-hidden shadow-[0_0_15px_rgba(124,58,237,0.35)]">
                <div className="px-3 py-2 border-b border-white/10">
                  <p className="text-purple-400 font-black text-xs">🏙 {hoveredBorough}</p>
                  <p className="text-white/50 text-xs">Click — events &amp; colonists</p>
                  <p className="text-white/35 text-xs">Right-click — borough posts</p>
                </div>
              </div>
            </div>
          )}

          {/* Hover tooltip — positioned below cursor so pin tooltip can stack above */}
          {hoveredZip && tooltipPos && (
            <div className="absolute z-30 pointer-events-none"
              style={{ left: Math.min(tooltipPos.x + 12, window.innerWidth - 220), top: tooltipPos.y + 20, width: 210 }}>
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

          {/* ── Pin hover popup — above cursor, stacks above zip tooltip ── */}
          {hoveredPinEvent && hoveredPinPos && (
            <div className="fixed z-[100001] pointer-events-none"
              style={{ left: Math.min(hoveredPinPos.x + 14, window.innerWidth - 260), top: Math.max(hoveredPinPos.y - 90, 10), width: 240 }}>
              <div className="bg-gray-950/95 border border-white/20 rounded-2xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.6)]">
                <div className="px-3 py-2 border-b border-white/10" style={{ borderLeft: `3px solid ${hoveredPinEvent.hex_color || '#7C3AED'}` }}>
                  <p className="text-white font-black text-xs truncate">{hoveredPinEvent.representative_emoji || '🎉'} {hoveredPinEvent.event_name}</p>
                  <p className="text-white/50 text-[10px]">{hoveredPinEvent.event_date} · {hoveredPinEvent.city || 'NYC'}</p>
                </div>
                {hoveredPinEvent.event_description && (
                  <div className="px-3 py-1.5">
                    <p className="text-white/60 text-[10px] line-clamp-2">{hoveredPinEvent.event_description}</p>
                  </div>
                )}
                <div className="px-3 py-1.5 border-t border-white/10">
                  <p className="text-[#7C3AED] text-[10px] font-bold">Click pin to view details</p>
                </div>
              </div>
            </div>
          )}

          {/* ── MapPostsPanel: GeoPost feed for a zip or borough ── */}
          {mapPostsPanel && !isMobile && (
            <MapPostsPanelView
              panel={mapPostsPanel}
              posts={mapPosts}
              reactions={mapPostsReactions}
              sort={mapPostsSort}
              setSort={setMapPostsSort}
              page={mapPostsPage}
              setPage={setMapPostsPage}
              loading={mapPostsLoading}
              headerCollapsed={headerCollapsed}
              onClose={() => setMapPostsPanel(null)}
            />
          )}
          {mapPostsPanel && isMobile && (
            <MapPostsPanelView
              panel={mapPostsPanel}
              posts={mapPosts}
              reactions={mapPostsReactions}
              sort={mapPostsSort}
              setSort={setMapPostsSort}
              page={mapPostsPage}
              setPage={setMapPostsPage}
              loading={mapPostsLoading}
              headerCollapsed={headerCollapsed}
              isMobile={true}
              onClose={() => setMapPostsPanel(null)}
            />
          )}

          {/* ── DESKTOP side panel — sits below header when not collapsed ── */}
          {sideZip && !isMobile && (
            <div className={`absolute right-0 bottom-0 z-50 flex flex-col overflow-hidden transition-[top] duration-300 ${headerCollapsed ? 'top-0' : 'top-[72px]'}`}
              style={{ width: 400, background: 'rgba(3,0,10,0.52)', backdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(180,0,0,0.3)' }}>
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
                  pageSize={4}
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
                    pageSize={7}
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

          {/* ── DESKTOP: Borough side panel (right side, events + colonists) ── */}
          {sideBorough && !isMobile && (
            <div className={`absolute right-0 bottom-0 z-50 flex flex-col overflow-hidden transition-[top] duration-300 ${headerCollapsed ? 'top-0' : 'top-[72px]'}`}
              style={{ width: 400, background: 'rgba(3,0,10,0.52)', backdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(124,58,237,0.3)' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20">
                <div>
                  <h2 className="text-white font-black text-base">{sideBorough}</h2>
                  <p className="text-white/40 text-xs">{sideBoroughEvents.length} events · {sideBoroughColonists.length} colonists</p>
                </div>
                <button onClick={() => { setSideBorough(null); setSideBoroughEvents([]); setSideBoroughColonists([]); }}
                  className="text-white/50 hover:text-white text-xl leading-none w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10">×</button>
              </div>
              {/* Events */}
              <div className="flex-1 overflow-y-auto px-3 py-2">
                <p className="text-purple-300/70 text-[10px] font-bold uppercase tracking-widest mb-2 mt-1">Events</p>
                {sideBoroughEvents.length === 0 ? (
                  <p className="text-white/30 text-xs text-center py-6">No events found for {sideBorough}</p>
                ) : (
                  <PaginatedSection items={sideBoroughEvents} pageSize={6} renderItem={ev => (
                    <div key={ev.id}
                      className="flex items-start gap-3 p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                      style={{ borderLeftColor: ev.hex_color || '#7C3AED', borderLeftWidth: 3 }}
                      onClick={() => setSelectedEvent(ev)}>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl relative"
                        style={{ background: (ev.hex_color || '#7C3AED') + '33', border: `2px solid ${ev.hex_color || '#7C3AED'}` }}>
                        <span className="absolute inset-0 flex items-center justify-center text-xl pointer-events-none">{ev.representative_emoji || '🎉'}</span>
                        {ev.photos?.[0] && <img src={ev.photos[0]} className="w-full h-full object-cover relative z-10" alt="" onError={e => e.target.style.display = 'none'} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-sm truncate">{ev.event_name}</p>
                        <p className="text-white/40 text-xs">{ev.event_date} · {ev.price_category === 'free' ? 'FREE' : ev.price_category || '?'}</p>
                      </div>
                    </div>
                  )} />
                )}
                {/* Colonists */}
                {sideBoroughColonists.length > 0 && (
                  <>
                    <p className="text-purple-300/70 text-[10px] font-bold uppercase tracking-widest mb-2 mt-4">Top Colonists</p>
                    {sideBoroughColonists.slice(0, 10).map((u, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 border-b border-white/5">
                        <span className="text-white/30 text-[10px] w-4 text-right">{i + 1}</span>
                        <span className="text-white text-xs font-semibold flex-1">{u.username || 'Orbiter'}</span>
                        <span className="text-yellow-400 text-[10px] font-bold">⚡ {u.clout_points || 0}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── MOBILE: hologram top 50%, side panel bottom 50% ── */}
          {holoFeature && isMobile && !sideZip && (
            <ZipHologram mobile feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)} />
          )}

          {(sideZip || holoFeature) && isMobile && (
            <div
              className="absolute inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden transition-[top] duration-300"
              style={{
                top: headerCollapsed ? '56px' : '62px',
                background: 'rgba(3,0,10,0.55)',
                backdropFilter: 'blur(14px)',
                borderTop: '1px solid rgba(180,0,0,0.3)',
              }}
            >
              {/* TOP 50% — zip hologram + label row */}
              <div className="flex flex-col overflow-hidden border-b border-white/10" style={{ flex: 1 }}>
                <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
                  <div>
                    <div style={{ color: holoColor || '#cc2200', textShadow: `0 0 12px ${holoColor || '#cc2200'}` }}
                      className="font-black text-sm tracking-widest uppercase">
                      ZIP {sideLabel || holoFeature?.properties?.MODZCTA} — ISOLATED
                    </div>
                    {sideZip && (
                      <p className="text-white/40 text-xs">
                        {isSafezoneModzcta(sideZip)
                          ? `🛡️ ${getSafezoneLabel(sideZip)} · ${sideEvents.length} events`
                          : `${sideEvents.length} events · ${sideColonists.length} colonists`}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => { setSideZip(null); setSideEvents([]); setSideColonists([]); setHoloFeature(null); }}
                    className="w-8 h-8 rounded-full border font-black text-xs flex items-center justify-center hover:bg-white/20 flex-shrink-0"
                    style={{ borderColor: holoColor || '#cc2200', color: holoColor || '#cc2200' }}
                  >✕</button>
                </div>
                {holoFeature && (
                  <ZipHologram mobile feature={holoFeature} color={holoColor} embedded onClose={null} />
                )}
              </div>

              {/* BOTTOM 50% — events + colonists columns */}
              {sideZip && (
                <div className="flex overflow-hidden min-h-0" style={{ flex: 1 }}>
                  <div className="flex-1 flex flex-col overflow-hidden border-r border-white/10 min-h-0">
                    <PaginatedSection
                      items={sideEvents}
                      emptyMsg="None"
                      headerLabel="Events"
                      headerColor="text-white/30"
                      pageSize={headerCollapsed ? 5 : 3}
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
                  {!isSafezoneModzcta(sideZip) ? (
                    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                      <PaginatedSection
                        items={sideColonists}
                        emptyMsg="None yet"
                        headerLabel="Colonists"
                        headerColor="text-green-400/50"
                        pageSize={headerCollapsed ? 7 : 4}
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
                  ) : (
                    <div className="flex-1 flex items-center justify-center p-4">
                      <div className="text-center">
                        <p className="text-2xl mb-2">🛡️</p>
                        <p className="text-emerald-400 font-black text-xs">No colonists in safezones</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Desktop hologram — offset right if MapPostsPanel (left 1/3) is open */}
          {holoFeature && !isMobile && (
            <ZipHologram feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)}
              leftOffset={mapPostsPanel ? '33.333%' : 0} />
          )}

          {/* ── MOBILE: Borough side panel (full-screen, same as zip panel) ── */}
          {sideBorough && isMobile && (
            <div className="absolute inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden transition-[top] duration-300"
              style={{ top: headerCollapsed ? '56px' : '62px', background: 'rgba(3,0,10,0.55)', backdropFilter: 'blur(14px)', borderTop: '1px solid rgba(124,58,237,0.3)' }}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-purple-500/20 flex-shrink-0">
                <div>
                  <div className="text-purple-300 font-black text-sm tracking-widest uppercase">{sideBorough} — BOROUGH</div>
                  <p className="text-white/40 text-xs">{sideBoroughEvents.length} events · {sideBoroughColonists.length} colonists</p>
                </div>
                <button onClick={() => { setSideBorough(null); setSideBoroughEvents([]); setSideBoroughColonists([]); }}
                  className="text-white/50 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">×</button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2">
                <p className="text-purple-300/70 text-[10px] font-bold uppercase tracking-widest mb-2">Events</p>
                {sideBoroughEvents.length === 0 ? (
                  <p className="text-white/30 text-xs text-center py-8">No events in {sideBorough}</p>
                ) : (
                  <PaginatedSection items={sideBoroughEvents} pageSize={6} renderItem={ev => (
                    <div key={ev.id} className="flex items-start gap-3 p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                      style={{ borderLeftColor: ev.hex_color || '#7C3AED', borderLeftWidth: 3 }}
                      onClick={() => setSelectedEvent(ev)}>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl relative"
                        style={{ background: (ev.hex_color || '#7C3AED') + '33', border: `2px solid ${ev.hex_color || '#7C3AED'}` }}>
                        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">{ev.representative_emoji || '🎉'}</span>
                        {ev.photos?.[0] && <img src={ev.photos[0]} className="w-full h-full object-cover relative z-10" alt="" onError={e => e.target.style.display = 'none'} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-sm truncate">{ev.event_name}</p>
                        <p className="text-white/40 text-xs">{ev.event_date} · {ev.price_category === 'free' ? 'FREE' : ev.price_category || '?'}</p>
                      </div>
                    </div>
                  )} />
                )}
                {sideBoroughColonists.length > 0 && (
                  <>
                    <p className="text-purple-300/70 text-[10px] font-bold uppercase tracking-widest mb-2 mt-4">Top Colonists</p>
                    {sideBoroughColonists.slice(0, 10).map((u, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 border-b border-white/5">
                        <span className="text-white/30 text-[10px] w-4 text-right">{i + 1}</span>
                        <span className="text-white text-xs font-semibold flex-1">{u.username || 'Orbiter'}</span>
                        <span className="text-yellow-400 text-[10px] font-bold">⚡ {u.clout_points || 0}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Location active marker removed per user request */}

      {selectedEvent && <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />}

      {/* Afters check-in popup — lightweight modal for afters pin tap */}
      {aftersCheckInEvent && (
        <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setAftersCheckInEvent(null)}>
          <AftersCheckInModal event={aftersCheckInEvent} onClose={() => setAftersCheckInEvent(null)} />
        </div>
      )}

      {/* (Mobile Real3D loading gate removed — PMTiles handles tile fetching natively,
          no popup needed. MapLibre fades tiles in as they arrive from the SW cache.) */}

    </div>
  );
}
