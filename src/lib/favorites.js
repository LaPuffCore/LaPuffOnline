// @ts-nocheck
// lib/favorites.js
//
// ─── SUPABASE SQL REQUIRED (run once) ────────────────────────────────────────
// See the SQL block provided separately. It creates:
//   - events.fav_count column (universal count)
//   - update_event_fav_count RPC (for anonymous users only)
//   - on_event_favorite_insert trigger (authenticated: increments count + awards points once)
//   - on_event_favorite_delete trigger (authenticated: decrements count only, no points removed)
//   - RLS policies on event_favorites
//
// ─── LOGIC SUMMARY ───────────────────────────────────────────────────────────
//
// NOT signed in:
//   - Favorites stored in localStorage (lapuff_favorites) — powers all local features
//     (filters, calendar, etc.) exactly as before.
//   - Contributes to universal count via update_event_fav_count RPC.
//     lapuff_sb_favs tracks which events this device has synced to prevent
//     double-counting if the user re-favorites after a page refresh.
//   - NO points (points require a confirmed, signed-in session — enforced server-side).
//
// Signed in:
//   - All localStorage behavior above.
//   - Row inserted into event_favorites (user_id + event_id).
//   - Supabase trigger on that INSERT handles BOTH:
//       a) incrementing events.fav_count (server-side, not the RPC)
//       b) awarding 5 points once via clout_ledger check (server-side, uncheateable)
//   - When unfavoriting: row deleted, trigger decrements count only (points stay).
//
// ─────────────────────────────────────────────────────────────────────────────

import { getValidSession, supabase } from './supabaseAuth';

// ─── ORIGINAL KEYS (all preserved) ───────────────────────────────────────────
const FAVS_KEY    = 'lapuff_favorites';
const COUNTS_KEY  = 'lapuff_fav_counts';
const HISTORY_KEY = 'lapuff_fav_history';
const SB_SYNC_VERSION_KEY = 'lapuff_sb_favs_version';
const SB_SYNC_VERSION = '2';

// Tracks which event IDs this anonymous device has already contributed to
// events.fav_count in Supabase. Only used for non-authenticated users.
const SB_FAVS_KEY = 'lapuff_sb_favs';

function normalizeEventId(eventId) {
  return String(eventId);
}

function migrateAnonymousSyncState() {
  const version = localStorage.getItem(SB_SYNC_VERSION_KEY);
  if (version === SB_SYNC_VERSION) return;

  // Previous client versions could mark anon favorites as synced even when
  // the remote write failed. Reset that marker once so current favorites can
  // repopulate the universal counter correctly after deployment.
  localStorage.removeItem(SB_FAVS_KEY);
  localStorage.setItem(SB_SYNC_VERSION_KEY, SB_SYNC_VERSION);
}

// ─── ORIGINAL LOCAL HELPERS (preserved exactly) ──────────────────────────────

export function getFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeEventId) : [];
  } catch {
    return [];
  }
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
  const cutoff = Date.now() - 24 * 3600 * 1000;
  h[eventId] = h[eventId].filter(x => x.t > cutoff);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

const trendByEventId = new Map();

function resolveTrendFromThreshold(count, threshold) {
  const c = Number(count ?? 0);
  const t = Number(threshold ?? 0);

  // Until SQL migration is live, threshold may be null/0 for all events.
  if (!Number.isFinite(t) || t <= 0) return 'neutral';
  if (c >= t) return 'up';
  if (c >= t - 4) return 'neutral';
  return 'down';
}

function updateTrendCache(eventId, count, threshold) {
  const id = normalizeEventId(eventId);
  const trend = resolveTrendFromThreshold(count, threshold);
  trendByEventId.set(id, trend);
  return trend;
}

function isLikelyUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function fetchEventCountAndTrendThreshold(id) {
  const withThreshold = await supabase
    .from('events')
    .select('fav_count,trend_threshold_count')
    .eq('id', id)
    .single();

  if (!withThreshold.error) {
    return {
      favCount: withThreshold.data?.fav_count ?? 0,
      trendThreshold: withThreshold.data?.trend_threshold_count ?? 0,
    };
  }

  // Backward compatibility while SQL migration is pending.
  const fallback = await supabase
    .from('events')
    .select('fav_count')
    .eq('id', id)
    .single();

  if (fallback.error) throw fallback.error;

  return {
    favCount: fallback.data?.fav_count ?? 0,
    trendThreshold: 0,
  };
}

// ─── ANONYMOUS SUPABASE CONTRIBUTION TRACKER ─────────────────────────────────

function getSbFavs() {
  migrateAnonymousSyncState();
  try { return new Set(JSON.parse(localStorage.getItem(SB_FAVS_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveSbFavs(set) {
  localStorage.setItem(SB_FAVS_KEY, JSON.stringify([...set]));
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────

export async function toggleFavorite(eventId) {
  const id = normalizeEventId(eventId);
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  const adding = idx === -1;

  // ── 1. ORIGINAL LOCAL UPDATE (unchanged) ──────────────────────────────────
  if (adding) favs.push(id); else favs.splice(idx, 1);
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs));

  const counts = getCounts();
  counts[id] = Math.max(0, (counts[id] || 0) + (adding ? 1 : -1));
  localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));

  recordActivity(id, adding ? 1 : -1);

  // Broadcast immediately for instant tile/popup UI update
  window.dispatchEvent(new Event('favoritesChanged'));

  // ── 2. SUPABASE SYNC ───────────────────────────────────────────────────────
  try {
    const session = await getValidSession();
    const userId = session?.user?.id ?? null;

    if (userId) {
      // ── AUTHENTICATED ──────────────────────────────────────────────────────
      // The Supabase trigger on event_favorites handles EVERYTHING server-side:
      //   - INSERT trigger: increments events.fav_count + awards points (once, via clout_ledger)
      //   - DELETE trigger: decrements events.fav_count (no points removed)
      // We do NOT call update_event_fav_count RPC here — the trigger does it.
      if (adding) {
        const { error } = await supabase
          .from('event_favorites')
          .upsert(
            { user_id: userId, event_id: id },
            { onConflict: 'user_id,event_id', ignoreDuplicates: true }
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('event_favorites')
          .delete()
          .match({ user_id: userId, event_id: id });
        if (error) throw error;
      }
    } else {
      // ── ANONYMOUS ──────────────────────────────────────────────────────────
      // Cannot write to event_favorites (user_id NOT NULL).
      // Contribute to universal count via RPC only. No points.
      // lapuff_sb_favs prevents double-counting on page refresh.
      const sbFavs = getSbFavs();
      const alreadyContributed = sbFavs.has(id);

      if (adding && !alreadyContributed) {
        const { error } = await supabase.rpc('update_event_fav_count', { p_event_id: id, p_delta: 1 });
        if (error) throw error;
        sbFavs.add(id);
        saveSbFavs(sbFavs);
      } else if (!adding && alreadyContributed) {
        const { error } = await supabase.rpc('update_event_fav_count', { p_event_id: id, p_delta: -1 });
        if (error) throw error;
        sbFavs.delete(id);
        saveSbFavs(sbFavs);
      }
    }
  } catch (error) {
    // Network/RLS error: local state is already updated, don't revert UX
    console.warn(`toggleFavorite sync error for ${id}:`, error?.message || error);
  }

  // Broadcast again after Supabase confirms so counts refresh
  window.dispatchEvent(new Event('favoritesChanged'));

  return adding;
}

// ─── IS FAVORITE (sync, unchanged) ───────────────────────────────────────────

export function isFavorite(eventId) {
  return getFavorites().includes(normalizeEventId(eventId));
}

// ─── FAVORITE COUNT (async — reads events.fav_count for universal total) ──────
// events.fav_count includes both anonymous and authenticated contributions.
// IMPORTANT: No fallback to localStorage — if Supabase fails, we need to know about it.

export async function getFavoriteCount(eventId) {
  const id = normalizeEventId(eventId);
  // Use localStorage count as a floor so the UI never shows less than what
  // this device has already contributed (handles trigger lag / RLS issues).
  const localCount = getCounts()[id] ?? 0;

  try {
    const { favCount, trendThreshold } = await fetchEventCountAndTrendThreshold(id);

    // Universal count must be at least as large as local contribution
    const resolvedCount = Math.max(favCount, localCount);
    updateTrendCache(id, resolvedCount, trendThreshold);
    return resolvedCount;
  } catch (error) {
    console.warn(`getFavoriteCount exception for ${eventId}:`, error);
    return localCount;
  }
}

// ─── REAL-TIME FAVORITE COUNT SUBSCRIPTION ────────────────────────────────────
// Allows EventTile / EventDetailPopup to listen for cross-device fav_count changes.
// Subscription persists across page but auto-unsubscribes when all listeners removed.

const favCountSubscriptions = new Map(); // eventId -> { unsubscribe, callback }

export function subscribeToFavoriteCount(eventId, callback) {
  const id = normalizeEventId(eventId);
  
  // Reuse existing subscription if present
  if (favCountSubscriptions.has(id)) {
    const existing = favCountSubscriptions.get(id);
    existing.callbacks = existing.callbacks || [];
    existing.callbacks.push(callback);
    return () => {
      existing.callbacks = existing.callbacks.filter(cb => cb !== callback);
      if (existing.callbacks.length === 0) {
        existing.unsubscribe?.();
        favCountSubscriptions.delete(id);
      }
    };
  }

  // Create new real-time subscription
  const subscription = supabase
    .channel(`fav-count:${id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'events', filter: `id=eq.${id}` },
      (payload) => {
        const nextCount = payload.new?.fav_count ?? 0;
        const trendThreshold = payload.new?.trend_threshold_count ?? 0;
        updateTrendCache(id, nextCount, trendThreshold);
        // Broadcast to all listeners for this event
        const entry = favCountSubscriptions.get(id);
        if (entry?.callbacks) {
          entry.callbacks.forEach(cb => {
            try { cb(nextCount); } catch (e) { console.warn('Subscription callback error:', e); }
          });
        }
      }
    )
    .subscribe((status) => {
      if (status === 'CLOSED') favCountSubscriptions.delete(id);
    });

  favCountSubscriptions.set(id, { 
    unsubscribe: () => supabase.removeChannel(subscription),
    callbacks: [callback]
  });

  // Return unsubscribe function
  return () => {
    const entry = favCountSubscriptions.get(id);
    if (!entry) return;
    entry.callbacks = entry.callbacks?.filter(cb => cb !== callback) ?? [];
    if (entry.callbacks.length === 0) {
      supabase.removeChannel(subscription);
      favCountSubscriptions.delete(id);
    }
  };
}

// ─── FAV TREND (sync — universal threshold model from Supabase) ───────

export function getFavTrend(eventId) {
  const id = normalizeEventId(eventId);
  return trendByEventId.get(id) || 'neutral';
}

// ─── BATCH TREND (for TileView filter — uses universal threshold model) ──────────────────
// Consistent with getFavTrend; hydrates trend cache from Supabase in bulk.

export async function getFavTrendsForEvents(eventIds) {
  if (!eventIds || !eventIds.length) return {};
  const ids = eventIds.map(normalizeEventId);

  const uuidIds = ids.filter(isLikelyUuid);
  if (uuidIds.length) {
    try {
      const withThreshold = await supabase
        .from('events')
        .select('id,fav_count,trend_threshold_count')
        .in('id', uuidIds);

      if (!withThreshold.error) {
        (withThreshold.data || []).forEach((row) => {
          updateTrendCache(row.id, row.fav_count ?? 0, row.trend_threshold_count ?? 0);
        });
      } else {
        // Backward compatibility while SQL migration is pending.
        const fallback = await supabase
          .from('events')
          .select('id,fav_count')
          .in('id', uuidIds);
        if (!fallback.error) {
          (fallback.data || []).forEach((row) => {
            updateTrendCache(row.id, row.fav_count ?? 0, 0);
          });
        }
      }
    } catch (error) {
      console.warn('getFavTrendsForEvents error:', error?.message || error);
    }
  }

  return Object.fromEntries(ids.map((id) => [id, getFavTrend(id)]));
}
