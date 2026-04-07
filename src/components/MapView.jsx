import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { generateAutoTags } from '../lib/autoTags';
import EventDetailPopup from './EventDetailPopup';
import MapIntro from './MapIntro';
import CRTEffect from './CRTEffect';
import { getZipColonists } from '../lib/pointsSystem';
import { pingNYCLocation, getLastLocation } from '../lib/locationService';

const GEOJSON_URL = './data/MODZCTA_2010_WGS1984.geo.json';
const MAPTILER_KEY = 'VjoJJ0mSCXFo9kFGYGxJ';

const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

// --- HEAT COLORS ---
const HEAT_COLORS = {
  cold:   '#00eeff',
  cool:   '#00ff88',
  warm:   '#ccff00',
  orange: '#ff8800',
  hot:    '#ff1100',
};

function tierColor(tier) {
  if (tier >= 4) return HEAT_COLORS.hot;
  if (tier >= 3) return HEAT_COLORS.orange;
  if (tier >= 2) return HEAT_COLORS.warm;
  if (tier >= 1) return HEAT_COLORS.cool;
  return HEAT_COLORS.cold;
}

function tierHeight(tier) {
  if (tier >= 4) return 2800;
  if (tier >= 3) return 1600;
  if (tier >= 2) return 700;
  if (tier >= 1) return 200;
  return 30;
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
  // FIX #5: Always compute maxCount relative to this timeframe only.
  // If only 1 event exists in the whole timeframe, that 1 event = max (red).
  const counts = Object.values(zipMap).map(a => a.length);
  const maxCount = counts.length > 0 ? Math.max(...counts) : 1;
  return { zipMap, maxCount };
}

function normalizeHeat(count, maxCount) {
  if (count === 0) return 0;
  if (maxCount <= 1) return 1; // FIX #5: single event in frame = full heat
  return Math.log(count + 1) / Math.log(maxCount + 1);
}

function buildAdjacency(features) {
  const bboxes = features.map(f => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rings = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat(1) : f.geometry.coordinates;
    rings.forEach(ring => ring.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }));
    return { minX, minY, maxX, maxY };
  });
  return features.map((_, i) => {
    const neighbors = [];
    const buf = 0.008;
    const a = bboxes[i];
    for (let j = 0; j < features.length; j++) {
      if (j === i) continue;
      const b = bboxes[j];
      if (a.maxX + buf >= b.minX && b.maxX + buf >= a.minX && a.maxY + buf >= b.minY && b.maxY + buf >= a.minY) neighbors.push(j);
    }
    return neighbors;
  });
}

// FIX #5: computeTiers now correctly scales relative to the timeframe's own maxCount.
// Adjacency diffusion applies regardless of how sparse events are.
function computeTiers(features, zipMap, maxCount, adjacency) {
  const rawTiers = features.map(f => {
    if (f.properties._special) return -1;
    const zip = String(f.properties.MODZCTA || '');
    const count = zipMap[zip]?.length || 0;
    const heat = normalizeHeat(count, maxCount);
    // FIX #5: if there are any events in this timeframe, ensure non-zero zips get at least tier 1
    if (count === 0) return 0;
    if (heat >= 0.80) return 4;
    if (heat >= 0.55) return 3;
    if (heat >= 0.30) return 2;
    if (heat >= 0.05) return 1;
    return 1; // any event in the timeframe = at least cool
  });

  const tiers = [...rawTiers];
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < features.length; i++) {
      if (tiers[i] < 0) continue;
      const neighbors = adjacency[i] || [];
      neighbors.forEach(j => {
        if (tiers[j] < 0) return;
        const diffusedTier = tiers[i] - 1;
        if (diffusedTier > tiers[j]) tiers[j] = diffusedTier;
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
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d0000' } }]
  };
}

function satelliteMapStyle() {
  return {
    version: 8,
    sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 } },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }]
  };
}

const MEDALS = ['🥇', '🥈', '🥉'];

// ----- ZIP HOLOGRAM OVERLAY -----
function ZipHologram({ feature, color, onClose }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const allRings = feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat(1)
      : feature.geometry.coordinates;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));

    const geoW = maxX - minX;
    const geoH = maxY - minY;
    const padding = 0.15;
    const scale = Math.min(W * (1 - padding * 2) / geoW, H * (1 - padding * 2) / geoH);
    const offX = W / 2 - (minX + geoW / 2) * scale;
    const offY = H / 2 + (minY + geoH / 2) * scale;

    function project(lng, lat) {
      return [lng * scale + offX, -lat * scale + offY];
    }

    function drawShape(ctx, dx, dy, alpha, strokeOnly) {
      ctx.save();
      ctx.translate(dx, dy);
      allRings.forEach(ring => {
        ctx.beginPath();
        ring.forEach(([x, y], i) => {
          const [px, py] = project(x, y);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        if (!strokeOnly) {
          ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeOnly ? 1.5 : 2;
        ctx.globalAlpha = alpha;
        ctx.stroke();
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
      for (let d = depth; d >= 0; d--) {
        const alpha = 0.08 + (1 - d / depth) * 0.18;
        const shiftX = Math.sin(rotY) * d * 1.8;
        const shiftY = -d * 0.7;
        drawShape(ctx, shiftX, shiftY, alpha, d > 0);
      }

      const topShift = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1;
      drawShape(ctx, topShift, -depth * 0.7, 0.55, false);

      if (glitch) {
        const numLines = Math.floor(Math.random() * 5) + 2;
        for (let g = 0; g < numLines; g++) {
          const gy = Math.random() * H;
          const gh = Math.random() * 6 + 2;
          const gx = (Math.random() - 0.5) * 20;
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = color;
          ctx.fillRect(gx, gy, W, gh);
          ctx.restore();
        }
      }

      ctx.save();
      ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      drawShape(ctx, topShift, -depth * 0.7, 0.9, true);
      ctx.restore();

      if (Math.sin(t * 7) > 0.92) {
        ctx.fillStyle = color + '22';
        ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const zipLabel = feature?.properties?.MODZCTA;

  // FIX #2: Hologram is NOT fullscreen overlay — it's a floating panel that coexists
  // with the side panel. On mobile it lives in the top half only.
  return (
    <div
      className="absolute z-40 pointer-events-none"
      style={{
        // Desktop: float left of side panel, centered vertically
        left: 0,
        right: 400, // leave room for side panel (400px wide)
        top: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Subtle ambient darkening — NOT a full black overlay */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} />

      <div className="relative pointer-events-auto flex flex-col items-center" style={{ width: 480, maxWidth: '90%', zIndex: 1 }}>
        <div className="flex items-center justify-between w-full mb-3 px-1">
          <div style={{ color, textShadow: `0 0 12px ${color}` }} className="font-black text-lg tracking-widest uppercase">
            ZIP {zipLabel} — ISOLATED
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full border-2 font-black text-sm flex items-center justify-center hover:bg-white/20 transition-all"
            style={{ borderColor: color, color }}
          >✕</button>
        </div>

        <canvas
          ref={canvasRef}
          width={460}
          height={340}
          style={{
            width: '100%',
            height: 340,
            borderRadius: 18,
            border: `2px solid ${color}`,
            boxShadow: `0 0 40px ${color}66, 0 0 80px ${color}33`,
            background: '#000000cc',
          }}
        />

        <div
          className="absolute pointer-events-none"
          style={{
            top: 44, left: 0, right: 0, height: 340,
            background: 'repeating-linear-gradient(transparent, transparent 3px, rgba(0,0,0,0.25) 3px, rgba(0,0,0,0.25) 4px)',
            borderRadius: 18,
          }}
        />

        <div className="mt-3 text-xs font-black tracking-widest opacity-50 uppercase" style={{ color }}>
          ◈ Holographic Extrusion Mode ◈
        </div>
      </div>
    </div>
  );
}

// FIX #2: Mobile hologram — top half only, side info panel in bottom half
function ZipHologramMobile({ feature, color, onClose }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !feature) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const allRings = feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat(1)
      : feature.geometry.coordinates;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allRings.forEach(ring => ring.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));

    const geoW = maxX - minX;
    const geoH = maxY - minY;
    const padding = 0.15;
    const scale = Math.min(W * (1 - padding * 2) / geoW, H * (1 - padding * 2) / geoH);
    const offX = W / 2 - (minX + geoW / 2) * scale;
    const offY = H / 2 + (minY + geoH / 2) * scale;

    function project(lng, lat) { return [lng * scale + offX, -lat * scale + offY]; }

    function drawShape(ctx, dx, dy, alpha, strokeOnly) {
      ctx.save();
      ctx.translate(dx, dy);
      allRings.forEach(ring => {
        ctx.beginPath();
        ring.forEach(([x, y], i) => {
          const [px, py] = project(x, y);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        if (!strokeOnly) {
          ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeOnly ? 1.5 : 2;
        ctx.globalAlpha = alpha;
        ctx.stroke();
      });
      ctx.restore();
    }

    function frame() {
      timeRef.current += 0.018;
      const t = timeRef.current;
      const rotY = Math.sin(t) * 0.35;
      const glitch = Math.random() < 0.04;
      ctx.clearRect(0, 0, W, H);
      const depth = 14;
      for (let d = depth; d >= 0; d--) {
        const alpha = 0.08 + (1 - d / depth) * 0.18;
        drawShape(ctx, Math.sin(rotY) * d * 1.8, -d * 0.7, alpha, d > 0);
      }
      const topShift = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1;
      drawShape(ctx, topShift, -depth * 0.7, 0.55, false);
      if (glitch) {
        for (let g = 0; g < 3; g++) {
          ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = color;
          ctx.fillRect((Math.random() - 0.5) * 20, Math.random() * H, W, Math.random() * 6 + 2);
          ctx.restore();
        }
      }
      ctx.save();
      ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2;
      ctx.shadowColor = color; ctx.shadowBlur = 20;
      drawShape(ctx, topShift, -depth * 0.7, 0.9, true);
      ctx.restore();
      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color]);

  const zipLabel = feature?.properties?.MODZCTA;

  return (
    <div className="absolute inset-x-0 top-0 z-40 flex flex-col" style={{ height: '50%', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
        <div style={{ color, textShadow: `0 0 12px ${color}` }} className="font-black text-sm tracking-widest uppercase">
          ZIP {zipLabel} — ISOLATED
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full border font-black text-xs flex items-center justify-center hover:bg-white/20"
          style={{ borderColor: color, color }}>✕</button>
      </div>
      <canvas ref={canvasRef} width={400} height={200}
        style={{ width: '100%', flex: 1, borderTop: `1px solid ${color}44`, background: '#000000bb' }} />
    </div>
  );
}

export default function MapView({ events }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);
  const locationMarkerRef = useRef(null);
  // FIX #6: Track heatmap and 3D state in refs that are always current
  const heatmapRef = useRef(false);
  const threeDRef = useRef(false);
  const real3DSourceLoadedRef = useRef(false); // FIX: prevent re-adding source on every real3D toggle

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
  const [isMobile, setIsMobile] = useState(false);

  // Keep refs in sync
  heatmapRef.current = heatmap;
  threeDRef.current = threeD;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Fetch GeoJSON
  useEffect(() => {
    fetch(GEOJSON_URL).then(r => r.json()).then(data => {
      const features = data.features.map((f, i) => {
        let zip = String(f.properties.MODZCTA || f.properties.modzcta || '');
        if (isSpecialZip(zip)) {
          f = { ...f, properties: { ...f.properties, MODZCTA: 'SAFEZONE', _special: true } };
        }
        return { ...f, id: i };
      });
      const fixed = { ...data, features };
      setGeoData(fixed);
      setAdjacency(buildAdjacency(features));
    });
  }, []);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
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
    map.on('load', () => setMapReady(true));
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  function addLayers(map, data, sat) {
    if (!map || !data || map.getSource('zcta')) return;
    map.addSource('zcta', { type: 'geojson', data, generateId: false });

    // FIX #1 & #4: Extrusion layer — solid, always opaque so it blocks outlines beneath it
    map.addLayer({
      id: 'zcta-extrude', type: 'fill-extrusion', source: 'zcta',
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['get', '_special'], false], '#222222', '#1a0505'],
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0, // always fully opaque to block see-through
      },
    });

    // Flat fill (heatmap colors, semi-transparent for satellite)
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

    // Safe zone outline
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': 2, 'line-opacity': 1 },
    });

    // FIX #1: Boundary lines for non-special zones at BASE level (z=0, used when 3D off)
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

    // FIX #1: Top-of-extrusion outline lines — rendered with fill-extrusion-translate
    // We use a SECOND extrusion layer that is paper-thin (height = base + 1) and only
    // draws the outline color — this sits on TOP of the solid extrusion block.
    // This is done via a line layer with line-translate-anchor: 'map' cannot do z-offset,
    // so instead we render a top cap extrusion layer that is just the outline color thinly.
    // The correct approach in MapLibre for "outline on top of extrusion" is to use
    // fill-extrusion for the cap with opacity and small delta height added.
    map.addLayer({
      id: 'zcta-extrude-cap', type: 'fill-extrusion', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        // Cap sits 1 unit above the top of the main extrusion
        'fill-extrusion-color': '#ff2200',
        'fill-extrusion-height': 0,  // will be set = main height when 3D on
        'fill-extrusion-base': 0,    // will be set = main height - 1 when 3D on
        'fill-extrusion-opacity': 0, // hidden by default
      },
    });

    // Hover events
    map.on('mousemove', 'zcta-fill', e => {
      if (!e.features.length) return;
      const f = e.features[0];
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== f.id)
        map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false });
      hoveredIdRef.current = f.id;
      map.setFeatureState({ source: 'zcta', id: f.id }, { hovered: true });
      map.getCanvas().style.cursor = 'pointer';
      const zip = String(f.properties.MODZCTA || '');
      setHoveredZip(zip);
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

  const geoDataRef = useRef(null);
  const tiersRef = useRef([]);
  geoDataRef.current = geoData;

  function openHologram(clickedFeature) {
    const data = geoDataRef.current;
    if (!data) return;
    const feat = data.features.find(f => f.id === clickedFeature.id) || clickedFeature;
    const idx = data.features.findIndex(f => f.id === clickedFeature.id);
    const tier = tiersRef.current[idx] ?? 0;
    const col = tier < 0 ? '#888888' : tierColor(tier);
    setHoloFeature(feat);
    setHoloColor(col);
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData) return;
    addLayers(map, geoData, satellite);
  }, [mapReady, geoData]);

  // FIX #6: Unified heatmap+3D update — threeD toggling never affects heatmap state.
  // We use a single effect that reads both heatmap and threeD from state cleanly.
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

    // FIX #3: Heatmap opacity — when satellite is on and 3D is off, use semi-transparent
    // so satellite imagery shows through. When 3D is on, solid.
    const heatFillOpacity = threeD ? 0 : (satellite ? 0.42 : 0.72);

    // FIX #1 & #4: Extrusion height expressions (shared)
    const extrudeHeightExpr = [
      'case', ['boolean', ['get', '_special'], false], 30,
      ['step', ['get', '_tier'], 30, 1, 200, 2, 700, 3, 1600, 4, 2800],
    ];
    // Cap sits exactly AT the top of the extrusion (height = top, base = top - 2)
    const capHeightExpr = extrudeHeightExpr;
    const capBaseExpr = [
      'case', ['boolean', ['get', '_special'], false], 28,
      ['step', ['get', '_tier'], 28, 1, 198, 2, 698, 3, 1598, 4, 2798],
    ];
    // Non-3D uniform height
    const flatExtrudeHeight = ['case', ['boolean', ['get', '_special'], false], 30, 400];

    if (heatmap) {
      const heatColorExpr = [
        'case', ['boolean', ['get', '_special'], false], '#ffffff',
        ['step', ['get', '_tier'],
          HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm,
          3, HEAT_COLORS.orange, 4, HEAT_COLORS.hot,
        ],
      ];

      map.setPaintProperty('zcta-fill', 'fill-color', heatColorExpr);
      map.setPaintProperty('zcta-fill', 'fill-opacity', heatFillOpacity);

      if (threeD) {
        // FIX #1 & #4: 3D+heatmap — extrusions are SOLID OPAQUE (no see-through)
        // Base lines are hidden because the solid extrusion blocks them
        // Cap extrusion sits on top to represent the red outline
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', [
          'case', ['boolean', ['get', '_special'], false], '#111111',
          ['step', ['get', '_tier'],
            HEAT_COLORS.cold, 1, HEAT_COLORS.cool, 2, HEAT_COLORS.warm,
            3, HEAT_COLORS.orange, 4, HEAT_COLORS.hot,
          ],
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', extrudeHeightExpr);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 1.0); // SOLID

        // Cap layer — thin neon red ring sitting ON TOP of the extrusion
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-color', '#ff2200');
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-height', capHeightExpr);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-base', capBaseExpr);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-opacity', 0.95);

        // FIX #1: Hide base boundary lines — they are below the solid extrusion
        // and would show through if opacity < 1, so we just hide them in 3D mode
        map.setPaintProperty('zcta-line', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        // Heatmap only, no 3D
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-opacity', 0);

        // Restore boundary lines
        map.setPaintProperty('zcta-line', 'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', satellite ? 0.25 : 0.35);
      }
    } else {
      // No heatmap
      map.setPaintProperty('zcta-fill', 'fill-color', ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505']);
      map.setPaintProperty('zcta-fill', 'fill-opacity', satellite ? 0.45 : 0.72);

      if (threeD) {
        // FIX #4: 3D without heatmap — solid dark blocks, cap shows red outline on top
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color',
          ['case', ['boolean', ['get', '_special'], false], '#111111', '#3a0505']);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', flatExtrudeHeight);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-base', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', satellite ? 0.9 : 1.0); // solid

        // Cap at top of flat extrusion (height=400, base=398)
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-color', '#ff2200');
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-height',
          ['case', ['boolean', ['get', '_special'], false], 30, 400]);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-base',
          ['case', ['boolean', ['get', '_special'], false], 28, 398]);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-opacity', 0.95);

        // FIX #1: Hide base lines in 3D — they sit below the solid blocks
        map.setPaintProperty('zcta-line', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', 0);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0);
      } else {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 0);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-extrude-cap', 'fill-extrusion-opacity', 0);

        map.setPaintProperty('zcta-line', 'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', satellite ? 0.25 : 0.35);
      }
    }
  }, [heatmap, threeD, timespanIdx, events, geoData, mapReady, satellite, adjacency]);

  // 3D pitch/bearing — FIX #6: toggling pitch is separate from heatmap state
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.easeTo({ pitch: threeD ? 48 : 0, bearing: threeD ? -17 : 0, duration: 700 });
  }, [threeD, mapReady]);

  // Satellite style toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const newStyle = satellite ? satelliteMapStyle() : darkMapStyle();
    real3DSourceLoadedRef.current = false; // reset so real3D source re-adds after style change
    map.setStyle(newStyle);
    map.once('styledata', () => {
      if (!geoData || map.getSource('zcta')) return;
      addLayers(map, geoData, satellite);
    });
  }, [satellite]);

  // FIX: Real3D — load MapTiler source ONCE, then add/remove only the layer
  // This prevents the source being hammered on every heatmap toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Always clean up layers first
    ['real3d-buildings', 'real3d-buildings-outline'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    if (!real3D) return;

    // Add source only once per map instance
    if (!map.getSource('openmaptiles')) {
      try {
        map.addSource('openmaptiles', {
          type: 'vector',
          url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`,
        });
      } catch (err) {
        console.warn('Real3D source add failed:', err);
        return;
      }
    }

    // Real3D building color: if heatmap on, use a warm gradient by height.
    // If heatmap off, dark red tint. Either way the ZCTA fill beneath stains the context.
    const buildingColor = heatmap
      ? ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0],
          0,   HEAT_COLORS.cold,
          30,  HEAT_COLORS.cool,
          80,  HEAT_COLORS.warm,
          150, HEAT_COLORS.orange,
          300, HEAT_COLORS.hot,
        ]
      : '#1a0a0a';

    try {
      map.addLayer({
        id: 'real3d-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': buildingColor,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 5],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.88,
        },
      });

      map.addLayer({
        id: 'real3d-buildings-outline',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'line-color': '#ff2200',
          'line-width': 0.7,
          'line-opacity': 0.5,
        },
      });

      // Real3D pitch
      map.easeTo({ pitch: 55, bearing: -17, duration: 700 });
    } catch (err) {
      console.warn('Real3D layer add failed:', err);
    }
  }, [real3D, mapReady, heatmap]);

  // Real3D pitch reset when turned off (if 3D also off)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!real3D && !threeD) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
  }, [real3D, mapReady, threeD]);

  // Location orb marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (locationMarkerRef.current) { locationMarkerRef.current.remove(); locationMarkerRef.current = null; }
    if (!userLocation) return;
    const el = document.createElement('div');
    el.style.cssText = `
      width: 18px; height: 18px; border-radius: 50%;
      background: #7C3AED;
      border: 2px solid white;
      box-shadow: 0 0 0 4px rgba(124,58,237,0.35), 0 0 24px rgba(124,58,237,0.7);
      z-index: 1000;
      animation: orb-pulse 2s ease-in-out infinite;
    `;
    if (!document.getElementById('orb-pulse-style')) {
      const s = document.createElement('style');
      s.id = 'orb-pulse-style';
      s.textContent = `@keyframes orb-pulse { 0%,100%{box-shadow:0 0 0 4px rgba(124,58,237,0.35),0 0 24px rgba(124,58,237,0.7)} 50%{box-shadow:0 0 0 8px rgba(124,58,237,0.15),0 0 40px rgba(124,58,237,0.9)} }`;
      document.head.appendChild(s);
    }
    locationMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map);
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
    const colonists = await getZipColonists(zip).catch(() => []);
    setSideColonists(colonists);
  }

  async function handleCenterLocation() {
    if (locLoading) return;
    setLocLoading(true);
    setNotInNYC(false);
    try {
      const result = await pingNYCLocation();
      setUserLocation(result);
      if (!result.inNYC) {
        setNotInNYC(true);
        setTimeout(() => setNotInNYC(false), 6000);
      } else if (mapRef.current) {
        mapRef.current.flyTo({ center: [result.lng, result.lat], zoom: 13.5, duration: 1400 });
      }
    } catch {
      setNotInNYC(true);
      setTimeout(() => setNotInNYC(false), 6000);
    }
    setLocLoading(false);
  }

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setHoloFeature(null);
        setSideZip(null); setSideEvents([]); setSideColonists([]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // FIX #4: 3D and Real3D are mutually exclusive — toggling one turns off the other
  const handleThreeDToggle = () => {
    setThreeD(v => {
      if (!v) setReal3D(false); // turning 3D on: turn real3D off
      return !v;
    });
  };
  const handleReal3DToggle = () => {
    setReal3D(v => {
      if (!v) setThreeD(false); // turning real3D on: turn 3D off
      return !v;
    });
  };

  const zipLabel = hoveredZip === 'SAFEZONE' ? 'Safe Zone' : hoveredZip ? `ZIP ${hoveredZip}` : '';
  const sideLabel = sideZip === 'SAFEZONE' ? 'Safe Zone' : sideZip ? `ZIP ${sideZip}` : '';

  // Side panel width — 0 if no zip selected
  const sidePanelW = sideZip ? (isMobile ? 0 : 400) : 0;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#0d0000' }}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 2 }} />
      <CRTEffect active={entered} />
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
              {/* FIX #4: 3D and Real3D are mutual-exclusive swaps */}
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

          {/* Center-to-location button */}
          <button
            onClick={handleCenterLocation}
            disabled={locLoading}
            className="absolute bottom-24 right-4 z-30 w-11 h-11 bg-black/80 border border-white/30 rounded-xl flex items-center justify-center hover:bg-[#7C3AED]/80 hover:border-[#7C3AED] transition-all shadow-lg"
            title="Center to my location"
          >
            {locLoading ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
              </svg>
            )}
          </button>

          {notInNYC && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 bg-yellow-950/95 border border-yellow-600 rounded-2xl px-5 py-3 flex items-center gap-3 shadow-lg">
              <span className="text-yellow-400 text-xl">⚠️</span>
              <div>
                <p className="text-yellow-200 font-black text-sm">You are not in NYC</p>
                <p className="text-yellow-400/70 text-xs mt-0.5">You are in Orbiter mode. You can view but not contribute points.</p>
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
                  {hoveredZip === 'SAFEZONE' && <p className="text-white/40 text-xs italic">Safe zone — events only, no colony</p>}
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

          {/* FIX #2: Side panel — always visible, z-50, semi-transparent, above hologram backdrop */}
          {sideZip && !isMobile && (
            <div className="absolute right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden"
              style={{ width: 400, background: 'rgba(3,0,10,0.82)', backdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(180,0,0,0.3)' }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black/30 flex-shrink-0">
                <div>
                  <p className="text-red-400 font-black">{sideLabel}</p>
                  <p className="text-white/40 text-xs">
                    {sideZip === 'SAFEZONE' ? 'Safe zone — no colonists' : `${sideEvents.length} events · ${sideColonists.length} colonists`}
                  </p>
                </div>
                <button onClick={() => { setSideZip(null); setSideEvents([]); setSideColonists([]); setHoloFeature(null); }}
                  className="text-white/40 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto border-b border-white/10" style={{ maxHeight: '50%' }}>
                <p className="px-4 py-2 text-xs font-black text-white/30 uppercase tracking-widest sticky top-0 bg-gray-950/80">Events</p>
                {sideEvents.length === 0 ? (
                  <p className="px-4 py-6 text-white/20 text-sm text-center">No upcoming events</p>
                ) : sideEvents.map(event => (
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
                  <p className="px-4 py-2 text-xs font-black text-green-400/50 uppercase tracking-widest sticky top-0 bg-gray-950/80">Colony Leaderboard</p>
                  {sideColonists.length === 0 ? (
                    <p className="px-4 py-6 text-white/15 text-sm text-center">No colonists yet</p>
                  ) : sideColonists.map((c, i) => {
                    const medal = MEDALS[i] || null;
                    const isTop = i < 3;
                    return (
                      <div key={c.username || i}
                        className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 transition-colors hover:bg-white/5"
                        style={{ background: isTop ? `rgba(${i === 0 ? '255,200,0' : i === 1 ? '180,180,180' : '200,120,60'},0.06)` : 'transparent' }}>
                        <div className="w-7 text-center flex-shrink-0">
                          {medal ? <span className="text-lg leading-none">{medal}</span> : <span className="text-xs font-black text-white/20">#{i + 1}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-black text-sm truncate ${isTop ? 'text-white' : 'text-white/60'}`}>{c.username}</p>
                          {c.updated_at && (
                            <p className="text-white/20 text-xs">
                              since {new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            </p>
                          )}
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

          {/* FIX #2 Mobile side panel — bottom half only, always transparent overlay */}
          {sideZip && isMobile && (
            <div className="absolute inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden"
              style={{ height: '50%', background: 'rgba(3,0,10,0.85)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(180,0,0,0.3)' }}>
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 flex-shrink-0">
                <div>
                  <p className="text-red-400 font-black text-sm">{sideLabel}</p>
                  <p className="text-white/40 text-xs">{sideZip === 'SAFEZONE' ? 'Safe zone' : `${sideEvents.length} events · ${sideColonists.length} colonists`}</p>
                </div>
                <button onClick={() => { setSideZip(null); setSideEvents([]); setSideColonists([]); setHoloFeature(null); }}
                  className="text-white/40 hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {sideEvents.length === 0 ? (
                  <p className="px-4 py-4 text-white/20 text-sm text-center">No upcoming events</p>
                ) : sideEvents.map(event => (
                  <div key={event.id} onClick={() => setSelectedEvent(event)}
                    className="flex items-center gap-3 px-3 py-2 border-b border-white/5 cursor-pointer hover:bg-white/5"
                    style={{ borderLeftColor: event.hex_color || '#7C3AED', borderLeftWidth: 3 }}>
                    <div className="text-lg flex-shrink-0">{event.representative_emoji || '🎉'}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-black text-xs truncate">{event.event_name}</p>
                      <p className="text-white/40 text-xs">{event.event_date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FIX #2: Hologram — coexists with side panel, NOT fullscreen */}
          {holoFeature && !isMobile && (
            <ZipHologram
              feature={holoFeature}
              color={holoColor}
              onClose={() => setHoloFeature(null)}
            />
          )}
          {holoFeature && isMobile && (
            <ZipHologramMobile
              feature={holoFeature}
              color={holoColor}
              onClose={() => setHoloFeature(null)}
            />
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