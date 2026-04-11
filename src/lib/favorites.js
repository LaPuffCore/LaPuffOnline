// @ts-nocheck
// lib/favorites.js
//
// ─── SUPABASE SQL REQUIRED (run once) ────────────────────────────────────────
// Run SQL_SCHEMA_SETUP.sql in Supabase console. It creates:
//   - events.fav_count column (universal count)
//   - favorite_point_contributions table (tracks user→event point contributions)
//   - update_event_fav_count RPC (for anonymous users only)
//   - award_points_for_active_favorites RPC (called when user becomes participant)
//   - on_event_favorite_insert trigger (authenticated: increments count only)
//   - on_event_favorite_delete trigger (authenticated: decrements count only)
//   - RLS policies on favorite_point_contributions & event_favorites
//
// ─── LOGIC SUMMARY ───────────────────────────────────────────────────────────
//
// NOT signed in:
//   - Favorites stored in localStorage (lapuff_favorites) — powers all local features
//     (filters, calendar, etc.) exactly as before.
//   - Contributes to universal count via update_event_fav_count RPC.
//     lapuff_sb_favs tracks which events this device has synced to prevent
//     double-counting if the user re-favorites after a page refresh.
//   - NO points (points require signed-in + participant state — enforced server-side).
//
// Signed in but not participant (orbiter):
//   - All localStorage behavior above.
//   - Row inserted into event_favorites (user_id + event_id).
//   - Trigger increments events.fav_count only (NO points awarded yet).
//   - User can favorite/unfavorite freely without triggering point contributions.
//
// Signed in AND participant (verified NYC location in last 24h):
//   - When user syncs participant status via ParticipantDot:
//     1. pingNYCLocation() returns inNYC=true
//     2. awardPointsForActiveFavorites() RPC is called
//     3. For each favorite user has, if they haven't already contributed points to
//        that event (via favorite_point_contributions table), we:
//        - Insert into favorite_point_contributions to mark contribution
//        - Award 5 points via clout_ledger
//   - This means favoriting before becoming participant doesn't "waste" the
//     one-time contribution — it only counts when you transition to active state.
//   - Unfavoriting before becoming participant doesn't prevent point attribution.
//   - Each user → event gets points exactly once.
//
// ─────────────────────────────────────────────────────────────────────────────

import { getValidSession, supabase } from './supabaseAuth';

// ─── ORIGINAL KEYS (all preserved) ───────────────────────────────────────────
const FAVS_KEY    = 'lapuff_favorites';
const COUNTS_KEY  = 'lapuff_fav_counts';
const HISTORY_KEY = 'lapuff_fav_history';
const FAV_EVENT_CACHE_KEY = 'lapuff_favorite_event_cache';
const MAX_FAVORITE_EVENT_CACHE = 240;
const SB_SYNC_VERSION_KEY = 'lapuff_sb_favs_version';
const SB_SYNC_VERSION = '2';

// Tracks which event IDs this anonymous device has already contributed to
// events.fav_count in Supabase. Only used for non-authenticated users.
const SB_FAVS_KEY = 'lapuff_sb_favs';

function normalizeEventId(eventId) {
  return String(eventId);
}

function sanitizeFavoriteEventSnapshot(event) {
  if (!event || !event.id) return null;
  return {
    id: normalizeEventId(event.id),
    event_name: event.event_name || '',
    event_date: event.event_date || null,
    event_time_utc: event.event_time_utc || null,
    hex_color: event.hex_color || null,
    representative_emoji: event.representative_emoji || null,
    description: event.description || null,
    price_category: event.price_category || null,
    location_data: event.location_data || {},
    photos: Array.isArray(event.photos) ? event.photos : [],
    tags: Array.isArray(event.tags) ? event.tags : [],
    relevant_links: Array.isArray(event.relevant_links) ? event.relevant_links : [],
    source: event.source || null,
    cachedAt: Date.now(),
  };
}

function getFavoriteEventCacheMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAV_EVENT_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveFavoriteEventCacheMap(map) {
  localStorage.setItem(FAV_EVENT_CACHE_KEY, JSON.stringify(map));
}

function pruneFavoriteEventCacheMap(map, maxSize = MAX_FAVORITE_EVENT_CACHE) {
  const entries = Object.entries(map || {});
  if (entries.length <= maxSize) return map;

  const favoriteIds = new Set(getFavorites().map(normalizeEventId));
  const favoriteEntries = [];
  const nonFavoriteEntries = [];

  entries.forEach(([id, value]) => {
    if (favoriteIds.has(normalizeEventId(id))) favoriteEntries.push([id, value]);
    else nonFavoriteEntries.push([id, value]);
  });

  // Keep non-favorites by recency after preserving all favorited snapshots.
  nonFavoriteEntries.sort((a, b) => (b?.[1]?.cachedAt || 0) - (a?.[1]?.cachedAt || 0));
  const keepNonFav = Math.max(0, maxSize - favoriteEntries.length);

  return Object.fromEntries([...favoriteEntries, ...nonFavoriteEntries.slice(0, keepNonFav)]);
}

export function cacheFavoriteEvent(event) {
  const snapshot = sanitizeFavoriteEventSnapshot(event);
  if (!snapshot) return;
  const cache = getFavoriteEventCacheMap();
  cache[snapshot.id] = snapshot;
  saveFavoriteEventCacheMap(pruneFavoriteEventCacheMap(cache));
}

export function removeCachedFavoriteEvent(eventId) {
  const id = normalizeEventId(eventId);
  const cache = getFavoriteEventCacheMap();
  if (!(id in cache)) return;
  delete cache[id];
  saveFavoriteEventCacheMap(cache);
}

export function hydrateFavoriteEventCache(events = []) {
  const favSet = new Set(getFavorites().map(normalizeEventId));
  if (!favSet.size || !Array.isArray(events) || !events.length) return;

  const cache = getFavoriteEventCacheMap();
  let changed = false;

  events.forEach((event) => {
    const id = normalizeEventId(event?.id);
    if (!id || !favSet.has(id)) return;
    const snapshot = sanitizeFavoriteEventSnapshot(event);
    if (!snapshot) return;
    cache[id] = snapshot;
    changed = true;
  });

  if (changed) saveFavoriteEventCacheMap(pruneFavoriteEventCacheMap(cache));
}

export function getCachedFavoriteEvents() {
  const cache = getFavoriteEventCacheMap();
  const favSet = new Set(getFavorites().map(normalizeEventId));
  return Object.values(cache).filter((event) => favSet.has(normalizeEventId(event.id)));
}

export function mergeFavoriteEventsWithCache(events = []) {
  const liveMap = new Map((Array.isArray(events) ? events : []).map((event) => [normalizeEventId(event.id), event]));
  const favIds = [...new Set(getFavorites().map(normalizeEventId))]; // deduplicate IDs
  const cache = getFavoriteEventCacheMap();

  return favIds
    .map((id) => liveMap.get(id) || cache[id])
    .filter(Boolean);
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
    const arr = Array.isArray(parsed) ? parsed.map(normalizeEventId) : [];
    // Deduplicate to prevent double entries in local storage
    return [...new Set(arr)];
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

  // Default freshly created events start at threshold 0. The first favorite
  // should therefore show green because 1 is above the previous 12h peak of 0.
  if (!Number.isFinite(t) || t <= 0) return c > 0 ? 'up' : 'neutral';
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

/**
 * Detect whether an event is auto-scraped (from auto_events table).
 * First checks the provided snapshot, then falls back to the local event cache.
 * Auto events must not write to event_favorites (FK references events.id only).
 */
function isAutoEvent(id, snapshot = null) {
  if (snapshot?._auto) return true;
  const cache = getFavoriteEventCacheMap();
  return !!(cache[id]?._auto);
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

export async function toggleFavorite(eventId, eventSnapshot = null) {
  const id = normalizeEventId(eventId);
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  const adding = idx === -1;

  // ── 1. ORIGINAL LOCAL UPDATE (unchanged) ──────────────────────────────────
  if (adding) favs.push(id); else favs.splice(idx, 1);
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs));

  if (adding && eventSnapshot) {
    cacheFavoriteEvent(eventSnapshot);
  }
  if (!adding) {
    removeCachedFavoriteEvent(id);
  }

  const counts = getCounts();
  counts[id] = Math.max(0, (counts[id] || 0) + (adding ? 1 : -1));
  localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));

  recordActivity(id, adding ? 1 : -1);

  // Broadcast immediately for instant tile/popup UI update
  window.dispatchEvent(new Event('favoritesChanged'));

  // ── 2. SUPABASE SYNC ───────────────────────────────────────────────────────
  // Auto-scraped events (_auto:true) live in auto_events table, not events.
  // event_favorites has a FK → events.id so skip DB sync for them entirely.
  // Local star/count still works perfectly for auto events.
  if (isAutoEvent(id, eventSnapshot)) {
    return adding;
  }

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
