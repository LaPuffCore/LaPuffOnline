// LaPuff Service Worker — PMTiles full-file pre-warm + Range slicing + static GeoJSON cache + satellite tile cache.
const SW_VERSION = 'lapuff-sw-v12';

// Cache names (must match mapDataPipeline.js)
const PMTILES_CACHE     = 'lapuff-pmtiles-sw-v3';     // v3: per-Range responses (fallback)
const PMTILES_FULL_CACHE = 'lapuff-pmtiles-full-v6';  // v6: borough-FGB rebuild + SW v11
const STATIC_CACHE      = 'lapuff-static-v1';         // v1: ZCTA + borough + water GeoJSON
const SATELLITE_CACHE   = 'lapuff-satellite-v1';      // v1: ArcGIS/Wayback/Clarity raster tiles (cross-session persistent)

const MANAGED_CACHES = [PMTILES_CACHE, PMTILES_FULL_CACHE, STATIC_CACHE, SATELLITE_CACHE];

// URLs that we know are small + should be cached as full files (when SW receives PRECACHE message)
// nyc_buildings.pmtiles (~71MB) is fully precached → in-memory range slicing = 0ms warm tile fetches
const FULL_PMTILES_URL_PATTERNS = ['realfinaldeciroads.pmtiles', 'nyc_buildings.pmtiles'];

// Satellite tile host patterns — intercepted and served cache-first from SATELLITE_CACHE
const SATELLITE_HOST_PATTERNS = [
  'services.arcgisonline.com',
  'wayback.maptiles.arcgis.com',
  'clarity.maptiles.arcgis.com',
];

// Static GeoJSON files we serve cache-first (small same-origin assets used by every map render)
const STATIC_PATTERNS = [
  'MODZCTA_2010_WGS1984.geo.json',
  'borough.geo.json',
  'water_static.geojson',
  'zcta_adjacency.json',
];

// ── Install: skip waiting so new SW activates immediately ────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  // No precache at install — assets are cached lazily as the app uses them.
});

// ── Activate: claim all open clients, clean up stale caches ─────────────────
self.addEventListener('activate', event => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('lapuff-') && !MANAGED_CACHES.includes(k))
          .map(k => {
            console.log('[SW] Deleting stale cache:', k);
            return caches.delete(k);
          })
      )
    )
  );
});

// ── Fetch: intercept map data requests ──────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  const path = url.pathname;

  // ── Static GeoJSON: cache-first for small same-origin assets ─────────────
  if (STATIC_PATTERNS.some(p => path.endsWith(p))) {
    event.respondWith(handleStatic(request));
    return;
  }

  // ── PMTiles files: cache Range responses for repeat tile loads ───────────
  // MapLibre makes HTTP Range requests (bytes=X-Y) for each tile in a PMTiles file.
  // We cache each Range response keyed by (URL + Range header) so repeat pan/zoom
  // over the same area serves from SW cache instead of hitting OCI/network.
  // Works for both local water_nyc.pmtiles and Oracle-hosted roads.
  if (path.endsWith('.pmtiles') || url.href.includes('realfinaldeciroads') || url.href.includes('nyc_final')) {
    event.respondWith(handlePMTiles(request));
    return;
  }

  // ── Satellite tiles: cache-first from SATELLITE_CACHE (cross-session persistent) ──
  if (SATELLITE_HOST_PATTERNS.some(h => url.host === h || url.host.endsWith('.' + h))) {
    event.respondWith(handleSatellite(request));
    return;
  }
});

// Cache-first satellite tile handler. Stores opaque (no-cors) responses too —
// MapLibre uses them via crossOrigin='anonymous' but cache.put accepts any response type.
async function handleSatellite(request) {
  const cache = await caches.open(SATELLITE_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    const resp = await fetch(request);
    if (resp && (resp.ok || resp.type === 'opaque' || resp.status === 0)) {
      cache.put(request.url, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    const resp = await fetch(request);
    if (resp.ok && resp.status === 200) {
      cache.put(request.url, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (err) {
    return new Response('Static asset not available offline', { status: 503 });
  }
}

async function handlePMTiles(request) {
  // Strategy: check full-file cache first. If we have the entire .pmtiles cached,
  // slice the requested byte range from it and return a synthesized 206 response.
  // This is dramatically faster than per-Range network calls.
  const url = new URL(request.url);
  const isFullCandidate = FULL_PMTILES_URL_PATTERNS.some(p => url.href.includes(p));

  if (isFullCandidate) {
    try {
      const fullCache = await caches.open(PMTILES_FULL_CACHE);
      const fullHit = await fullCache.match(url.origin + url.pathname);
      if (fullHit) {
        const range = request.headers.get('range');
        if (!range) {
          // No range header: return full file (e.g., a header-pre-warm fetch)
          return fullHit.clone();
        }
        // Parse Range: bytes=START-END
        const m = /bytes=(\d+)-(\d+)?/.exec(range);
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : -1;
          const ab = await fullHit.arrayBuffer();
          const total = ab.byteLength;
          const realEnd = end >= 0 ? Math.min(end, total - 1) : total - 1;
          const slice = ab.slice(start, realEnd + 1);
          return new Response(slice, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Range': `bytes ${start}-${realEnd}/${total}`,
              'Content-Length': String(slice.byteLength),
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }
    } catch (e) { /* fall through to per-range cache */ }
  }

  // Fallback: per-Range cache (works for any PMTiles, including partial pre-warm)
  const cache = await caches.open(PMTILES_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const resp = await fetch(request.clone());
    if (resp.ok || resp.status === 206) {
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (err) {
    console.warn('[SW] PMTiles fetch failed:', err);
    return new Response('PMTiles not available offline', { status: 503 });
  }
}

// ── Message handler: precache full PMTiles file ─────────────────────────────
// Sent by MapLoadingScreen Phase 2A. SW fetches the full file once and caches
// it under URL key. Subsequent Range requests are served by slicing in-memory.
self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'PRECACHE_PMTILES' && msg.url) {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(PMTILES_FULL_CACHE);
        const url = new URL(msg.url);
        const key = url.origin + url.pathname;
        const existing = await cache.match(key);
        if (existing) return; // already cached
        const resp = await fetch(msg.url, { cache: 'reload' });
        if (resp.ok && resp.status === 200) {
          await cache.put(key, resp.clone());
          console.log('[SW] Pre-cached full PMTiles:', key);
        }
      } catch (e) { console.warn('[SW] PRECACHE_PMTILES failed:', e); }
    })());
    return;
  }

  if (msg.type === 'PRECACHE_SATELLITE' && Array.isArray(msg.urls)) {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(SATELLITE_CACHE);
        const urls = msg.urls;
        let active = 0, idx = 0;
        const MAX = 6;
        await new Promise(resolve => {
          function next() {
            if (idx >= urls.length && active === 0) { resolve(); return; }
            while (active < MAX && idx < urls.length) {
              const u = urls[idx++];
              active++;
              (async () => {
                try {
                  const existing = await cache.match(u);
                  if (existing) return;
                  const resp = await fetch(u, { mode: 'no-cors' });
                  if (resp && (resp.ok || resp.type === 'opaque' || resp.status === 0)) {
                    await cache.put(u, resp.clone()).catch(() => {});
                  }
                } catch (_e) { /* skip */ }
                finally { active--; next(); }
              })();
            }
          }
          next();
        });
        console.log(`[SW] Satellite precache complete: ${urls.length} tiles`);
      } catch (e) { console.warn('[SW] PRECACHE_SATELLITE failed:', e); }
    })());
    return;
  }
});
