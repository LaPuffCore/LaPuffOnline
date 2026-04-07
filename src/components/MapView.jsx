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

// Log-normalized heat so one hot zone doesn't wash out everything
function normalizeHeat(count, maxCount) {
  if (count === 0 || maxCount <= 1) return 0;
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

function darkMapStyle() {
  return { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d0000' } }] };
}
function satelliteMapStyle() {
  return { version: 8, sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 } }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] };
}

const MEDALS = ['🥇', '🥈', '🥉'];

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
        'fill-extrusion-opacity': sat ? 0.75 : 0.9,
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

    // Safe zone black outline (always, separate layer)
    map.addLayer({
      id: 'zcta-safe-line', type: 'line', source: 'zcta',
      filter: ['==', ['get', '_special'], true],
      paint: { 'line-color': '#000000', 'line-width': 2, 'line-opacity': 1 },
    });

    // Non-safe glow layers
    map.addLayer({
      id: 'zcta-line-glow2', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff0033', 'line-width': 7, 'line-opacity': sat ? 0.15 : 0.22, 'line-blur': 10 },
    });
    map.addLayer({
      id: 'zcta-line-glow', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff3366', 'line-width': 3, 'line-opacity': sat ? 0.4 : 0.6, 'line-blur': 4 },
    });
    map.addLayer({
      id: 'zcta-line', type: 'line', source: 'zcta',
      filter: ['!=', ['get', '_special'], true],
      paint: { 'line-color': '#ff6699', 'line-width': 1.5, 'line-opacity': 1 },
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
      if (hoveredIdRef.current !== null) { map.setFeatureState({ source: 'zcta', id: hoveredIdRef.current }, { hovered: false }); hoveredIdRef.current = null; }
      map.getCanvas().style.cursor = '';
      setHoveredZip(null); setTooltipPos(null);
    });
    map.on('click', 'zcta-fill', e => {
      if (!e.features.length) return;
      const zip = String(e.features[0].properties.MODZCTA || '');
      openSidePanel(zip);
    });
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

    const rawHeat = geoData.features.map(f => {
      const zip = String(f.properties.MODZCTA || '');
      if (f.properties._special) return 0;
      return normalizeHeat(zipMap[zip]?.length || 0, maxCount);
    });
    const spreadHeat = rawHeat.map((h, i) => {
      if (!adjacency[i]?.length || geoData.features[i].properties._special) return h;
      const boost = adjacency[i].reduce((s, j) => s + rawHeat[j] * 0.14, 0) / adjacency[i].length;
      return Math.min(1, h + boost);
    });

    // Update source with heat property
    const withHeat = {
      ...geoData,
      features: geoData.features.map((f, i) => ({
        ...f,
        properties: { ...f.properties, _heat: spreadHeat[i] },
      })),
    };
    if (map.getSource('zcta')) map.getSource('zcta').setData(withHeat);

    if (heatmap) {
      // Fill: heatmap color (safe zones stay white)
      map.setPaintProperty('zcta-fill', 'fill-color', [
        'case', ['boolean', ['get', '_special'], false], '#ffffff',
        ['interpolate', ['linear'], ['get', '_heat'],
          0, 'rgba(0,240,255,0.1)',
          0.12, 'rgba(0,200,255,0.3)',
          0.28, 'rgba(0,255,150,0.38)',
          0.45, 'rgba(200,255,0,0.42)',
          0.65, 'rgba(255,140,0,0.48)',
          1.0, 'rgba(255,0,40,0.58)',
        ],
      ]);
      map.setPaintProperty('zcta-fill', 'fill-opacity', 1);

      // Red neon outlines always stay on (don't touch zcta-line)

      if (threeD) {
        // 3D + heatmap: stain extrusion with heat color, height from heat
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', [
          'case', ['boolean', ['get', '_special'], false], '#111111',
          ['interpolate', ['linear'], ['get', '_heat'],
            0, '#000a1a', 0.15, '#002233', 0.3, '#003322',
            0.5, '#223300', 0.7, '#331500', 1.0, '#330000',
          ],
        ]);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', [
          'case', ['boolean', ['get', '_special'], false], 30,
          ['interpolate', ['linear'], ['get', '_heat'], 0, 50, 1, 2800],
        ]);
      } else {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', 0);
      }
    } else {
      // No heatmap
      map.setPaintProperty('zcta-fill', 'fill-color', ['case', ['boolean', ['get', '_special'], false], '#ffffff', '#1a0505']);
      map.setPaintProperty('zcta-fill', 'fill-opacity', satellite ? 0.45 : 0.72);
      if (threeD) {
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-color', ['case', ['boolean', ['get', '_special'], false], '#111111', '#3a0505']);
        map.setPaintProperty('zcta-extrude', 'fill-extrusion-height', ['case', ['boolean', ['get', '_special'], false], 30, 400]);
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

  // Satellite style toggle
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
                <p className="text-yellow-400/70 text-xs mt-0.5">You are in spectator mode. You can view but not contribute points.</p>
              </div>
            </div>
          )}

          {/* Hover tooltip */}
          {hoveredZip && tooltipPos && (
            <div className="absolute z-30 pointer-events-none"
              style={{ left: Math.min(tooltipPos.x + 12, window.innerWidth - 220), top: Math.max(tooltipPos.y - 10, 70), width: 210 }}>
              <div className="bg-gray-950/95 border border-pink-900/60 rounded-2xl overflow-hidden shadow-[0_0_15px_rgba(255,50,100,0.3)]">
                <div className="px-3 py-2 border-b border-white/10">
                  <p className="text-pink-300 font-black text-xs">{zipLabel}</p>
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
            <div className="absolute right-0 top-0 bottom-0 z-30 flex flex-col bg-gray-950/97 border-l border-pink-900/40 overflow-hidden"
              style={{ width: 400, backdropFilter: 'blur(12px)' }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-gray-950/80 flex-shrink-0">
                <div>
                  <p className="text-pink-300 font-black">{sideLabel}</p>
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
            </div>
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