// Universal UI shape mode (square / rounded) shared across TileView, GeoPostView,
// MapView topbar, FavoritesPage, CalendarPage. Toggle is only exposed in TileView
// and GeoPostView, but state is global and synced via localStorage + custom event.
//
// Applies these <html> classes when 'square':
//   - lp-square-mode      (legacy GeoPostView CSS hooks)
//   - tv-square-active    (legacy TileView topbar/site CSS hooks)
//   - lp-ui-square        (new universal hook for sub-pages like favorites/calendar)
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lapuff_ui_shape';
const LEGACY_KEYS = ['lapuff_tile_shape', 'lapuff_tileview_shape'];
const EVT = 'lp-ui-shape-changed';

function readInitial() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'square' || v === 'rounded') return v;
    for (const k of LEGACY_KEYS) {
      const lv = localStorage.getItem(k);
      if (lv === 'square' || lv === 'rounded') return lv;
    }
  } catch {}
  return 'rounded';
}

export function applyUIShapeClasses(shape) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (shape === 'square') {
    html.classList.add('lp-square-mode', 'tv-square-active', 'lp-ui-square');
  } else {
    html.classList.remove('lp-square-mode', 'tv-square-active', 'lp-ui-square');
  }
}

export function getUIShape() { return readInitial(); }

export function setUIShape(shape) {
  if (shape !== 'square' && shape !== 'rounded') return;
  try { localStorage.setItem(STORAGE_KEY, shape); } catch {}
  applyUIShapeClasses(shape);
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: shape })); } catch {}
}

export function useUIShape() {
  const [shape, setShape] = useState(readInitial);
  useEffect(() => {
    applyUIShapeClasses(shape);
    try { localStorage.setItem(STORAGE_KEY, shape); } catch {}
  }, [shape]);
  useEffect(() => {
    const onChange = (e) => {
      const v = e?.detail || readInitial();
      if (v === 'square' || v === 'rounded') setShape(v);
    };
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'square' || e.newValue === 'rounded')) {
        setShape(e.newValue);
      }
    };
    window.addEventListener(EVT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const update = (next) => {
    setShape(next);
    try { window.dispatchEvent(new CustomEvent(EVT, { detail: next })); } catch {}
  };
  return [shape, update];
}
