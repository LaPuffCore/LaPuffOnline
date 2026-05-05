// LaPuff Service Worker — PMTiles Range slicing + static GeoJSON cache + satellite tile cache.
// Stage-1 OOM fix: buildings PMTiles is NEVER served from a full-file slice (was 74MB ArrayBuffer
// re-allocated per Range = multi-GB transient peak → desktop OOM). Buildings flow exclusively
// through the per-Range cache (PMTILES_CACHE) with an LRU cap.
const SW_VERSION = 'lapuff-sw-v17';

const PMTILES_CACHE              = 'lapuff-pmtiles-sw-v4';     // per-Range responses (URL+Range key) — used by ALL pmtiles now for buildings
const PMTILES_FULL_CACHE         = 'lapuff-pmtiles-full-v6';   // full-file slice cache — ROADS ONLY (15MB safe)
const STATIC_CACHE               = 'lapuff-static-v1';         // ZCTA + borough + water GeoJSON
const SATELLITE_PERSISTENT_CACHE = 'lapuff-sat-persistent-v1'; // z9–z14 tiles — NEVER evicted; z15–z16 overflow fills spare room
const SATELLITE_DYNAMIC_CACHE    = 'lapuff-sat-dynamic-v1';    // z15–z16 tiles — LRU 30MB

const MANAGED_CACHES = [PMTILES_CACHE, PMTILES_FULL_CACHE, STATIC_CACHE, SATELLITE_PERSISTENT_CACHE, SATELLITE_DYNAMIC_CACHE];

// Only roads PMTiles uses the full-file slice path. Buildings deliberately excluded.
const FULL_PMTILES_URL_PATTERNS = ['realfinaldeciroads.pmtiles'];

// Per-URL ArrayBuffer cache (in-memory, SW-global). Roads file fetched once per SW lifetime
// and kept as a single live ArrayBuffer reference — Range requests slice from it directly with
// zero re-allocation. Survives until SW is terminated by the browser.
const inMemoryFullBuffers = new Map(); // url -> ArrayBuffer

// LRU cap for the per-Range buildings cache. Prevents unbounded growth when user pans across
// many tiles. Cap is a soft-eviction triggered on cache writes.
const BUILDINGS_RANGE_CACHE_CAP = 140 * 1024 * 1024; // 140MB; mobile fetches less so this auto-fits
const buildingsRangeMeta = new Map(); // compositeKey -> { size, lastAccess }
let buildingsRangeTotalBytes = 0;
async function trackBuildingsRangeWrite(compositeKey, byteSize) {
  buildingsRangeMeta.set(compositeKey, { size: byteSize, lastAccess: Date.now() });
  buildingsRangeTotalBytes += byteSize;
  if (buildingsRangeTotalBytes <= BUILDINGS_RANGE_CACHE_CAP) return;
  try {
    const cache = await caches.open(PMTILES_CACHE);
    const sorted = Array.from(buildingsRangeMeta.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    while (buildingsRangeTotalBytes > BUILDINGS_RANGE_CACHE_CAP * 0.85 && sorted.length) {
      const [k, meta] = sorted.shift();
      await cache.delete(k);
      buildingsRangeMeta.delete(k);
      buildingsRangeTotalBytes -= meta.size;
    }
  } catch (_e) { /* eviction best-effort */ }
}

// Satellite cache — two-bucket system:
//   PERSISTENT (60MB): z9–z14 tiles are NEVER evicted. z15–z16 overflow entries fill any spare
//     capacity (~6MB after ~54MB z9–z14 fill) and are evicted first if cap is hit.
//   DYNAMIC (30MB): z15–z16 tiles only, pure LRU. Independent eviction from persistent.
const SAT_PERSISTENT_CAP = 60 * 1024 * 1024;  // 60MB
const SAT_DYNAMIC_CAP    = 30 * 1024 * 1024;  // 30MB

const satPersistentMeta = new Map(); // url -> {size, zoom, isOverflow, lastAccess}
let satPersistentTotal = 0;
let satPersistentOverflowTotal = 0;

const satDynamicMeta = new Map(); // url -> {size, lastAccess}
let satDynamicTotal = 0;

// Extract zoom level from a satellite tile URL.
// ArcGIS/Clarity: .../MapServer/tile/{z}/{y}/{x}
// Wayback:        .../MapServer/tile/13045/{z}/{y}/{x}  (version id before zoom)
function extractSatZoom(url) {
  const m = /\/tile\/(?:13045\/)?(\d+)\/\d+\/\d+/.exec(url);
  return m ? parseInt(m[1], 10) : -1;
}

async function evictSatPersistentOverflows(cache, needed) {
  const overflows = Array.from(satPersistentMeta.entries())
    .filter(([, m]) => m.isOverflow)
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  let freed = 0;
  for (const [k, meta] of overflows) {
    if (freed >= needed) break;
    await cache.delete(k).catch(() => {});
    satPersistentMeta.delete(k);
    satPersistentTotal        -= meta.size;
    satPersistentOverflowTotal -= meta.size;
    freed += meta.size;
  }
}

async function evictSatDynamic(cache) {
  const sorted = Array.from(satDynamicMeta.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  while (satDynamicTotal > SAT_DYNAMIC_CAP * 0.85 && sorted.length) {
    const [k, meta] = sorted.shift();
    await cache.delete(k).catch(() => {});
    satDynamicMeta.delete(k);
    satDynamicTotal -= meta.size;
  }
}

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
  event.waitUntil((async () => {
    // Drop unmanaged caches.
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('lapuff-') && !MANAGED_CACHES.includes(k))
        .map(k => {
          console.log('[SW] Deleting stale cache:', k);
          return caches.delete(k);
        })
    );
    // One-time cleanup: remove ALL nyc_buildings*.pmtiles entries from full-file cache
    // (Stage 1 OOM fix: buildings no longer use full-file slice path).
    try {
      const fullCache = await caches.open(PMTILES_FULL_CACHE);
      const reqs = await fullCache.keys();
      for (const r of reqs) {
        if (r.url.includes('nyc_buildings')) {
          await fullCache.delete(r);
          console.log('[SW] Evicted full-file building entry (Stage 1 fix):', r.url);
        }
      }
    } catch (e) { /* ignore */ }
  })());
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

// Cache-first satellite tile handler — two-bucket routing by zoom level.
// z9–z14 → persistent bucket (never evicted unless overflow). z15–z16 → dynamic bucket + overflow.
async function handleSatellite(request) {
  const zoom = extractSatZoom(request.url);
  const isPersistentZoom = zoom >= 0 && zoom <= 14;

  if (isPersistentZoom) {
    // z9–z14: serve from persistent bucket.
    const cache = await caches.open(SATELLITE_PERSISTENT_CACHE);
    const hit = await cache.match(request.url);
    if (hit && hit.ok) {
      const meta = satPersistentMeta.get(request.url);
      if (meta) meta.lastAccess = Date.now();
      return hit;
    }
    try {
      const resp = await fetch(request);
      if (resp && resp.ok) {
        const cl = parseInt(resp.headers.get('content-length') || '25000', 10);
        const sz = isNaN(cl) ? 25000 : cl;
        // Evict overflow entries to make room if needed (z9–z14 always takes priority).
        if (satPersistentTotal + sz > SAT_PERSISTENT_CAP) {
          await evictSatPersistentOverflows(cache, (satPersistentTotal + sz) - SAT_PERSISTENT_CAP * 0.95);
        }
        cache.put(request.url, resp.clone()).then(() => {
          satPersistentMeta.set(request.url, { size: sz, zoom, isOverflow: false, lastAccess: Date.now() });
          satPersistentTotal += sz;
        }).catch(() => {});
      }
      return resp;
    } catch (_err) {
      return new Response('', { status: 504 });
    }
  } else {
    // z15–z16: check dynamic bucket, then check persistent overflow.
    const dynCache = await caches.open(SATELLITE_DYNAMIC_CACHE);
    const dynHit = await dynCache.match(request.url);
    if (dynHit && dynHit.ok) {
      const meta = satDynamicMeta.get(request.url);
      if (meta) meta.lastAccess = Date.now();
      return dynHit;
    }
    const perCache = await caches.open(SATELLITE_PERSISTENT_CACHE);
    const perHit = await perCache.match(request.url);
    if (perHit && perHit.ok) {
      const meta = satPersistentMeta.get(request.url);
      if (meta) meta.lastAccess = Date.now();
      return perHit;
    }
    try {
      const resp = await fetch(request);
      if (resp && resp.ok) {
        const cl = parseInt(resp.headers.get('content-length') || '25000', 10);
        const sz = isNaN(cl) ? 25000 : cl;
        // Try persistent overflow first — use spare capacity beyond z9–z14 fill (~54MB typical).
        const persistentHeadroom = SAT_PERSISTENT_CAP - (satPersistentTotal - satPersistentOverflowTotal);
        if (persistentHeadroom >= sz) {
          perCache.put(request.url, resp.clone()).then(() => {
            satPersistentMeta.set(request.url, { size: sz, zoom, isOverflow: true, lastAccess: Date.now() });
            satPersistentTotal        += sz;
            satPersistentOverflowTotal += sz;
          }).catch(() => {});
        } else {
          // No persistent overflow room — use dynamic bucket.
          if (satDynamicTotal + sz > SAT_DYNAMIC_CAP) {
            await evictSatDynamic(dynCache);
          }
          dynCache.put(request.url, resp.clone()).then(() => {
            satDynamicMeta.set(request.url, { size: sz, lastAccess: Date.now() });
            satDynamicTotal += sz;
          }).catch(() => {});
        }
      }
      return resp;
    } catch (_err) {
      return new Response('', { status: 504 });
    }
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
  // Strategy: check in-memory ArrayBuffer first (roads only), then SW Cache full-file (roads only),
  // else per-Range cache (buildings + roads fallback).
  const url = new URL(request.url);
  const isFullCandidate = FULL_PMTILES_URL_PATTERNS.some(p => url.href.includes(p));
  const isBuildings = url.href.includes('nyc_buildings');

  if (isFullCandidate) {
    try {
      const cacheKey = url.origin + url.pathname;
      // Prefer in-memory ArrayBuffer — zero alloc per Range slice.
      let ab = inMemoryFullBuffers.get(cacheKey);
      if (!ab) {
        const fullCache = await caches.open(PMTILES_FULL_CACHE);
        const fullHit = await fullCache.match(cacheKey);
        if (fullHit) {
          // Allocate ONCE per SW lifetime, then keep the ArrayBuffer reference for all future Range slices.
          ab = await fullHit.arrayBuffer();
          inMemoryFullBuffers.set(cacheKey, ab);
        }
      }
      if (ab) {
        const range = request.headers.get('range');
        if (!range) return new Response(ab.slice(0), { status: 200 });
        const m = /bytes=(\d+)-(\d+)?/.exec(range);
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : -1;
          const total = ab.byteLength;
          const realEnd = end >= 0 ? Math.min(end, total - 1) : total - 1;
          // Slice creates a small copy (typical Range = 16KB-512KB) — no full-file re-alloc.
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

  // Per-Range cache keyed by URL + Range header. Used by buildings (always) and roads (cold cache).
  const rangeHeader = request.headers.get('range') || '';
  const compositeKey = request.url + '||range=' + rangeHeader;
  const cache = await caches.open(PMTILES_CACHE);
  const hit = await cache.match(compositeKey);
  if (hit) {
    if (isBuildings) {
      const meta = buildingsRangeMeta.get(compositeKey);
      if (meta) meta.lastAccess = Date.now();
    }
    return hit;
  }

  try {
    const resp = await fetch(request.clone());
    if (resp.ok || resp.status === 206) {
      cache.put(compositeKey, resp.clone()).then(async () => {
        if (isBuildings) {
          try {
            const cl = parseInt(resp.headers.get('content-length') || '0', 10);
            const sz = isNaN(cl) || cl === 0 ? 65536 : cl; // assume 64KB if unknown
            await trackBuildingsRangeWrite(compositeKey, sz);
          } catch (_e) { /* */ }
        }
      }).catch(() => {});
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
        // All precached tiles are z9–z14 — always write to persistent bucket.
        const cache = await caches.open(SATELLITE_PERSISTENT_CACHE);
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
                  // Fetch with CORS (not no-cors) so we get real 200 responses.
                  // Opaque responses (no-cors) are rejected by WebGL texture loader —
                  // MapLibre can't use them as raster tile data.
                  const resp = await fetch(u, { credentials: 'omit' });
                  if (resp && resp.ok) {
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
