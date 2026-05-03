import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { applyUIShapeClasses, getUIShape } from '@/lib/uiMode'

// Apply universal UI shape (square/rounded) at boot so all views (MapView topbar,
// FavoritesPage, CalendarPage) reflect it without requiring TileView/GeoPostView mount.
applyUIShapeClasses(getUIShape());

// All map data (FGB borough buildings, PMTiles roads, water) is loaded inside
// MapLoadingScreen (Phase 2A) — no idle prefetch competes with the TileView UI thread.
// The service worker (registered below) caches everything so repeat visits are instant.

// ── Service Worker registration ──────────────────────────────────────────────
// SW intercepts .fgb and .pmtiles fetch requests → serves from cache on repeat visits.
// Registered after app render so it never delays first paint.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(
      import.meta.env.BASE_URL + 'sw.js',
      { scope: import.meta.env.BASE_URL }
    ).then(reg => {
      console.log('[SW] Registered, scope:', reg.scope);
    }).catch(err => {
      console.warn('[SW] Registration failed (non-fatal):', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
