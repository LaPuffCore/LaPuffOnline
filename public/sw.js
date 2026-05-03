// LaPuff Service Worker — caches FGB files + PMTiles Range requests for offline/repeat visit speed.
// Version bump this string to force SW update across all clients.
const SW_VERSION = 'lapuff-sw-v2';

// Cache names (must match mapDataPipeline.js)
const FGB_CACHE      = 'lapuff-fgb-v6';            // borough-split spatial FGBs
const PMTILES_CACHE  = 'lapuff-pmtiles-sw-v1';     // PMTiles Range responses

// All cache names managed by this SW version
const MANAGED_CACHES = [FGB_CACHE, PMTILES_CACHE];

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
  const cache = await caches.open(PMTILES_CACHE);

  // Match exact request — Range header is part of the key.
  // This means the same Range byte-range for the same tile will hit cache on re-visit.
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const resp = await fetch(request.clone());
    // Cache both full (200) and partial (206) responses
    if (resp.ok || resp.status === 206) {
      // Clone before consuming — put is fire-and-forget
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (err) {
    console.warn('[SW] PMTiles fetch failed:', err);
    return new Response('PMTiles not available offline', { status: 503 });
  }
}
