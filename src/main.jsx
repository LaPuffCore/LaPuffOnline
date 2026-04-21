import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Gear 1 — Global Idle Preloader: silently cache the raw FGB bytes while the user browses.
// Uses requestIdleCallback so it never competes with the UI thread.
// This stages the heavy network download before the user even opens the map.
// Zero JS heap impact — only writes raw bytes to Cache API (browser storage).
const FGB_CACHE_NAME = 'lapuff-fgb-v4';
const FGB_CACHE_KEY  = 'final_building.fgb';
const FGB_URL        = './data/final_building.fgb';
function scheduleGlobalFGBPrefetch() {
  if (!('caches' in window)) return;
  const run = async () => {
    try {
      const cache = await caches.open(FGB_CACHE_NAME);
      const hit = await cache.match(FGB_CACHE_KEY);
      if (hit) return; // already cached — nothing to do
      const resp = await fetch(FGB_URL);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      await cache.put(FGB_CACHE_KEY, new Response(buf.slice(0), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
      console.log('[FGB] Global idle prefetch complete — raw bytes cached');
    } catch (e) { /* silent — map will handle it on entry */ }
  };
  if ('requestIdleCallback' in window) {
    // Delay 3 seconds so the initial page render is completely settled first
    setTimeout(() => requestIdleCallback(run, { timeout: 15000 }), 3000);
  } else {
    // Fallback: defer 8 seconds for environments without rIC
    setTimeout(run, 8000);
  }
}
scheduleGlobalFGBPrefetch();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
