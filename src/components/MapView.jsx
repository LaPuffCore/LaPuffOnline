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
const MAPTILER_KEY = 'get_your_own_OpIi9ZULNHzrESv6T2vL';
const REAL3D_SOURCE_URL = `https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`;

const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

// ── HEAT COLORS ───────────────────────────────────────────────────────────────
const HEAT_COLORS = {
  cold:   '#00eeff',
  cool:   '#00ff88',
  warm:   '#ccff00',
  orange: '#ff8800',
  hot:    '#ff1100',
};

// Tonal variants per tier (dark→mid→bright) for building color variation
const HEAT_TONES = {
  cold:   ['#006677', '#00aabb', '#00eeff'],
  cool:   ['#007740', '#00bb66', '#00ff88'],
  warm:   ['#667700', '#99bb00', '#ccff00'],
  orange: ['#773300', '#bb5500', '#ff8800'],
  hot:    ['#770800', '#cc1000', '#ff1100'],
};

function tierKey(tier) {
  if (tier >= 4) return 'hot';
  if (tier >= 3) return 'orange';
  if (tier >= 2) return 'warm';
  if (tier >= 1) return 'cool';
  return 'cold';
}
function tierColor(tier) { return HEAT_COLORS[tierKey(tier)]; }

const TIER_HEIGHTS = [30, 200, 700, 1600, 2800];
const CAP_THICKNESS = 4;

// Reusable MapLibre step expressions for _tier property
function tierStepExpr(values) {
  return ['step', ['get', '_tier'], values[0], 1, values[1], 2, values[2], 3, values[3], 4, values[4]];
}
const TIER_COLOR_EXPR = tierStepExpr([
  HEAT_COLORS.cold, HEAT_COLORS.cool, HEAT_COLORS.warm, HEAT_COLORS.orange, HEAT_COLORS.hot,
]);
const TIER_HEIGHT_EXPR = tierStepExpr(TIER_HEIGHTS);
const TIER_CAP_HEIGHT_EXPR = tierStepExpr(TIER_HEIGHTS.map(h => h + CAP_THICKNESS));

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
  const maxCount = Math.max(...Object.values(zipMap).map(a => a.length), 1);
  return { zipMap, maxCount };
}

function normalizeHeat(count, maxCount) {
  if (count === 0 || maxCount <= 1) return 0;
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
    const heat = normalizeHeat(zipMap[zip]?.length || 0, maxCount);
    if (heat >= 0.80) return 4;
    if (heat >= 0.55) return 3;
    if (heat >= 0.30) return 2;
    if (heat >= 0.05) return 1;
    return 0;
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
    sources: {
      sat: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, maxzoom: 19,
      },
    },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  };
}

const MEDALS = ['🥇', '🥈', '🥉'];

// ── ZIP HOLOGRAM (desktop full) ───────────────────────────────────────────────
function ZipHologram({ feature, color, onClose }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const allRings = feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat(1) : feature.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));
    const scale = Math.min(W * 0.7 / (maxX - minX), H * 0.7 / (maxY - minY));
    const offX = W / 2 - (minX + (maxX - minX) / 2) * scale;
    const offY = H / 2 + (minY + (maxY - minY) / 2) * scale;
    const project = (lng, lat) => [lng * scale + offX, -lat * scale + offY];

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
      const t = timeRef.current;
      const rotY = Math.sin(t) * 0.35;
      const glitch = Math.random() < 0.04;
      ctx.clearRect(0, 0, W, H);
      const depth = 18;
      for (let d = depth; d >= 0; d--)
        drawShape(Math.sin(rotY) * d * 1.8, -d * 0.7, 0.08 + (1 - d / depth) * 0.18, d > 0);
      const ts = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1;
      drawShape(ts, -depth * 0.7, 0.55, false);
      if (glitch) {
        for (let g = 0; g < Math.floor(Math.random() * 5) + 2; g++) {
          ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color;
          ctx.fillRect((Math.random() - 0.5) * 20, Math.random() * H, W, Math.random() * 6 + 2);
          ctx.restore();
        }
      }
      ctx.save(); ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2;
      ctx.shadowColor = color; ctx.shadowBlur = 20;
      drawShape(ts, -depth * 0.7, 0.9, true);
      ctx.restore();
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

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}>
      <div className="relative pointer-events-auto flex flex-col items-center" style={{ width: 480, maxWidth: '90vw' }}>
        <div className="flex items-center justify-between w-full mb-3 px-1">
          <div style={{ color, textShadow: `0 0 12px ${color}` }} className="font-black text-lg tracking-widest uppercase">
            ZIP {feature?.properties?.MODZCTA} — ISOLATED
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full border-2 font-black text-sm flex items-center justify-center hover:bg-white/20 transition-all"
            style={{ borderColor: color, color }}>✕</button>
        </div>
        <canvas ref={canvasRef} width={460} height={360} style={{
          width: '100%', height: 360, borderRadius: 18,
          border: `2px solid ${color}`,
          boxShadow: `0 0 40px ${color}66, 0 0 80px ${color}33`,
          background: '#000000cc',
        }} />
        <div className="absolute pointer-events-none" style={{
          top: 44, left: 0, right: 0, height: 360,
          background: 'repeating-linear-gradient(transparent, transparent 3px, rgba(0,0,0,0.25) 3px, rgba(0,0,0,0.25) 4px)',
          borderRadius: 18,
        }} />
        <div className="mt-3 text-xs font-black tracking-widest opacity-50 uppercase" style={{ color }}>
          ◈ Holographic Extrusion Mode ◈
        </div>
      </div>
    </div>
  );
}

// ── ZIP HOLOGRAM (mobile mini strip) ─────────────────────────────────────────
function ZipHologramMini({ feature, color }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const allRings = feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat(1) : feature.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));
    const scale = Math.min(W * 0.65 / (maxX - minX), H * 0.65 / (maxY - minY));
    const offX = W / 2 - (minX + (maxX - minX) / 2) * scale;
    const offY = H / 2 + (minY + (maxY - minY) / 2) * scale;
    const project = (lng, lat) => [lng * scale + offX, -lat * scale + offY];

    function drawShape(dx, dy, alpha, strokeOnly) {
      ctx.save(); ctx.translate(dx, dy);
      allRings.forEach(ring => {
        ctx.beginPath();
        ring.forEach(([x, y], i) => { const [px, py] = project(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        ctx.closePath();
        if (!strokeOnly) { ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0'); ctx.fill(); }
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = alpha; ctx.stroke();
      });
      ctx.restore();
    }

    function frame() {
      timeRef.current += 0.02;
      const t = timeRef.current;
      ctx.clearRect(0, 0, W, H);
      const depth = 8;
      for (let d = depth; d >= 0; d--)
        drawShape(Math.sin(t * 0.8) * d * 1.2, -d * 0.5, 0.06 + (1 - d / depth) * 0.15, d > 0);
      const ts = Math.sin(t * 0.8) * depth * 1.2;
      ctx.globalAlpha = 1;
      drawShape(ts, -depth * 0.5, 0.45, false);
      ctx.save(); ctx.globalAlpha = 0.8; ctx.shadowColor = color; ctx.shadowBlur = 10;
      drawShape(ts, -depth * 0.5, 0.85, true);
      ctx.restore();
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color]);

  return (
    <canvas ref={canvasRef} width={64} height={52}
      style={{ borderRadius: 8, border: `1.5px solid ${color}55`, background: '#00000066', flexShrink: 0 }} />
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function MapView({ events }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);
  const locationMarkerRef = useRef(null);
  const geoDataRef = useRef(null);
  const tiersRef = useRef([]);
  const pendingLayerRestoreRef = useRef(false);

  const [timespanIdx, setTimespanIdx] = useState(4);
  const [heatmap, setHeatmap] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [threeD, setThreeD] = useState(false);
  const [real3D, setReal3D] = useState(false);
  const [geoData, setGeoData] = useState(null);
  const [adjacency, setAdjacency] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [hoveredZip, setHoveredZip] = useState(null);
  const [hoveredEvents, setHoveredEvents] = useState([]);
  const [hoveredColonists, setHoveredColonists] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);
  const [sideZip, setSideZip] = useState(null);
  const [sideEvents, setSideEvents] = useState([]);
  const [sideColonists, setSideColonists] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [userLocation, setUserLocation] = useState(getLastLocation());
  const [notInNYC, setNotInNYC] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [holoFeature, setHoloFeature] = useState(null);
  const [holoColor, setHoloColor] = useState(HEAT_COLORS.cold);

  geoDataRef.current = geoData;

  // Keep refs to current toggle state for callbacks inside addLayers
  const heatmapRef = useRef(heatmap);
  heatmapRef.current = heatmap;

  // ── GeoJSON ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(GEOJSON_URL).then(r => r.json()).then(data => {
      const features = data.features.map((f, i) => {
        let zip = String(f.properties.MODZCTA || f.properties.modzcta || '');
        if (isSpecialZip(zip))
          f = { ...f, properties: { ...f.properties, MODZCTA: 'SAFEZONE', _special: true } };
        return { ...f, id: i };
      });
      const fixed = { ...data, features };
      setGeoData(fixed);
      setAdjacency(buildAdjacency(features));
    });
  }, []);

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: darkMapStyle(),
      center: [-73.94, 40.71],
      zoom: 10.5, minZoom: 9, maxZoom: 16,
      maxBounds: [[-75.5, 40.0], [-72.5, 41.5]],
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;
    map.on('load', () => setMapReady(true));
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Add ZCTA layers ────────────────────────────────────────────────────────
  function addLayers(map, data, sat) {
    if (!map || !data || map.getSource('zcta')) return;
    map.addSource('zcta', { type: 'geojson', data, generateId: false });

    // Flat fill
    map.addLayer({
      id: 'zcta-fill', type: 'fill', source: 'zcta',
      paint: {
        'fill-color': ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505'],
        'fill-opacity': sat ? 0.45 : 0.72,
      },
    });

    // Hover
    map.addLayer({
      id: 'zcta-hover', type: 'fill', source: 'zcta',
      paint: {
        'fill-color': '#7C3AED',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], 0.5, 0],
      },
    });

    // Extrusion (zip-block 3D)
    map.addLayer({
      id: 'zcta-extrude', type: 'fill-extrusion', source: 'zcta',
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['get', '_special'], false], '#222222', '#1a0505'],
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0,
      },
    });

    // Cap shell — thin extrusion sitting on TOP of each zip block.
    // This gives us the "vertically displaced outline" effect:
    // the cap is a 4-unit-tall bright red shell from height to height+4,
    // so the zip boundary appears as a glowing ring at the top surface.
    map.addLayer({
      id: 'zcta-cap', type: 'fill-extrusion', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        'fill-extrusion-color': '#ff2200',
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0,
      },
    });

    // Safe zone outline
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': 2, 'line-opacity': 1 },
    });

    // Ground boundary glow layers (hidden when 3D extrusions are up)
    map.addLayer({
      id: 'zcta-line-glow2', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff0000', 'line-width': 8, 'line-opacity': sat ? 0.25 : 0.35, 'line-blur': 10 },
    });
    map.addLayer({
      id: 'zcta-line-glow', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff1100', 'line-width': 3, 'line-opacity': sat ? 0.55 : 0.75, 'line-blur': 3 },
    });
    map.addLayer({
      id: 'zcta-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff2200', 'line-width': 1.5, 'line-opacity': 1 },
    });

    // Mouse events
    map.on('mousemove', 'zcta-fill', e => {
      if (!e.features.length) return;
      const f = e.features[0];
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== f.id)
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
      hoveredIdRef.current = f.id;
      map.setFeatureState({ source: 'zcta', id: f.id }, { hovered: true });
      map.getCanvas().style.cursor = 'pointer';
      setHoveredZip(String(f.properties.MODZCTA || ''));
      setTooltipPos({ x: e.point.x, y: e.point.y });
    });
    map.on('mouseleave', 'zcta-fill', () => {
      if (hoveredIdRef.current !== null) {
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
        hoveredIdRef.current = null;
      }
      map.getCanvas().style.cursor = '';
      setHoveredZip(null); setTooltipPos(null);
    });
    map.on('click', 'zcta-fill', e => {
      if (!e.features.length) return;
      const zip = String(e.features[0].properties.MODZCTA || '');
      openSidePanel(zip);
      openHologram(e.features[0]);
    });
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

  // ── Heatmap + 3D update ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData || !map.getLayer('zcta-fill')) return;

    const { zipMap, maxCount } = buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days);
    const tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
    tiersRef.current = tiers;

    const withHeat = {
      ...geoData,
      features: geoData.features.map((f, i) => ({
        ...f,
        properties: {
          ...f.properties,
          _heat: f.properties._special ? 0 : normalizeHeat(zipMap[String(f.properties.MODZCTA || '')]?.length || 0, maxCount),
          _tier: tiers[i] < 0 ? 0 : tiers[i],
        },
      })),
    };
    if (map.getSource('zcta')) map.getSource('zcta').setData(withHeat);

    // active3D = standard zip-block extrusions (not real3D)
    const active3D = threeD && !real3D;

    if (heatmap) {
      map.setPaintProperty('zcta-fill', 'fill-color', [
        'case', ['boolean', ['get', '_special'], false], '#ffffff', TIER_COLOR_EXPR,
      ]);
      map.setPaintProperty('zcta-fill', 'fill-opacity', active3D ? 0 : satellite ? 0.55 : 0.72);

      if (active3D) {
        // Extrusion: tier color + tier height
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', [
          'case', ['boolean', ['get', '_special'], false], '#111111', TIER_COLOR_EXPR,
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', [
          'case', ['boolean', ['get', '_special'], false], 30, TIER_HEIGHT_EXPR,
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 1.0);

        // Cap: bright red shell on top of each extrusion block
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', [
          'case', ['boolean', ['get', '_special'], false], 30 + CAP_THICKNESS, TIER_CAP_HEIGHT_EXPR,
        ]);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', [
          'case', ['boolean', ['get', '_special'], false], 30, TIER_HEIGHT_EXPR,
        ]);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', 0.9);

        // Ground lines off — cap handles top boundaries
        map.setPaintProperty('zcta-line', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', 0);
        map.setPaintProperty('zcta-line', 'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', satellite ? 0.25 : 0.35);
      }
    } else {
      // No heatmap
      map.setPaintProperty('zcta-fill', 'fill-color', [
        'case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505',
      ]);
      map.setPaintProperty('zcta-fill', 'fill-opacity', active3D ? 0 : satellite ? 0.45 : 0.72);

      if (active3D) {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', [
          'case', ['boolean', ['get', '_special'], false], '#111111', '#3a0505',
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', [
          'case', ['boolean', ['get', '_special'], false], 30, 400,
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', satellite ? 0.75 : 0.9);

        // Cap at uniform height (no heatmap, all zips same height)
        map.setPaintProperty('zcta-cap', 'fill-extrusion-height', [
          'case', ['boolean', ['get', '_special'], false], 30 + CAP_THICKNESS, 400 + CAP_THICKNESS,
        ]);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-base', [
          'case', ['boolean', ['get', '_special'], false], 30, 400,
        ]);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', 0.9);

        map.setPaintProperty('zcta-line', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-cap', 'fill-extrusion-opacity', 0);
        map.setPaintProperty('zcta-line', 'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', satellite ? 0.25 : 0.35);
      }
    }

    // Sync real3d colors if active
    if (real3D && map.getLayer('real3d-buildings')) {
      applyReal3DColors(map, heatmap);
    }
  }, [heatmap, threeD, real3D, timespanIdx, events, geoData, mapReady, satellite, adjacency]);

  // ── Pitch / bearing ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const use3D = threeD || real3D;
    map.easeTo({ pitch: use3D ? 48 : 0, bearing: use3D ? -17 : 0, duration: 700 });
  }, [threeD, real3D, mapReady]);

  // ── 3D and Real3D are mutually exclusive ───────────────────────────────────
  const prevThreeD = useRef(false);
  const prevReal3D = useRef(false);
  useEffect(() => {
    if (threeD && !prevThreeD.current && real3D) setReal3D(false);
    prevThreeD.current = threeD;
  }, [threeD]);
  useEffect(() => {
    if (real3D && !prevReal3D.current && threeD) setThreeD(false);
    prevReal3D.current = real3D;
  }, [real3D]);

  // ── Satellite: additive, preserves all other toggles ──────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    pendingLayerRestoreRef.current = true;
    map.setStyle(satellite ? satelliteMapStyle() : darkMapStyle());
    map.once('styledata', () => {
      if (!pendingLayerRestoreRef.current) return;
      pendingLayerRestoreRef.current = false;
      if (!geoData || map.getSource('zcta')) return;
      addLayers(map, geoData, satellite);
      if (real3D) addReal3DLayers(map, heatmapRef.current);
    });
  }, [satellite]);

  // ── Real3D: add OSM/MapTiler building extrusions ──────────────────────────
  function applyReal3DColors(map, isHeatmap) {
    if (!map.getLayer('real3d-buildings')) return;
    if (isHeatmap) {
      // Tonal gradient: short buildings cold, tall buildings hot
      map.setPaintProperty('real3d-buildings', 'fill-extrusion-color', [
        'interpolate', ['linear'], ['get', 'render_height'],
        0,   HEAT_TONES.cold[0],  5,   HEAT_TONES.cold[1],  15,  HEAT_TONES.cold[2],
        25,  HEAT_TONES.cool[0],  40,  HEAT_TONES.cool[1],  60,  HEAT_TONES.cool[2],
        80,  HEAT_TONES.warm[0],  110, HEAT_TONES.warm[1],  150, HEAT_TONES.warm[2],
        200, HEAT_TONES.orange[0],280, HEAT_TONES.orange[1],350, HEAT_TONES.orange[2],
        450, HEAT_TONES.hot[0],   600, HEAT_TONES.hot[1],   900, HEAT_TONES.hot[2],
      ]);
    } else {
      map.setPaintProperty('real3d-buildings', 'fill-extrusion-color', '#1a0505');
    }
  }

  function addReal3DLayers(map, isHeatmap) {
    ['real3d-buildings', 'real3d-cap', 'real3d-zcta-outline'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('openmaptiles')) map.removeSource('openmaptiles');

    try {
      // Browser's HTTP cache will cache tile responses on subsequent loads
      // for the same device — MapTiler tiles include Cache-Control headers.
      map.addSource('openmaptiles', {
        type: 'vector',
        url: REAL3D_SOURCE_URL,
      });

      // Real buildings — fully opaque, no see-through
      map.addLayer({
        id: 'real3d-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': '#1a0505',
          'fill-extrusion-height': ['get', 'render_height'],
          'fill-extrusion-base': ['get', 'render_min_height'],
          'fill-extrusion-opacity': 1.0,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      // Cap ring on TOP of each building — same shell trick as zip-block cap
      map.addLayer({
        id: 'real3d-cap',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': '#ff2200',
          'fill-extrusion-height': ['+', ['get', 'render_height'], 2],
          'fill-extrusion-base': ['get', 'render_height'],
          'fill-extrusion-opacity': 0.7,
        },
      });

      // Zip code outlines drawn on top of buildings — prominent at higher zoom
      if (map.getSource('zcta')) {
        map.addLayer({
          id: 'real3d-zcta-outline',
          type: 'line',
          source: 'zcta',
          filter: ['!=', ['get', '_special'], true],
          paint: {
            'line-color': '#ff2200',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 13, 3, 15, 5],
            'line-opacity': 0.9,
            'line-blur': 1,
          },
        });
      }

      applyReal3DColors(map, isHeatmap);
    } catch (err) {
      console.warn('Real3D buildings failed to load:', err);
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    ['real3d-buildings', 'real3d-cap', 'real3d-zcta-outline'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('openmaptiles')) map.removeSource('openmaptiles');
    if (!real3D) return;
    addReal3DLayers(map, heatmapRef.current);
  }, [real3D, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !real3D) return;
    applyReal3DColors(map, heatmap);
  }, [heatmap, real3D, mapReady]);

  // ── Location orb ───────────────────────────────────────────────────────────
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
    locationMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([userLocation.lng, userLocation.lat]).addTo(map);
  }, [userLocation, mapReady]);

  // ── Hover info ─────────────────────────────────────────────────────────────
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
    const h = e => {
      if (e.key === 'Escape') {
        setHoloFeature(null);
        setSideZip(null); setSideEvents([]); setSideColonists([]);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const zipLabel = hoveredZip === 'SAFEZONE' ? 'Safe Zone' : hoveredZip ? `ZIP ${hoveredZip}` : '';
  const sideLabel = sideZip === 'SAFEZONE' ? 'Safe Zone' : sideZip ? `ZIP ${sideZip}` : '';

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#0d0000' }}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 2 }} />

      {/*
        CRT Effect — pass a prop to tell it to limit intensity on mobile.
        The CRTEffect component should check the `limitMobile` prop and either
        reduce opacity or scope its overlay to pointer-events-none within the
        map container div only (not above controls/panels).
        If you need to edit CRTEffect itself, scope its container to
        `style={{ zIndex: 3, pointerEvents: 'none' }}` and on mobile set
        `opacity: 0.35` instead of the full effect.
      */}
      <CRTEffect active={entered} limitMobile />

      {!entered && <MapIntro onEnter={() => setEntered(true)} />}

      {entered && (
        <>
          {/* ── Controls ── */}
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
              <button onClick={() => setThreeD(v => !v)}
                className={`px-4 py-2 rounded-2xl font-black text-sm border-2 transition-all ${threeD ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-black/70 border-white/30 text-white hover:border-emerald-400'}`}>
                🏙️ 3D
              </button>
              <button onClick={() => setReal3D(v => !v)}
                className={`px-4 py-2 rounded-2xl font-black text-sm border-2 transition-all ${real3D ? 'bg-amber-600 border-amber-400 text-white' : 'bg-black/70 border-white/30 text-white hover:border-amber-400'}`}>
                🏛️ Real3D
              </button>
            </div>
          </div>

          <button onClick={handleCenterLocation} disabled={locLoading}
            className="absolute bottom-24 right-4 z-30 w-11 h-11 bg-black/80 border border-white/30 rounded-xl flex items-center justify-center hover:bg-[#7C3AED]/80 hover:border-[#7C3AED] transition-all shadow-lg">
            {locLoading
              ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
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
                  {hoveredZip !== 'SAFEZONE'
                    ? <p className="text-white/60 text-xs">{hoveredEvents.length} upcoming events</p>
                    : <p className="text-white/40 text-xs italic">Safe zone — events only</p>}
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
          {sideZip && (
            <div className="absolute right-0 top-0 bottom-0 z-30 hidden md:flex flex-col bg-gray-950/97 border-l border-red-900/40 overflow-hidden"
              style={{ width: 400, backdropFilter: 'blur(12px)' }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-gray-950/80 flex-shrink-0">
                <div>
                  <p className="text-red-400 font-black">{sideLabel}</p>
                  <p className="text-white/40 text-xs">
                    {sideZip === 'SAFEZONE' ? 'Safe zone — no colonists' : `${sideEvents.length} events · ${sideColonists.length} colonists`}
                  </p>
                </div>
                <button onClick={() => { setSideZip(null); setSideEvents([]); setSideColonists([]); }}
                  className="text-white/40 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto border-b border-white/10" style={{ maxHeight: '50%' }}>
                <p className="px-4 py-2 text-xs font-black text-white/30 uppercase tracking-widest sticky top-0 bg-gray-950">Events</p>
                {sideEvents.length === 0
                  ? <p className="px-4 py-6 text-white/20 text-sm text-center">No upcoming events</p>
                  : sideEvents.map(event => (
                    <div key={event.id} onClick={() => setSelectedEvent(event)}
                      className="flex items-start gap-3 p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                      style={{ borderLeftColor: event.hex_color || '#7C3AED', borderLeftWidth: 3 }}>
                      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl"
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
                  ))}
              </div>

              {sideZip !== 'SAFEZONE' && (
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: '50%' }}>
                  <p className="px-4 py-2 text-xs font-black text-green-400/50 uppercase tracking-widest sticky top-0 bg-gray-950">Colony Leaderboard</p>
                  {sideColonists.length === 0
                    ? <p className="px-4 py-6 text-white/15 text-sm text-center">No colonists yet</p>
                    : sideColonists.map((c, i) => {
                      const medal = MEDALS[i] || null; const isTop = i < 3;
                      return (
                        <div key={c.username || i}
                          className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 hover:bg-white/5"
                          style={{ background: isTop ? `rgba(${i === 0 ? '255,200,0' : i === 1 ? '180,180,180' : '200,120,60'},0.06)` : 'transparent' }}>
                          <div className="w-7 text-center flex-shrink-0">
                            {medal ? <span className="text-lg leading-none">{medal}</span> : <span className="text-xs font-black text-white/20">#{i + 1}</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-black text-sm truncate ${isTop ? 'text-white' : 'text-white/60'}`}>{c.username}</p>
                            {c.updated_at && <p className="text-white/20 text-xs">since {new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`font-black text-sm ${isTop ? 'text-yellow-400' : 'text-yellow-400/50'}`}
                              style={isTop ? { textShadow: '0 0 8px rgba(250,204,21,0.5)' } : {}}>
                              {c.clout_points || 0}
                            </p>
                            <p className="text-white/20 text-xs">clout</p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* ── MOBILE bottom sheet — hologram strip + split events/colonists ── */}
          {sideZip && (
            <div className="md:hidden absolute bottom-0 left-0 right-0 z-40 flex flex-col"
              style={{
                height: '62vh',
                background: 'rgba(5,0,10,0.97)',
                backdropFilter: 'blur(16px)',
                borderTop: '2px solid rgba(255,34,0,0.4)',
              }}>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 flex-shrink-0">
                <div>
                  <p className="text-red-400 font-black text-sm">{sideLabel}</p>
                  <p className="text-white/40 text-xs">{sideEvents.length} events · {sideColonists.length} colonists</p>
                </div>
                <button onClick={() => { setSideZip(null); setSideEvents([]); setSideColonists([]); setHoloFeature(null); }}
                  className="text-white/40 hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">✕</button>
              </div>

              {/* Mini hologram strip */}
              {holoFeature && (
                <div className="flex-shrink-0 flex items-center gap-3 px-3 py-2 border-b border-white/10" style={{ background: 'rgba(0,0,0,0.5)' }}>
                  <ZipHologramMini feature={holoFeature} color={holoColor} />
                  <div style={{ color: holoColor, textShadow: `0 0 8px ${holoColor}` }} className="font-black text-xs tracking-widest uppercase opacity-80">
                    ◈ ZIP {holoFeature?.properties?.MODZCTA} — HOLOGRAM
                  </div>
                </div>
              )}

              {/* Split pane: Events (left) | Colony (right) */}
              <div className="flex flex-1 overflow-hidden">
                {/* Events */}
                <div className="flex-1 overflow-y-auto border-r border-white/10">
                  <p className="px-3 py-1.5 text-[10px] font-black text-white/30 uppercase tracking-widest sticky top-0 bg-gray-950/95">Events</p>
                  {sideEvents.length === 0
                    ? <p className="px-3 py-4 text-white/20 text-xs text-center">None</p>
                    : sideEvents.map(event => (
                      <div key={event.id} onClick={() => setSelectedEvent(event)}
                        className="flex items-start gap-2 px-2 py-2 border-b border-white/5 cursor-pointer active:bg-white/5"
                        style={{ borderLeftColor: event.hex_color || '#7C3AED', borderLeftWidth: 2 }}>
                        <div className="w-8 h-8 rounded-lg flex-shrink-0 overflow-hidden flex items-center justify-center text-sm"
                          style={{ background: (event.hex_color || '#7C3AED') + '33', border: `1.5px solid ${event.hex_color || '#7C3AED'}` }}>
                          {event.photos?.[0]
                            ? <img src={event.photos[0]} className="w-full h-full object-cover" alt="" onError={e => { e.target.style.display = 'none'; }} />
                            : event.representative_emoji || '🎉'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-black text-xs truncate leading-tight">{event.event_name}</p>
                          <p className="text-white/40 text-[10px]">{event.event_date}</p>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Colony */}
                {sideZip !== 'SAFEZONE' && (
                  <div className="flex-1 overflow-y-auto">
                    <p className="px-3 py-1.5 text-[10px] font-black text-green-400/50 uppercase tracking-widest sticky top-0 bg-gray-950/95">Colony</p>
                    {sideColonists.length === 0
                      ? <p className="px-3 py-4 text-white/15 text-xs text-center">None yet</p>
                      : sideColonists.map((c, i) => {
                        const medal = MEDALS[i] || null; const isTop = i < 3;
                        return (
                          <div key={c.username || i}
                            className="flex items-center gap-2 px-2 py-2 border-b border-white/5"
                            style={{ background: isTop ? `rgba(${i === 0 ? '255,200,0' : i === 1 ? '180,180,180' : '200,120,60'},0.06)` : 'transparent' }}>
                            <div className="w-5 text-center flex-shrink-0">
                              {medal ? <span className="text-sm leading-none">{medal}</span> : <span className="text-[10px] font-black text-white/20">#{i + 1}</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`font-black text-xs truncate ${isTop ? 'text-white' : 'text-white/60'}`}>{c.username}</p>
                            </div>
                            <p className={`font-black text-xs flex-shrink-0 ${isTop ? 'text-yellow-400' : 'text-yellow-400/50'}`}>
                              {c.clout_points || 0}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Desktop hologram overlay — only on desktop */}
          {holoFeature && (
            <div className="hidden md:block">
              <ZipHologram feature={holoFeature} color={holoColor} onClose={() => setHoloFeature(null)} />
            </div>
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