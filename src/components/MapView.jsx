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

const TIMESPAN_STEPS = [
  { label: '1d', days: 1 }, { label: '7d', days: 7 }, { label: '30d', days: 30 },
  { label: '3mo', days: 90 }, { label: '6mo', days: 180 },
];

// --- HEAT COLORS (shared constants) ---
// Tier thresholds: 0=cold(blue), 0.2=cool(ltgreen), 0.4=warm(yellow), 0.6=orange, 0.8=hot(red)
const HEAT_COLORS = {
  cold:     '#00eeff',   // bright cyan-blue  (#1)
  cool:     '#00ff88',   // bright light green (#2)
  warm:     '#ccff00',   // yellow-green       (#3)
  orange:   '#ff8800',   // orange             (#4)
  hot:      '#ff1100',   // pure bright red    (#5)
};

// Tier index → css color
function tierColor(tier) {
  if (tier >= 4) return HEAT_COLORS.hot;
  if (tier >= 3) return HEAT_COLORS.orange;
  if (tier >= 2) return HEAT_COLORS.warm;
  if (tier >= 1) return HEAT_COLORS.cool;
  return HEAT_COLORS.cold;
}

// Tier index → extrusion height
function tierHeight(tier) {
  if (tier >= 4) return 2800;
  if (tier >= 3) return 1600;
  if (tier >= 2) return 700;
  if (tier >= 1) return 200;
  return 30;   // cold: just slightly above ground
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
  const maxCount = Math.max(...Object.values(zipMap).map(a => a.length), 1);
  return { zipMap, maxCount };
}

function normalizeHeat(count, maxCount) {
  if (count === 0 || maxCount <= 1) return 0;
  return Math.log(count + 1) / Math.log(maxCount + 1);
}

// Build true adjacency using bbox proximity
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

// Compute per-feature tier (0-4) with adjacency diffusion
// Tier 4=red(hot), 3=orange, 2=yellow/warm, 1=cool(ltgreen), 0=cold(blue)
// Adjacency: each zone touching a tier-N zone gets min(tier, N-1) if its raw tier is less
function computeTiers(features, zipMap, maxCount, adjacency) {
  // Raw tiers from event density
  const rawTiers = features.map(f => {
    if (f.properties._special) return -1; // special zones excluded
    const zip = String(f.properties.MODZCTA || '');
    const heat = normalizeHeat(zipMap[zip]?.length || 0, maxCount);
    if (heat >= 0.80) return 4;
    if (heat >= 0.55) return 3;
    if (heat >= 0.30) return 2;
    if (heat >= 0.05) return 1;
    return 0;
  });

  // Diffuse downward: BFS-like one-pass for each tier level descending
  // We do multiple passes so diffusion cascades correctly
  const tiers = [...rawTiers];
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < features.length; i++) {
      if (tiers[i] < 0) continue; // skip special
      const neighbors = adjacency[i] || [];
      neighbors.forEach(j => {
        if (tiers[j] < 0) return; // skip special neighbors
        const diffusedTier = tiers[i] - 1;
        if (diffusedTier > tiers[j]) {
          tiers[j] = diffusedTier;
        }
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

// MapLibre GL style with OSM buildings for Real3D mode
function buildingsStyle(satellite) {
  const base = satellite ? satelliteMapStyle() : darkMapStyle();
  return {
    ...base,
    sources: {
      ...base.sources,
      openmaptiles: {
        type: 'vector',
        url: 'https://api.maptiler.com/tiles/v3/tiles.json?key=VjoJJ0mSCXFo9kFGYGxJ',
        // fallback: use a public OSM vector tile source
      },
      // Use a free public OSM vector tile for buildings
      osmbuildings: {
        type: 'vector',
        tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}'],
        minzoom: 12,
        maxzoom: 16,
      }
    },
    layers: [
      ...base.layers,
    ]
  };
}

const MEDALS = ['🥇', '🥈', '🥉'];

// ----- ZIP HOLOGRAM OVERLAY -----
// Renders an isolated spinning glitchy 3D extrusion of one zip shape
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

    // Collect all polygon rings
    const allRings = feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat(1)
      : feature.geometry.coordinates;

    // Compute bounding box
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
      const rotY = Math.sin(t) * 0.35; // pseudo 3D horizontal sway
      const glitch = Math.random() < 0.04; // random glitch frame

      ctx.clearRect(0, 0, W, H);

      // Extrusion depth layers (3D effect)
      const depth = 18;
      for (let d = depth; d >= 0; d--) {
        const alpha = 0.08 + (1 - d / depth) * 0.18;
        const shiftX = Math.sin(rotY) * d * 1.8;
        const shiftY = -d * 0.7;
        drawShape(ctx, shiftX, shiftY, alpha, d > 0);
      }

      // Top face (solid)
      const topShift = Math.sin(rotY) * depth * 1.8;
      ctx.globalAlpha = 1;
      drawShape(ctx, topShift, -depth * 0.7, 0.55, false);

      // Glitch scanlines
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

      // Glow outline on top
      ctx.save();
      ctx.globalAlpha = 0.7 + Math.sin(t * 3) * 0.2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      drawShape(ctx, topShift, -depth * 0.7, 0.9, true);
      ctx.restore();

      // Blink effect
      if (Math.sin(t * 7) > 0.92) {
        ctx.fillStyle = color + '22';
        ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [feature, color]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const zipLabel = feature?.properties?.MODZCTA;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}
    >
      <div className="relative pointer-events-auto flex flex-col items-center" style={{ width: 480, maxWidth: '90vw' }}>
        {/* Header */}
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

        {/* Canvas hologram */}
        <canvas
          ref={canvasRef}
          width={460}
          height={360}
          style={{
            width: '100%',
            height: 360,
            borderRadius: 18,
            border: `2px solid ${color}`,
            boxShadow: `0 0 40px ${color}66, 0 0 80px ${color}33`,
            background: '#000000cc',
          }}
        />

        {/* Scanline overlay for CRT feel */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: 44, left: 0, right: 0, height: 360,
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

export default function MapView({ events }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);
  const locationMarkerRef = useRef(null);
  const heatmapRef = useRef(false);
  const threeDRef = useRef(false);

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
  // Hologram state
  const [holoFeature, setHoloFeature] = useState(null);
  const [holoColor, setHoloColor] = useState(HEAT_COLORS.cold);

  heatmapRef.current = heatmap;
  threeDRef.current = threeD;

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

  // Add/replace layers
  function addLayers(map, data, sat) {
    if (!map || !data || map.getSource('zcta')) return;
    map.addSource('zcta', { type: 'geojson', data, generateId: false });

    // 3D Extrusion
    map.addLayer({
      id: 'zcta-extrude', type: 'fill-extrusion', source: 'zcta',
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['get', '_special'], false], '#222222', '#1a0505'],
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0,
      },
    });

    // Flat fill (for hover + heatmap)
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

    // Safe zone black outline
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': 2, 'line-opacity': 1 },
    });

    // Non-safe boundary layers — bright red, high saturation
    // Outer glow
    map.addLayer({
      id: 'zcta-line-glow2', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff0000', 'line-width': 8, 'line-opacity': sat ? 0.25 : 0.35, 'line-blur': 10 },
    });
    // Inner glow
    map.addLayer({
      id: 'zcta-line-glow', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff1100', 'line-width': 3, 'line-opacity': sat ? 0.55 : 0.75, 'line-blur': 3 },
    });
    // Hard line
    map.addLayer({
      id: 'zcta-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff2200', 'line-width': 1.5, 'line-opacity': 1 },
    });

    // Top-of-extrusion glow line (only visible in 3D mode, drawn on top)
    map.addLayer({
      id: 'zcta-top-glow', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: {
        'line-color': '#ff2200',
        'line-width': 2.5,
        'line-opacity': 0,  // toggled on in 3D+heatmap
        'line-blur': 2,
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
      // Hologram: find the feature in geoData
      // We read geoData from the ref below via a closure trick
      openHologram(e.features[0]);
    });
  }

  // Keep a ref to geoData and tiers for click handler
  const geoDataRef = useRef(null);
  const tiersRef = useRef([]);
  geoDataRef.current = geoData;

  function openHologram(clickedFeature) {
    // Find full feature from geoData by id
    const data = geoDataRef.current;
    if (!data) return;
    const feat = data.features.find(f => f.id === clickedFeature.id) || clickedFeature;
    // Pick color from current tiers
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

  // Heatmap + 3D combined update
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !geoData || !map.getLayer('zcta-fill')) return;
    const { zipMap, maxCount } = buildZipEventMap(events, TIMESPAN_STEPS[timespanIdx].days);

    // Compute adjacency-diffused tiers
    const tiers = computeTiers(geoData.features, zipMap, maxCount, adjacency);
    tiersRef.current = tiers;

    // Attach _heat and _tier to features
    const withHeat = {
      ...geoData,
      features: geoData.features.map((f, i) => {
        const tier = tiers[i];
        const zip = String(f.properties.MODZCTA || '');
        const rawHeat = f.properties._special ? 0 : normalizeHeat(zipMap[zip]?.length || 0, maxCount);
        return {
          ...f,
          properties: {
            ...f.properties,
            _heat: rawHeat,
            _tier: tier < 0 ? 0 : tier,
          },
        };
      }),
    };
    if (map.getSource('zcta')) map.getSource('zcta').setData(withHeat);

    if (heatmap) {
      // Fill colors based on tier (step expression)
      // Uses _tier property on each feature
      map.setPaintProperty('zcta-fill', 'fill-color', [
        'case',
        ['boolean', ['get', '_special'], false], '#ffffff',
        ['step', ['get', '_tier'],
          HEAT_COLORS.cold,    // tier 0
          1, HEAT_COLORS.cool,   // tier 1
          2, HEAT_COLORS.warm,   // tier 2
          3, HEAT_COLORS.orange, // tier 3
          4, HEAT_COLORS.hot,    // tier 4
        ],
      ]);
      map.setPaintProperty('zcta-fill', 'fill-opacity', satellite ? 0.55 : 0.72);

      if (threeD) {
        // 3D+heatmap: solid neon colors, raised by tier
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', [
          'case',
          ['boolean', ['get', '_special'], false], '#111111',
          ['step', ['get', '_tier'],
            HEAT_COLORS.cold,
            1, HEAT_COLORS.cool,
            2, HEAT_COLORS.warm,
            3, HEAT_COLORS.orange,
            4, HEAT_COLORS.hot,
          ],
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', [
          'case',
          ['boolean', ['get', '_special'], false], 30,
          ['step', ['get', '_tier'],
            30,    // tier 0: cold just barely above ground
            1, 200,
            2, 700,
            3, 1600,
            4, 2800,
          ],
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', 1.0);
        map.setPaintProperty('zcta-fill', 'fill-opacity', 0);  // hide flat fill when 3D extrude covers it

        // Top glow line — visible in 3D+heatmap
        map.setPaintProperty('zcta-top-glow', 'line-opacity', 0.9);
        map.setPaintProperty('zcta-top-glow', 'line-color', '#ff2200');
        // Base lines less prominent since top glow takes over
        map.setPaintProperty('zcta-line', 'line-opacity', 0.3);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', 0.2);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', 0.1);
      } else {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
        map.setPaintProperty('zcta-top-glow', 'line-opacity', 0);
        // Restore normal boundary lines
        map.setPaintProperty('zcta-line', 'line-opacity', 1);
        map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
        map.setPaintProperty('zcta-line-glow2', 'line-opacity', satellite ? 0.25 : 0.35);
      }
    } else {
      // No heatmap
      map.setPaintProperty('zcta-fill', 'fill-color', ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505']);
      map.setPaintProperty('zcta-fill', 'fill-opacity', satellite ? 0.45 : 0.72);
      map.setPaintProperty('zcta-top-glow', 'line-opacity', 0);
      map.setPaintProperty('zcta-line', 'line-opacity', 1);
      map.setPaintProperty('zcta-line-glow', 'line-opacity', satellite ? 0.55 : 0.75);
      map.setPaintProperty('zcta-line-glow2', 'line-opacity', satellite ? 0.25 : 0.35);

      if (threeD) {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', [
          'case', ['boolean', ['get', '_special'], false], '#111111', '#3a0505'
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', [
          'case', ['boolean', ['get', '_special'], false], 30, 400
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-opacity', satellite ? 0.75 : 0.9);
      } else {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
      }
    }
  }, [heatmap, threeD, timespanIdx, events, geoData, mapReady, satellite, adjacency]);

  // 3D pitch/bearing
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.easeTo({ pitch: threeD ? 48 : 0, bearing: threeD ? -17 : 0, duration: 700 });
  }, [threeD, mapReady]);

  // Satellite style toggle — additive, does NOT disable other toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const newStyle = satellite ? satelliteMapStyle() : darkMapStyle();
    map.setStyle(newStyle);
    map.once('styledata', () => {
      if (!geoData || map.getSource('zcta')) return;
      addLayers(map, geoData, satellite);
    });
  }, [satellite]);

  // Real3D: add OSM building layer using MapLibre vector tiles (maptiler public)
  // This is additive — stays independent of other toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Remove previous real3d layers/source if any
    ['real3d-buildings', 'real3d-buildings-outline'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('openmaptiles')) map.removeSource('openmaptiles');

    if (!real3D) return;

    // Add MapTiler vector tiles (free tier, public key for buildings)
    // Using the public demo key — user should replace with their own
    try {
      map.addSource('openmaptiles', {
        type: 'vector',
        url: 'https://api.maptiler.com/tiles/v3/tiles.json?key=VjoJJ0mSCXFo9kFGYGxJ',
      });

      // Real 3D buildings colored by heatmap tier of their zip (via _tier on zcta)
      // Since buildings don't have zip data we color them based on the map style
      // They will inherit visual context from the heatmap fill beneath
      map.addLayer({
        id: 'real3d-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': heatmap
            ? ['interpolate', ['linear'], ['get', 'render_height'],
                0, HEAT_COLORS.cold,
                50, HEAT_COLORS.cool,
                100, HEAT_COLORS.warm,
                200, HEAT_COLORS.orange,
                400, HEAT_COLORS.hot,
              ]
            : '#1a0a0a',
          'fill-extrusion-height': ['get', 'render_height'],
          'fill-extrusion-base': ['get', 'render_min_height'],
          'fill-extrusion-opacity': 0.85,
        },
      });

      map.addLayer({
        id: 'real3d-buildings-outline',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12,
        paint: {
          'line-color': '#ff2200',
          'line-width': 0.8,
          'line-opacity': 0.6,
        },
      });
    } catch (err) {
      console.warn('Real3D buildings failed to load:', err);
    }
  }, [real3D, mapReady, heatmap]);

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

  // Update hover info
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

  // Global ESC closes side panel and hologram
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

  const zipLabel = hoveredZip === 'SAFEZONE' ? 'Safe Zone' : hoveredZip ? `ZIP ${hoveredZip}` : '';
  const sideLabel = sideZip === 'SAFEZONE' ? 'Safe Zone' : sideZip ? `ZIP ${sideZip}` : '';

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#0d0000' }}>
      {/* Map */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 2 }} />

      {/* CRT Effect — always on (additive even on satellite) */}
      <CRTEffect active={entered} />

      {/* Intro */}
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

          {/* Center-to-location button */}
          <button
            onClick={handleCenterLocation}
            disabled={locLoading}
            className="absolute bottom-24 right-4 z-30 w-11 h-11 bg-black/80 border border-white/30 rounded-xl flex items-center justify-center hover:bg-[#7C3AED]/80 hover:border-[#7C3AED] transition-all shadow-lg"
            title="Center to my location (ping only)"
          >
            {locLoading ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
              </svg>
            )}
          </button>

          {/* Not in NYC warning */}
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

          {/* Side panel */}
          {sideZip && (
            <div className="absolute right-0 top-0 bottom-0 z-30 flex flex-col bg-gray-950/97 border-l border-red-900/40 overflow-hidden"
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

              {/* Events */}
              <div className="flex-1 overflow-y-auto border-b border-white/10" style={{ maxHeight: '50%' }}>
                <p className="px-4 py-2 text-xs font-black text-white/30 uppercase tracking-widest sticky top-0 bg-gray-950">Events</p>
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

              {/* Colonist Leaderboard */}
              {sideZip !== 'SAFEZONE' && (
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: '50%' }}>
                  <p className="px-4 py-2 text-xs font-black text-green-400/50 uppercase tracking-widest sticky top-0 bg-gray-950">Colony Leaderboard</p>
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
                          {medal ? (
                            <span className="text-lg leading-none">{medal}</span>
                          ) : (
                            <span className="text-xs font-black text-white/20">#{i + 1}</span>
                          )}
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

              {/* Hologram lives in its own overlay, this panel stays */}
            </div>
          )}

          {/* Zip Hologram overlay */}
          {holoFeature && (
            <ZipHologram
              feature={holoFeature}
              color={holoColor}
              onClose={() => setHoloFeature(null)}
            />
          )}

          {/* Location active indicator */}
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