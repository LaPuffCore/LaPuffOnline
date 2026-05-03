// LaPuff Service Worker — caches FGB files + PMTiles (full-file pre-warm + Range slicing).
const SW_VERSION = 'lapuff-sw-v7';

// Cache names (must match mapDataPipeline.js)
const FGB_CACHE         = 'lapuff-fgb-v8';            // v8: HEIGHT_ROOF feet→meters fix + stack-overflow fix
const PMTILES_CACHE     = 'lapuff-pmtiles-sw-v2';     // v2: per-Range responses (still used as fallback)
const PMTILES_FULL_CACHE = 'lapuff-pmtiles-full-v2';  // v2: full PMTiles file pre-warmed at MapLoadingScreen (now incl. nyc_buildings)

const MANAGED_CACHES = [FGB_CACHE, PMTILES_CACHE, PMTILES_FULL_CACHE];

// URLs that we know are small + should be cached as full files (when SW receives PRECACHE message)
// nyc_buildings.pmtiles (~71MB) is fully precached → in-memory range slicing = 0ms warm tile fetches
const FULL_PMTILES_URL_PATTERNS = ['realfinaldeciroads.pmtiles', 'nyc_buildings.pmtiles'];

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

  // ── FGB files: cache-first for FULL fetches, pass-through for Range ──────
  // Desktop Phase 2A does full fetch → SW caches whole file → instant revisit.
  // Mobile fgbDeserialize(url, rect) sends Range requests → pass through so
  // R-tree spatial queries get correct partial bytes (browser HTTP cache handles
  // repeat ranges; SW-caching Range responses by URL would clobber across reads).
  if (path.endsWith('.fgb')) {
    if (request.headers.get('range')) return; // pass-through for Range
    event.respondWith(handleFGB(request));
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
});

async function handleFGB(request) {
  const cacheKey = request.url;
  const cache = await caches.open(FGB_CACHE);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Network fetch + cache
  try {
    const resp = await fetch(request);
    if (resp.ok && resp.status === 200) {
      cache.put(cacheKey, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (err) {
    console.warn('[SW] FGB fetch failed:', err);
    return new Response('FGB not available offline', { status: 503 });
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
  if (!msg || msg.type !== 'PRECACHE_PMTILES' || !msg.url) return;
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
});
