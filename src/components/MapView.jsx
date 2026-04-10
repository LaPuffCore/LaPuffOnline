import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { generateAutoTags } from '../lib/autoTags';
import EventDetailPopup from './EventDetailPopup';
import MapIntro from './MapIntro';
import CRTEffect from './CRTEffect';
import { getZipColonists } from '../lib/pointsSystem';
import { pingNYCLocation, getLastLocation } from '../lib/locationService';

// NOTE: MODZCTA GeoJSON has been cleaned via Mapshaper (earcut triangulation fix applied).
// If polygon artifacting/spikes recur on 3D extrusion, re-clean MODZCTA_2010_WGS1984.geo.json
// through Mapshaper to resolve Earcut triangulation failures before re-deploying.
const GEOJSON_URL       = './data/MODZCTA_2010_WGS1984.geo.json';
const BOROUGH_GEOJSON_URL = './data/borough.geo.json';
const MAPTILER_KEY      = 'VjoJJ0mSCXFo9kFGYGxJ';

const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

const HEAT_COLORS = {
  cold:   '#00ccdd',
  cool:   '#00dd66',
  warm:   '#aadd00',
  orange: '#dd6600',
  hot:    '#cc0d00',
};

const OUTLINE_COLOR = '#ff2200';
const OUTLINE_GLOW  = '#ff0000';

const HEAT_TONES = {
  cold:   ['#003344', '#006688', '#00ccdd'],
  cool:   ['#003311', '#007733', '#00dd66'],
  warm:   ['#334400', '#778800', '#aadd00'],
  orange: ['#441100', '#882200', '#dd6600'],
  hot:    ['#440400', '#880800', '#cc0d00'],
};

// Darker heatmap tones used for the borough outline in 3D+heatmap mode
// so the borough boundary is visually distinct (darker) from the ZIP fill colors above it.
const DARKER_HEAT_COLORS = {
  0: '#004455',  // cold  — visible dark teal (darker than #00ccdd but present)
  1: '#003318',  // cool  — visible dark green (darker than #00dd66 but present)
  2: '#443500',  // warm  — visible dark amber (darker than #aadd00 but present)
  3: '#661500',  // orange — visible dark orange (darker than #dd6600 but present)
  4: '#440000',  // hot   — visible dark red (darker than #cc0d00 but present)
};

// ZIP prefix → BoroCode mapping (BoroCode matches borough.geo.json property)
const BOROUGH_ZIP_PREFIXES = {
  1: ['100', '101'],            // Manhattan (10001–10282)
  2: ['104'],                   // Bronx     (10451–10475)
  3: ['112'],                   // Brooklyn  (11200–11256)
  4: ['110', '113', '114', '116'], // Queens
  5: ['103'],                   // Staten Island (10301–10314)
};

// 5 shades per tier for building cluster coloring (id%5 deterministic).
// Brightness-boosted vs. original for better Real3D visibility.
const HEAT_BUILDING_TONES = {
  cold:   ['#002a3d', '#005c8a', '#00a8c4', '#00d4e0', '#b0f4ff'],
  cool:   ['#001f0a', '#005228', '#00a050', '#00cc6a', '#a0ffcc'],
  warm:   ['#221b00', '#5c4d00', '#a08000', '#d4b400', '#ffe870'],
  orange: ['#220800', '#661800', '#aa4400', '#dd7a00', '#ffa040'],
  hot:    ['#220000', '#660000', '#aa0000', '#dd0000', '#ff5050'],
};

// Brighter-red shades for Real3D non-heatmap buildings (boosted from near-black originals)
const DEFAULT_BUILDING_SHADES = ['#5c0d0d', '#8a1a1a', '#470a0a', '#a01f1f', '#6b1414'];

// NYC 5-borough bounding-box polygon for the 'within' filter.
// Must be a proper GeoJSON Polygon geometry object (not a flat bbox array).
const NYC_BBOX_GEOM = {
  type: 'Polygon',
  coordinates: [[
    [-74.26, 40.48], [-73.68, 40.48],
    [-73.68, 40.93], [-74.26, 40.93],
    [-74.26, 40.48],
  ]],
};

// Build a precise MultiPolygon geometry from loaded borough.geo.json for the
// 'within' filter on Real3D buildings, accurately excluding NJ/CT buildings.
// Falls back to the bounding-box polygon if borough data hasn't loaded yet.
function buildNYCWithinGeom(boroughData) {
  if (!boroughData || !boroughData.features || boroughData.features.length === 0) {
    return NYC_BBOX_GEOM;
  }
  const allPolygons = [];
  boroughData.features.forEach(f => {
    const geom = f.geometry;
    if (!geom) return;
    if (geom.type === 'Polygon') {
      allPolygons.push(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => allPolygons.push(poly));
    }
  });
  if (allPolygons.length === 0) return NYC_BBOX_GEOM;
  return { type: 'MultiPolygon', coordinates: allPolygons };
}

function tierColor(tier) {
  if (tier >= 4) return HEAT_COLORS.hot;
  if (tier >= 3) return HEAT_COLORS.orange;
  if (tier >= 2) return HEAT_COLORS.warm;
  if (tier >= 1) return HEAT_COLORS.cool;
  return HEAT_COLORS.cold;
}

function isSpecialZip(zip) {
  return !zip || zip === '' || zip === '99999' || parseInt(zip) > 11697;
}

function buildZipEventMap(events, days) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const maxDate = new Date(now.getTime() + days * 86400000);
  const zipMap = {};
  events.forEach(e => {
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

// Compute average tier per borough for heatmap-mode borough outline coloring.
// Uses the BOROUGH_ZIP_PREFIXES mapping to assign each ZIP to a BoroCode.
function computeBoroughTiers(features, tiers) {
  const sums = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  features.forEach((f, i) => {
    if (f.properties._special) return;
    const zip = String(f.properties.MODZCTA || '');
    const prefix = zip.slice(0, 3);
    const tier = tiers[i] ?? 0;
    if (tier < 0) return;
    for (const [code, prefixes] of Object.entries(BOROUGH_ZIP_PREFIXES)) {
      if (prefixes.includes(prefix)) { sums[parseInt(code)].push(tier); break; }
    }
  });
  const result = {};
  for (const [code, list] of Object.entries(sums)) {
    result[parseInt(code)] = list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0;
  }
  return result;
}

// ── Geometry helpers ───────────────────────────────────────────────────────────
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
  const denom = (-s2x * s1y + s1x * s2y);
  if (Math.abs(denom) < 1e-9) return null;
  const s = (-s1y * (p0[0] - q0[0]) + s1x * (p0[1] - q0[1])) / denom;
  return [q0[0] + s * s2x, q0[1] + s * s2y];
}
function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}
function dedupeRing(ring) {
  if (!ring || ring.length === 0) return [];
  const cleaned = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = ring[i], [px, py] = cleaned[cleaned.length - 1];
    if (Math.abs(x - px) > 1e-8 || Math.abs(y - py) > 1e-8) cleaned.push(ring[i]);
  }
  if (cleaned.length > 1) {
    const [x, y] = cleaned[0], [lx, ly] = cleaned[cleaned.length - 1];
    if (Math.abs(x - lx) < 1e-8 && Math.abs(y - ly) < 1e-8) cleaned.pop();
  }
  return cleaned;
}
function isNearlyCollinear(a, b, c) {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-8;
}
function simplifyRing(ring) {
  if (ring.length < 4) return ring;
  const s = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    if (!isNearlyCollinear(s[s.length - 1], ring[i], ring[i + 1])) s.push(ring[i]);
  }
  s.push(ring[ring.length - 1]);
  return s.length >= 4 ? s : ring;
}
function subdivideRing(ring, minPoints = 8) {
  const closed = closeRing(ring);
  const baseCount = closed.length - 1;
  if (baseCount >= minPoints) return closed;
  const insertCount = Math.max(1, Math.ceil((minPoints - baseCount) / baseCount));
  const sub = [];
  for (let i = 0; i < baseCount; i++) {
    const cur = closed[i], nxt = closed[i + 1];
    sub.push(cur);
    for (let s = 1; s <= insertCount; s++) {
      const t = s / (insertCount + 1);
      sub.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]);
    }
  }
  return closeRing(sub);
}
function smoothRing(ring, passes = 1) {
  let cur = closeRing(ring).slice(0, -1);
  for (let p = 0; p < passes; p++) {
    if (cur.length < 3) break;
    const nxt = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      nxt.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      nxt.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = nxt;
  }
  return closeRing(cur);
}
function closeRing(ring) {
  if (!ring.length) return ring;
  if (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) return ring;
  return [...ring, ring[0]];
}
function normalizeRing(ring) {
  const closed = closeRing(ring);
  const deduped = dedupeRing(closed);
  if (deduped.length < 4) return null;
  return closeRing(simplifyRing(deduped));
}
function normalizePolygonCoords(coords) {
  return coords.map(normalizeRing).filter(r => r && r.length >= 4)
    .map(r => { const c = closeRing(r); return c && c.length >= 4 ? c : null; }).filter(Boolean);
}
function normalizeFeatureGeometry(feature) {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    const rings = normalizePolygonCoords(geom.coordinates);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates.map(normalizePolygonCoords).filter(r => r.length);
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null;
}

// Zoom-aware outline width — thicker at low zoom to combat MSAA sub-pixel shimmering
function getZoomAwareOutlineWidth(map, baseMeters = 14) {
  if (!map || typeof map.getZoom !== 'function') return baseMeters;
  const zoom = map.getZoom();
  return baseMeters + Math.max(0, 13 - zoom) * 5;
}

function offsetRing(outerRing, widthMeters) {
  const normalized = normalizeRing(outerRing);
  if (!normalized || normalized.length < 4) return null;
  let ring = normalized[0][0] === normalized[normalized.length - 1][0]
    ? normalized.slice(0, -1) : normalized;
  if (ring.length < 3) return null;
  ring = subdivideRing(ring, 10);
  ring = smoothRing(ring, Math.min(2, Math.max(1, Math.floor(widthMeters / 24))));
  const refLat = ring.reduce((s, [, y]) => s + y, 0) / ring.length;
  const pts = ring.map(c => lngLatToMeters(c, refLat));
  const orientation = signedArea([...pts, pts[0]]) >= 0 ? 1 : -1;
  const hw = widthMeters / 2;
  const normals = pts.map((p, i) => {
    const n = pts[(i + 1) % pts.length];
    const dx = n[0] - p[0], dy = n[1] - p[1];
    return normalize(orientation > 0 ? [dy, -dx] : [-dy, dx]);
  });
  const makeEdges = (sign) => pts.map((p, i) => {
    const n = pts[(i + 1) % pts.length], nm = normals[i];
    return { p0: [p[0] + nm[0] * hw * sign, p[1] + nm[1] * hw * sign], p1: [n[0] + nm[0] * hw * sign, n[1] + nm[1] * hw * sign] };
  });
  const outerE = makeEdges(1), innerE = makeEdges(-1);
  const project = (edges, sign) => pts.map((_, i) => {
    const prev = edges[(i - 1 + edges.length) % edges.length], curr = edges[i];
    const ix = lineIntersection(prev.p0, prev.p1, curr.p0, curr.p1);
    if (ix) return ix;
    const avg = normalize([normals[(i - 1 + normals.length) % normals.length][0] + normals[i][0],
                           normals[(i - 1 + normals.length) % normals.length][1] + normals[i][1]]);
    return [pts[i][0] + avg[0] * hw * sign, pts[i][1] + avg[1] * hw * sign];
  });
  const outerGeo = closeRing(project(outerE, 1)).map(c => metersToLngLat(c, refLat));
  const innerGeo = closeRing(project(innerE, -1).reverse()).map(c => metersToLngLat(c, refLat));
  if (outerGeo.length < 8 || innerGeo.length < 8) return null;
  return [outerGeo, innerGeo];
}

function createOutlineGeoJSON(sourceGeoJSON, widthMeters = 12) {
  return {
    type: 'FeatureCollection',
    features: sourceGeoJSON.features.map(feature => {
      // Skip special zones — they don't get the 3D outline ring
      if (feature.properties._special) return null;
      const normalizedGeom = normalizeFeatureGeometry(feature) || feature.geometry;
      if (!normalizedGeom) return null;
      if (normalizedGeom.type === 'Polygon') {
        const outline = offsetRing(normalizedGeom.coordinates[0], widthMeters);
        if (!outline) return null;
        return { ...feature, geometry: { type: 'Polygon', coordinates: outline } };
      }
      if (normalizedGeom.type === 'MultiPolygon') {
        const polygons = normalizedGeom.coordinates
          .map(poly => offsetRing(poly[0], widthMeters))
          .filter(Boolean);
        if (!polygons.length) return null;
        return { ...feature, geometry: { type: 'MultiPolygon', coordinates: polygons } };
      }
      return null;
    }).filter(Boolean),
  };
}

// ── Map styles ────────────────────────────────────────────────────────────────
function darkMapStyle() {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d0000' } }],
  };
}
function satelliteMapStyle() {
  return {
    version: 8,
    sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 } },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  };
}

const MEDALS   = ['🥇', '🥈', '🥉'];
const PAGE_SIZE = 6;

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
  const canvasRef = useRef(null), animRef = useRef(null), timeRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const allRings = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates.flat(1) : feature.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }));
    const geoW = maxX - minX, geoH = maxY - minY, padding = 0.15;
    const scale = Math.min(W * (1 - padding * 2) / geoW, H * (1 - padding * 2) / geoH);
    const offX = W / 2 - (minX + geoW / 2) * scale, offY = H / 2 + (minY + geoH / 2) * scale;
    const project = (lng, lat) => [lng * scale + offX, -lat * scale + offY];
    const drawShape = (dx, dy, alpha, strokeOnly) => {
      ctx.save(); ctx.translate(dx, dy);
      allRings.forEach(ring => {
        ctx.beginPath();
        ring.forEach(([x, y], i) => { const [px, py] = project(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        ctx.closePath();
        if (!strokeOnly) { ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0'); ctx.fill(); }
        ctx.strokeStyle = color; ctx.lineWidth = strokeOnly ? 1.5 : 2; ctx.globalAlpha = alpha; ctx.stroke();
      });
      ctx.restore();
    };
    const frame = () => {
      timeRef.current += 0.018; const t = timeRef.current, rotY = Math.sin(t) * 0.35;
      ctx.clearRect(0, 0, W, H);
      const depth = 18;
      for (let d = depth; d >= 0; d--) drawShape(Math.sin(rotY) * d * 1.8, -d * 0.7, 0.08 + (1 - d / depth) * 0.18, d > 0);
      const ts = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1; drawShape(ts, -depth * 0.7, 0.55, false);
      if (Math.random() < 0.04) { for (let g = 0; g < Math.floor(Math.random() * 5) + 2; g++) { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.fillRect((Math.random() - 0.5) * 20, Math.random() * H, W, Math.random() * 6 + 2); ctx.restore(); } }
      ctx.save(); ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2; ctx.shadowColor = color; ctx.shadowBlur = 20; drawShape(ts, -depth * 0.7, 0.9, true); ctx.restore();
      if (Math.sin(t * 7) > 0.92) { ctx.fillStyle = color + '22'; ctx.fillRect(0, 0, W, H); }
      animRef.current = requestAnimationFrame(frame);
    };
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color]);
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
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

// ── ZipHologramMobile ─────────────────────────────────────────────────────────
function ZipHologramMobile({ feature, color, onClose }) {
  const canvasRef = useRef(null), animRef = useRef(null), timeRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const allRings = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates.flat(1) : feature.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }));
    const geoW = maxX - minX, geoH = maxY - minY, padding = 0.15;
    const scale = Math.min(W * (1 - padding * 2) / geoW, H * (1 - padding * 2) / geoH);
    const offX = W / 2 - (minX + geoW / 2) * scale, offY = H / 2 + (minY + geoH / 2) * scale;
    const project = (lng, lat) => [lng * scale + offX, -lat * scale + offY];
    const drawShape = (dx, dy, alpha, strokeOnly) => {
      ctx.save(); ctx.translate(dx, dy);
      allRings.forEach(ring => {
        ctx.beginPath();
        ring.forEach(([x, y], i) => { const [px, py] = project(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        ctx.closePath();
        if (!strokeOnly) { ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '00'); ctx.fill(); }
        ctx.strokeStyle = color; ctx.lineWidth = strokeOnly ? 1.5 : 2; ctx.globalAlpha = alpha; ctx.stroke();
      });
      ctx.restore();
    };
    const frame = () => {
      timeRef.current += 0.018; const t = timeRef.current, rotY = Math.sin(t) * 0.35;
      ctx.clearRect(0, 0, W, H);
      const depth = 14;
      for (let d = depth; d >= 0; d--) drawShape(Math.sin(rotY) * d * 1.8, -d * 0.7, 0.08 + (1 - d / depth) * 0.18, d > 0);
      const ts = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1; drawShape(ts, -depth * 0.7, 0.55, false);
      if (Math.random() < 0.04) { for (let g = 0; g < 3; g++) { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.fillRect((Math.random() - 0.5) * 20, Math.random() * H, W, Math.random() * 6 + 2); ctx.restore(); } }
      ctx.save(); ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2; ctx.shadowColor = color; ctx.shadowBlur = 20; drawShape(ts, -depth * 0.7, 0.9, true); ctx.restore();
      animRef.current = requestAnimationFrame(frame);
    };
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
  const containerRef      = useRef(null);
  const mapContainerRef   = useRef(null);
  const mapRef            = useRef(null);
  const hoveredIdRef      = useRef(null);
  const locationMarkerRef = useRef(null);
  const heatmapRef        = useRef(false);
  const threeDRef         = useRef(false);
  const tiersRef          = useRef([]);
  const geoDataRef        = useRef(null);
  const layerHandlersRef  = useRef({ handleZctaHover: null, handleZctaLeave: null, handleZctaClick: null });
  const real3DRef         = useRef(false);
  const satelliteRef      = useRef(false);
  const withHeatRef       = useRef(null);
  const boroughGeoRef     = useRef(null);

  const [timespanIdx,      setTimespanIdx]      = useState(4);
  const [heatmap,          setHeatmap]          = useState(false);
  const [satellite,        setSatellite]        = useState(false);
  const [threeD,           setThreeD]           = useState(false);
  const [real3D,           setReal3D]           = useState(false);
  const [geoData,          setGeoData]          = useState(null);
  const [boroughGeo,       setBoroughGeo]       = useState(null);
  const [adjacency,        setAdjacency]        = useState([]);
  const [mapReady,         setMapReady]         = useState(false);
  const [entered,          setEntered]          = useState(false);
  const [hoveredZip,       setHoveredZip]       = useState(null);
  const [hoveredEvents,    setHoveredEvents]    = useState([]);
  const [hoveredColonists, setHoveredColonists] = useState(null);
  const [tooltipPos,       setTooltipPos]       = useState(null);
  const [sideZip,          setSideZip]          = useState(null);
  const [sideEvents,       setSideEvents]       = useState([]);
  const [sideColonists,    setSideColonists]    = useState([]);
  const [selectedEvent,    setSelectedEvent]    = useState(null);
  const [userLocation,     setUserLocation]     = useState(getLastLocation());
  const [notInNYC,         setNotInNYC]         = useState(false);
  const [locLoading,       setLocLoading]       = useState(false);
  const [holoFeature,      setHoloFeature]      = useState(null);
  const [holoColor,        setHoloColor]        = useState(HEAT_COLORS.cold);
  const [isMobile,         setIsMobile]         = useState(false);
  const [styleVersion,     setStyleVersion]     = useState(0);

  heatmapRef.current   = heatmap;
  threeDRef.current    = threeD;
  real3DRef.current    = real3D;
  satelliteRef.current = satellite;
  geoDataRef.current   = geoData;
  boroughGeoRef.current = boroughGeo;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check(); window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Load ZCTA data
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

  // Load borough GeoJSON (political boundaries from borough.geo.json)
  useEffect(() => {
    fetch(BOROUGH_GEOJSON_URL)
      .then(r => r.json())
      .then(data => setBoroughGeo(data))
      .catch(err => console.warn('Borough geo load failed, borough outlines unavailable:', err));
  }, []);

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
      // Push nav control up so the zoom-out (–) button isn't covered by the recenter button
      const navEl = mapContainerRef.current?.querySelector('.maplibregl-ctrl-bottom-right');
      if (navEl) navEl.style.marginBottom = '80px';
      setMapReady(true);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── addLayers ──────────────────────────────────────────────────────────────
  // boroughData: pre-loaded borough.geo.json FeatureCollection (may be null on first call)
  function addLayers(map, data, sat, boroughData) {
    if (!map || !data || map.getSource('zcta')) return;
    map.addSource('zcta', { type: 'geojson', data, generateId: false });

    // ── 3D extrusion base — fully opaque, blocks ground lines beneath it ──
    map.addLayer({
      id: 'zcta-extrude', type: 'fill-extrusion', source: 'zcta',
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['get', '_special'], false], '#222222', '#1a0505'],
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,
      },
    });

    // ── Flat fill ──
    map.addLayer({
      id: 'zcta-fill', type: 'fill', source: 'zcta',
      paint: {
        'fill-color': ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505'],
        'fill-opacity': sat ? 0.38 : 0.55,
      },
    });

    // ── Hover (electric purple) ──
    map.addLayer({
      id: 'zcta-hover', type: 'fill', source: 'zcta',
      paint: { 'fill-color': '#7C3AED', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.5, 0] },
    });

    // ── Safe zone outline ──
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': 2, 'line-opacity': 1 },
    });

    // ── 2D ground boundary lines (non-special) — hidden unconditionally in 3D/Real3D ──
    map.addLayer({
      id: 'zcta-line-glow2', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_GLOW, 'line-width': 3, 'line-opacity': sat ? 0.25 : 0.35, 'line-blur': 10 },
    });
    map.addLayer({
      id: 'zcta-line-glow', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_COLOR, 'line-width': 1, 'line-opacity': sat ? 0.55 : 0.75, 'line-blur': 3 },
    });
    map.addLayer({
      id: 'zcta-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': OUTLINE_COLOR, 'line-width': 0.5, 'line-opacity': 1 },
    });

    // ── Borough outer boundary ────────────────────────────────────────────────
    // Uses the political borough.geo.json (5 features, one per borough).
    // Rendered as fill-extrusion with height=1. Because it's an extrusion it
    // participates in the WebGL depth buffer — it can never be seen "through"
    // a taller zip-extrusion (line layers ignore depth, fill-extrusions don't).
    // The _tier property is stamped per-feature in the main update effect so
    // heatmap-mode coloring uses the proper per-borough tier.
    const boroughSource = boroughData || { type: 'FeatureCollection', features: [] };
    map.addSource('nyc-boroughs', { type: 'geojson', data: boroughSource });
    map.addLayer({
      id: 'nyc-boroughs-fill', type: 'fill-extrusion', source: 'nyc-boroughs',
      paint: {
        'fill-extrusion-color': OUTLINE_COLOR,   // overridden in update effect
        'fill-extrusion-height': 1,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,             // hidden by default; shown only in 3D mode
        'fill-extrusion-vertical-gradient': false,
      },
    });

    // ── Upper 3D outline ring (sits ON TOP of each zip extrusion block) ──────
    // Source: offset ring polygons computed from ZCTA shapes.
    // base = block top, height = block top + zoom-interpolated delta.
    // Zoom interpolation prevents MSAA sub-pixel shimmering at low zoom.
    // This is the ONLY outline visible in 3D mode — all 2D line layers are hidden.
    map.addSource('zcta-outline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, generateId: false });
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

    // Mouse events
    const handleZctaHover = e => {
      if (!e.features.length) return;
      const f = e.features[0];
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== f.id)
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
      hoveredIdRef.current = f.id;
      map.setFeatureState({ source: 'zcta', id: f.id }, { hovered: true });
      map.getCanvas().style.cursor = 'pointer';
      setHoveredZip(String(f.properties.MODZCTA || ''));
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
      openSidePanel(String(e.features[0].properties.MODZCTA || ''));
      openHologram(e.features[0]);
    };
    layerHandlersRef.current = { handleZctaHover, handleZctaLeave, handleZctaClick };
    map.on('mousemove', 'zcta-fill', handleZctaHover);
    map.on('mouseleave', 'zcta-fill', handleZctaLeave);
    map.on('click', 'zcta-fill', handleZctaClick);
  }

  function openHologram(clickedFeature) {
    const data = geoDataRef.current; if (!data) return;
    const feat = data.features.find(f => f.id === clickedFeature.id) || clickedFeature;
    const idx = data.features.findIndex(f => f.id === clickedFeature.id);
    const tier = tiersRef.current[idx] ?? 0;
    setHoloFeature(feat);
    setHoloColor(tier < 0 ? '#888888' : tierColor(tier));
  }

  // Initial layer add — runs when map + ZCTA data are both ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData) return;
    addLayers(map, geoData, satellite, boroughGeoRef.current);
  }, [mapReady, geoData]);

  // If borough data loads AFTER the map/layers are ready, push it into the source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !boroughGeo) return;
    if (map.getSource('nyc-boroughs')) {
      map.getSource('nyc-boroughs').setData(boroughGeo);
    }
  }, [boroughGeo, mapReady]);

  // Switch hover target between fill (2D) and extrude (3D)
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
    withHeatRef.current = withHeat;

    // Rebuild the upper-3D-border offset ring with current zoom-aware width
    if (map.getSource('zcta-outline')) {
      map.getSource('zcta-outline').setData(createOutlineGeoJSON(withHeat, getZoomAwareOutlineWidth(map)));
    }

    // Compute per-borough average tiers for heatmap coloring of borough outline
    const boroughTiers = computeBoroughTiers(geoData.features, tiers);

    // Update borough source data with _tier per feature so paint expressions can use it
    if (map.getSource('nyc-boroughs') && boroughGeoRef.current) {
      const tieredBoroughData = {
        ...boroughGeoRef.current,
        features: boroughGeoRef.current.features.map(f => ({
          ...f,
          properties: { ...f.properties, _tier: boroughTiers[f.properties.BoroCode] ?? 0 },
        })),
      };
      map.getSource('nyc-boroughs').setData(tieredBoroughData);
    }

    const heatColorExpr = [
      'case', ['boolean', ['get', '_special'], false], '#ffffff',
      ['step', ['get', '_tier'], HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm, 3, HEAT_COLORS.orange, 4, HEAT_COLORS.hot],
    ];
    const withHoverColor = (base) => ['case', ['boolean', ['feature-state', 'hovered'], false], '#7C3AED', base];

    const extrudeH = ['case', ['boolean', ['get', '_special'], false], 30,
      ['step', ['get', '_tier'], 30, 1, 200, 2, 700, 3, 1600, 4, 2800]];
    const flatH = ['case', ['boolean', ['get', '_special'], false], 30, 400];

    // Zoom-interpolated upper-3D-border thickness:
    // thick at low zoom (prevents MSAA sub-pixel shimmering), thin at high zoom (clean edge).
    // Only applies to 3D and all 3D combos via zcta-outline fill-extrusion.
    const outlineRingDelta = ['interpolate', ['linear'], ['zoom'],
      9, 80, 10, 50, 11, 32, 12, 22, 13, 16, 14, 12, 16, 10,
    ];

    // ── FILL LAYER opacity ──
    // threeD:  fill hidden entirely — extrusion layer is the visual
    // real3D:  fill reduced so buildings read clearly above the ZIP color field
    //   heatmap+real3D: 0.55 — ZIP colour zone is the dominant signal (ZIP-strict look)
    //   noHeat +real3D: 0.18 — very subtle dark ground; buildings are the feature
    // 2D/satellite: normal opacity
    if (heatmap) {
      map.setPaintProperty('zcta-fill', 'fill-color', heatColorExpr);
      map.setPaintProperty('zcta-fill', 'fill-opacity',
        threeD ? 0 : (real3D ? 0.55 : (satellite ? 0.5 : 0.9)));
    } else {
      map.setPaintProperty('zcta-fill', 'fill-color', ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505']);
      map.setPaintProperty('zcta-fill', 'fill-opacity',
        threeD ? 0 : (real3D ? 0.18 : (satellite ? 0.38 : 0.55)));
    }

    // ── 3D EXTRUSION block + related layer visibility ──
    if (threeD) {
      map.setPaintProperty('zcta-safe-line', 'line-opacity', 0);

      if (heatmap) {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', withHoverColor([
          'case', ['boolean', ['get', '_special'], false], '#111111',
          ['step', ['get', '_tier'], HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm, 3, HEAT_COLORS.orange, 4, HEAT_COLORS.hot],
        ]));
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', extrudeH);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 1.0);
      } else {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', withHoverColor(
          ['case', ['boolean', ['get', '_special'], false], '#111111', '#3a0505']));
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', flatH);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', satellite ? 0.9 : 1.0);
      }
      map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);

      // ── Hide ALL 2D ground lines in 3D mode ──
      // The extrusions are fully opaque and physically occlude the ground plane.
      // Setting opacity=0 prevents any angle-based X-Ray bleed-through.
      map.setPaintProperty('zcta-line',       'line-opacity', 0);
      map.setPaintProperty('zcta-line-glow',  'line-opacity', 0);
      map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);

      // ── Borough boundary: fill-extrusion height=1 (NOT a line layer) ──
      // Because it's an extrusion, it participates in the depth buffer and is
      // occluded behind taller ZIP extrusions — it can never be seen "through" them.
      // In heatmap mode, each borough gets a darker differential of its average tier color.
      // In non-heatmap mode, standard red.
      if (map.getLayer('nyc-boroughs-fill')) {
        const boroughColorExpr = heatmap
          ? ['step', ['get', '_tier'],
              DARKER_HEAT_COLORS[0],
              1, DARKER_HEAT_COLORS[1],
              2, DARKER_HEAT_COLORS[2],
              3, DARKER_HEAT_COLORS[3],
              4, DARKER_HEAT_COLORS[4]]
          : OUTLINE_COLOR;
        map.setPaintProperty('nyc-boroughs-fill', 'fill-extrusion-color', boroughColorExpr);
        map.setPaintProperty('nyc-boroughs-fill', 'fill-extrusion-opacity', satellite ? 0.6 : 0.9);
      }

      // ── Upper 3D border (zcta-outline) ──
      // Base = top of each ZIP block, height = base + zoom-delta.
      // Only the upper ring is visible; all 2D lines are hidden above.
      if (map.getSource('zcta-outline')) {
        const baseH = heatmap ? extrudeH : flatH;
        map.setPaintProperty('zcta-outline', 'fill-extrusion-color', OUTLINE_COLOR);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-base', baseH);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-height', ['+', baseH, outlineRingDelta]);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-opacity', 0.98);
      }
    } else {
      // ── 2D mode ──
      map.setPaintProperty('zcta-safe-line', 'line-opacity', 1);
      map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
      map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);
      map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0);

      // Restore 2D ground lines, hide 3D outline ring, hide borough outline
      map.setPaintProperty('zcta-line',       'line-opacity', 1);
      map.setPaintProperty('zcta-line-glow',  'line-opacity', satellite ? 0.55 : 0.75);
      map.setPaintProperty('zcta-line-glow2', 'line-opacity', satellite ? 0.25 : 0.35);

      if (map.getLayer('nyc-boroughs-fill')) {
        map.setPaintProperty('nyc-boroughs-fill', 'fill-extrusion-opacity', 0);
      }
      if (map.getSource('zcta-outline')) {
        map.setPaintProperty('zcta-outline', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-outline', 'fill-extrusion-opacity', 0);
      }
    }

    // Hover fill only in 2D; 3D hover handled via extrusion color expression
    map.setPaintProperty('zcta-hover', 'fill-opacity', threeD ? 0 : ['case', ['boolean', ['feature-state', 'hovered'], false], 0.5, 0]);

  }, [heatmap, threeD, real3D, timespanIdx, events, geoData, boroughGeo, mapReady, satellite, adjacency, styleVersion]);

  // 3D pitch
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
    map.easeTo({ pitch: threeD ? 48 : 0, bearing: threeD ? -17 : 0, duration: 700 });
  }, [threeD, mapReady]);

  // Re-generate upper-3D-border width on zoom (only when 3D active)
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
    const onZoom = () => {
      if (!threeDRef.current || !withHeatRef.current) return;
      if (map.getSource('zcta-outline'))
        map.getSource('zcta-outline').setData(createOutlineGeoJSON(withHeatRef.current, getZoomAwareOutlineWidth(map)));
    };
    map.on('zoom', onZoom);
    return () => map.off('zoom', onZoom);
  }, [mapReady]);

  // Satellite — additive, re-adds all layers and triggers main effect via styleVersion
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
    map.setStyle(satellite ? satelliteMapStyle() : darkMapStyle());
    map.once('styledata', () => {
      const cur = geoDataRef.current;
      if (!cur || map.getSource('zcta')) return;
      addLayers(map, cur, satelliteRef.current, boroughGeoRef.current);
      if (real3DRef.current) applyReal3DLayers(map, heatmapRef.current, boroughGeoRef.current);
      setStyleVersion(v => v + 1);
    });
  }, [satellite]);

  // ── Real3D building color expression ─────────────────────────────────────
  // Pure declarative GPU paint expression — no queryRenderedFeatures, no flash.
  //
  // Non-heatmap: id%5 deterministic shade from DEFAULT_BUILDING_SHADES (bright reds).
  // Heatmap: height-band → HEAT_BUILDING_TONES color (best GPU-only approximation;
  // true ZIP-strict coloring requires server-side tile enrichment which is out of scope).
  // The ZCTA fill layer provides the actual ZIP heatmap color at ground level beneath
  // the buildings, giving a ZIP-boundary-accurate color field as the visual base.
  function buildingColorExpr(isHeatmap) {
    const shadeIdx = ['%', ['to-number', ['id'], 0], 5];

    if (!isHeatmap) {
      return ['case',
        ['==', shadeIdx, 0], DEFAULT_BUILDING_SHADES[0],
        ['==', shadeIdx, 1], DEFAULT_BUILDING_SHADES[1],
        ['==', shadeIdx, 2], DEFAULT_BUILDING_SHADES[2],
        ['==', shadeIdx, 3], DEFAULT_BUILDING_SHADES[3],
        DEFAULT_BUILDING_SHADES[4],
      ];
    }

    // Height-band tier selection, then shade variation within that tier
    const tones = (band) => {
      const t = HEAT_BUILDING_TONES[band];
      return ['case',
        ['==', shadeIdx, 0], t[0],
        ['==', shadeIdx, 1], t[1],
        ['==', shadeIdx, 2], t[2],
        ['==', shadeIdx, 3], t[3],
        t[4],
      ];
    };
    const h = ['coalesce', ['get', 'render_height'], ['get', 'height'], 5];
    return ['case',
      ['>', h, 150], tones('hot'),
      ['>', h, 80],  tones('orange'),
      ['>', h, 35],  tones('warm'),
      ['>', h, 12],  tones('cool'),
      tones('cold'),
    ];
  }

  // applyReal3DLayers:
  //   - boroughData: borough.geo.json FeatureCollection used for the precise 'within' filter.
  //   - Single unified layer — no separate baseplate competing for Z-space.
  //   - zoom-interpolated height: flat footprint → full 3D over zoom 11–13.5.
  //   - minzoom=11 (1 tick earlier than v12's 12 for faster render-in).
  //   - within filter uses actual borough polygon geometry (precise NYC clip, excludes NJ/CT).
  //   - default color is red palette (no cyan flash on tile load).
  //   - opacity reduced when heatmap is on so ZIP fill ground plane bleeds through,
  //     producing a visually ZIP-strict color effect without server-side tile enrichment.
  function applyReal3DLayers(map, isHeatmap, boroughData) {
    ['real3d-buildings'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });

    if (!map.getSource('openmaptiles')) {
      try {
        map.addSource('openmaptiles', {
          type: 'vector',
          url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`,
        });
      } catch (err) { console.warn('Real3D source add failed:', err); return; }
    }

    // Use the precise borough polygon union — accurate NYC boundary, not just a bbox.
    // This excludes buildings in NJ that fall inside the simple rectangular bbox.
    const withinGeom = buildNYCWithinGeom(boroughData);

    const buildingColor = buildingColorExpr(isHeatmap);
    const hgt  = ['coalesce', ['get', 'render_height'], ['get', 'height'], 5];
    const base = ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0];

    try {
      map.addLayer({
        id: 'real3d-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 11,
        filter: ['within', withinGeom],
        paint: {
          'fill-extrusion-color': buildingColor,
          // Single-layer baseplate→3D transition:
          //   zoom 11–12.5: height=0 (flat footprint / memory-efficient baseplate phase)
          //   zoom 12.5–13.5: lerp (smooth transition)
          //   zoom 13.5+: full building height (real 3D)
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'],
            11, 0, 12.5, 0, 13.5, hgt,
          ],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'],
            11, 0, 12.5, 0, 13.5, base,
          ],
          // When heatmap on: buildings semi-transparent so ZCTA fill (ZIP-accurate colours)
          // shows through from below → visually ZIP-strict colouring without tile enrichment.
          // When heatmap off: fully opaque for maximum red-palette clarity.
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'],
            11, isHeatmap ? 0.55 : 0.78,
            13.5, isHeatmap ? 0.78 : 1.0,
          ],
          'fill-extrusion-vertical-gradient': true,
        },
      });
      map.easeTo({ pitch: 55, bearing: -17, duration: 700 });
    } catch (err) { console.warn('Real3D layer add failed:', err); }
  }

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
    if (!real3D) {
      if (map.getLayer('real3d-buildings')) map.removeLayer('real3d-buildings');
      if (!threeD) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      return;
    }
    applyReal3DLayers(map, heatmapRef.current, boroughGeoRef.current);
  }, [real3D, mapReady]);

  // When heatmap changes while real3D is active, re-apply so opacity + colour both update
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !real3D || !map.getLayer('real3d-buildings')) return;
    applyReal3DLayers(map, heatmap, boroughGeoRef.current);
  }, [heatmap, real3D, mapReady]);

  const handleThreeDToggle  = () => { setThreeD(v => { if (!v) setReal3D(false); return !v; }); };
  const handleReal3DToggle  = () => { setReal3D(v => { if (!v) setThreeD(false); return !v; }); };

  // Location orb
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
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
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);

  const zipLabel  = hoveredZip === 'SAFEZONE' ? 'Safe Zone' : hoveredZip ? `ZIP ${hoveredZip}` : '';
  const sideLabel = sideZip   === 'SAFEZONE' ? 'Safe Zone' : sideZip   ? `ZIP ${sideZip}`   : '';

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden" style={{ background: '#0d0000' }}>

      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
        <CRTEffect active={true} limitMobile={isMobile} />
      </div>

      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 2, background: 'transparent' }} />

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
          </div>

          {/* Recenter button — positioned above the nav control (which has marginBottom:80px) */}
          <button onClick={handleCenterLocation} disabled={locLoading}
            className="absolute bottom-36 right-4 z-30 w-11 h-11 bg-black/80 border border-white/30 rounded-xl flex items-center justify-center hover:bg-[#7C3AED]/80 hover:border-[#7C3AED] transition-all shadow-lg">
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

          {/* Desktop side panel */}
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
                <PaginatedSection items={sideEvents} emptyMsg="No upcoming events" headerLabel="Events" headerColor="text-white/30"
                  renderItem={(event) => (
                    <div key={event.id} onClick={() => setSelectedEvent(event)}
                      className="flex items-start gap-3 p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                      style={{ borderLeftColor: event.hex_color || '#7C3AED', borderLeftWidth: 3 }}>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl"
                        style={{ background: (event.hex_color || '#7C3AED') + '33', border: `2px solid ${event.hex_color || '#7C3AED'}` }}>
                        {event.photos?.[0] ? <img src={event.photos[0]} className="w-full h-full object-cover" alt="" onError={e => { e.target.style.display = 'none'; }} /> : event.representative_emoji || '🎉'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-sm truncate">{event.representative_emoji} {event.event_name}</p>
                        <p className="text-white/40 text-xs">{event.event_date} · {event.price_category === 'free' ? 'FREE' : event.price_category || '?'}</p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {generateAutoTags(event).slice(0, 2).map(t => <span key={t} className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded-full">{t}</span>)}
                        </div>
                      </div>
                    </div>
                  )} />
              </div>
              {sideZip !== 'SAFEZONE' && (
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: '50%' }}>
                  <PaginatedSection items={sideColonists} emptyMsg="No colonists yet" headerLabel="Colony Leaderboard" headerColor="text-green-400/50"
                    renderItem={(c, i) => {
                      const medal = MEDALS[i] || null, isTop = i < 3;
                      return (
                        <div key={c.username || i} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 hover:bg-white/5"
                          style={{ background: isTop ? `rgba(${i === 0 ? '255,200,0' : i === 1 ? '180,180,180' : '200,120,60'},0.06)` : 'transparent' }}>
                          <div className="w-7 text-center flex-shrink-0">{medal ? <span className="text-lg">{medal}</span> : <span className="text-xs font-black text-white/20">#{i + 1}</span>}</div>
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
                    }} />
                </div>
              )}
            </div>
          )}

          {/* Mobile hologram + side panel */}
          {holoFeature && isMobile && <ZipHologramMobile feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)} />}

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
                  <PaginatedSection items={sideEvents} emptyMsg="None" headerLabel="Events" headerColor="text-white/30"
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
                    )} />
                </div>
                {sideZip !== 'SAFEZONE' && (
                  <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    <PaginatedSection items={sideColonists} emptyMsg="None yet" headerLabel="Colony" headerColor="text-green-400/50"
                      renderItem={(c, i) => {
                        const medal = MEDALS[i] || null, isTop = i < 3;
                        return (
                          <div key={c.username || i} className="flex items-center gap-2 px-2 py-2 border-b border-white/5"
                            style={{ background: isTop ? `rgba(${i === 0 ? '255,200,0' : i === 1 ? '180,180,180' : '200,120,60'},0.06)` : 'transparent' }}>
                            <div className="w-5 text-center flex-shrink-0">{medal ? <span className="text-sm">{medal}</span> : <span className="text-[10px] font-black text-white/20">#{i + 1}</span>}</div>
                            <div className="flex-1 min-w-0"><p className={`font-black text-xs truncate ${isTop ? 'text-white' : 'text-white/60'}`}>{c.username}</p></div>
                            <p className={`font-black text-xs flex-shrink-0 ${isTop ? 'text-yellow-400' : 'text-yellow-400/50'}`}>{c.clout_points || 0}</p>
                          </div>
                        );
                      }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {holoFeature && !isMobile && <ZipHologram feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)} />}

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