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

import { supabase } from './supabaseAuth';

// ─── ORIGINAL KEYS (all preserved) ───────────────────────────────────────────
const FAVS_KEY    = 'lapuff_favorites';
const COUNTS_KEY  = 'lapuff_fav_counts';
const HISTORY_KEY = 'lapuff_fav_history';

// Tracks which event IDs this anonymous device has already contributed to
// events.fav_count in Supabase. Only used for non-authenticated users.
const SB_FAVS_KEY = 'lapuff_sb_favs';

// ─── ORIGINAL LOCAL HELPERS (preserved exactly) ──────────────────────────────

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
  const cutoff = Date.now() - 24 * 3600 * 1000;
  h[eventId] = h[eventId].filter(x => x.t > cutoff);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

// ─── ANONYMOUS SUPABASE CONTRIBUTION TRACKER ─────────────────────────────────

function getSbFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(SB_FAVS_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveSbFavs(set) {
  localStorage.setItem(SB_FAVS_KEY, JSON.stringify([...set]));
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────

export async function toggleFavorite(eventId) {
  const id = String(eventId);
  const favs = getFavorites();
  const idx = favs.indexOf(eventId);
  const adding = idx === -1;

  // ── 1. ORIGINAL LOCAL UPDATE (unchanged) ──────────────────────────────────
  if (adding) favs.push(eventId); else favs.splice(idx, 1);
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs));

  const counts = getCounts();
  counts[eventId] = Math.max(0, (counts[eventId] || 0) + (adding ? 1 : -1));
  localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));

  recordActivity(eventId, adding ? 1 : -1);

  // Broadcast immediately for instant tile/popup UI update
  window.dispatchEvent(new Event('favoritesChanged'));

  // ── 2. SUPABASE SYNC ───────────────────────────────────────────────────────
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;

    if (userId) {
      // ── AUTHENTICATED ──────────────────────────────────────────────────────
      // The Supabase trigger on event_favorites handles EVERYTHING server-side:
      //   - INSERT trigger: increments events.fav_count + awards points (once, via clout_ledger)
      //   - DELETE trigger: decrements events.fav_count (no points removed)
      // We do NOT call update_event_fav_count RPC here — the trigger does it.
      if (adding) {
        await supabase
          .from('event_favorites')
          .upsert(
            { user_id: userId, event_id: id },
            { onConflict: 'user_id,event_id', ignoreDuplicates: true }
          );
      } else {
        await supabase
          .from('event_favorites')
          .delete()
          .match({ user_id: userId, event_id: id });
      }
    } else {
      // ── ANONYMOUS ──────────────────────────────────────────────────────────
      // Cannot write to event_favorites (user_id NOT NULL).
      // Contribute to universal count via RPC only. No points.
      // lapuff_sb_favs prevents double-counting on page refresh.
      const sbFavs = getSbFavs();
      const alreadyContributed = sbFavs.has(id);

      if (adding && !alreadyContributed) {
        await supabase.rpc('update_event_fav_count', { p_event_id: id, p_delta: 1 });
        sbFavs.add(id);
        saveSbFavs(sbFavs);
      } else if (!adding && alreadyContributed) {
        await supabase.rpc('update_event_fav_count', { p_event_id: id, p_delta: -1 });
        sbFavs.delete(id);
        saveSbFavs(sbFavs);
      }
    }
  } catch {
    // Network/RLS error: local state is already updated, don't revert UX
  }

  // Broadcast again after Supabase confirms so counts refresh
  window.dispatchEvent(new Event('favoritesChanged'));

  return adding;
}

// ─── IS FAVORITE (sync, unchanged) ───────────────────────────────────────────

export function isFavorite(eventId) {
  return getFavorites().includes(eventId);
}

// ─── FAVORITE COUNT (async — reads events.fav_count for universal total) ──────
// events.fav_count includes both anonymous and authenticated contributions.

export async function getFavoriteCount(eventId) {
  try {
    const { data } = await supabase
      .from('events')
      .select('fav_count')
      .eq('id', String(eventId))
      .single();
    return data?.fav_count ?? 0;
  } catch {
    return getCounts()[eventId] || 0;
  }
}

// ─── FAV TREND (sync, unchanged — local history, fast for tile display) ───────

export function getFavTrend(eventId) {
  const h = getHistory();
  const cutoff = Date.now() - 6 * 3600 * 1000;
  const delta = (h[eventId] || []).filter(x => x.t > cutoff).reduce((sum, x) => sum + x.d, 0);
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
}

// ─── BATCH TREND (for TileView filter — uses local history) ──────────────────
// event_favorites has no created_at column so trends use lapuff_fav_history.
// Consistent with getFavTrend; no extra Supabase queries needed.

export async function getFavTrendsForEvents(eventIds) {
  if (!eventIds || !eventIds.length) return {};
  return Object.fromEntries(eventIds.map(id => [id, getFavTrend(id)]));
}
