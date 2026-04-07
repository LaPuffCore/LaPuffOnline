const FAVS_KEY = 'lapuff_favorites';
const COUNTS_KEY = 'lapuff_fav_counts';
const HISTORY_KEY = 'lapuff_fav_history';

export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]'); } catch { return []; }
}

function getCounts() {
  try { return JSON.parse(localStorage.getItem(COUNTS_KEY) || '{}'); } catch { return {}; }
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch { return {}; }
}

function recordActivity(eventId, delta) {
  const h = getHistory();
  if (!h[eventId]) h[eventId] = [];
  h[eventId].push({ d: delta, t: Date.now() });
  // Keep only last 24h
  const cutoff = Date.now() - 24 * 3600 * 1000;
  h[eventId] = h[eventId].filter(x => x.t > cutoff);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

export function toggleFavorite(eventId) {
  const favs = getFavorites();
  const idx = favs.indexOf(eventId);
  const adding = idx === -1;
  if (adding) favs.push(eventId); else favs.splice(idx, 1);
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs));

  const counts = getCounts();
  counts[eventId] = Math.max(0, (counts[eventId] || 0) + (adding ? 1 : -1));
  localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));

  recordActivity(eventId, adding ? 1 : -1);
  return adding;
}

export function isFavorite(eventId) {
  return getFavorites().includes(eventId);
}

export function getFavoriteCount(eventId) {
  return getCounts()[eventId] || 0;
}

// Returns 'up' | 'down' | 'neutral' based on net activity in last 6h
export function getFavTrend(eventId) {
  const h = getHistory();
  const cutoff = Date.now() - 6 * 3600 * 1000;
  const delta = (h[eventId] || []).filter(x => x.t > cutoff).reduce((sum, x) => sum + x.d, 0);
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
}