// lib/pointsSystem.js
// Clout Points system - Managed via secure RPC to prevent client-side manipulation

const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';

export const POINTS = {
  EVENT_ATTEND_CHECKIN: 250,         // Highest — real-life attendance verified by GPS
  AFTERS_ATTEND_CHECKIN: 200,        // Afters location check-in — post-event social
  SELF_CHECKIN: 150,                 // Organizer check-in at own event
  REFERRAL_SUCCESS: 50,              // Someone signed up via your referral link
  SUBMIT_EVENT: 50,                  // Awarded when submitted event gets approved
  SUBMITTER_REWARD_PER_CHECKIN: 50,  // Awarded to event creator each time an attendee checks in
  EVENT_FAVORITED: 20,               // When someone favorites your submitted event (one-time)
  GEOPOST_REACTION: 5,               // When a signed-in user reacts to your GeoPost (DB trigger handles award)
  HOT_ZONE_FAVORITE: 5,              // Retroactive points for favorites once in NYC
  HOT_ZONE_BASE: 1,                  // Minimum roam pts (cold zone, every 30 min)
  HOT_ZONE_MAX: 10,                  // Maximum roam pts (hottest zone, every 30 min)
};

/**
 * SECURE POINT AWARDING
 * Policy-driven: auth.uid() is evaluated server-side by award_clout().
 * Uses the ledger to ensure points are ADDITIVE and synced server-side.
 */
export async function awardPoints(session, amount, reason, eventId = null, _unused = null, geopostId = null) {
  if (!session?.access_token) {
    console.warn("Points ignored: No active session or unvalidated user.");
    return false;
  }

  const body = {
    p_amount: amount,
    p_reason: reason,
    ...(eventId    && { p_event_id:   eventId }),
    ...(geopostId  && { p_geopost_id: geopostId }),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/award_clout`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("Clout Grant Failed:", err.message || res.status);
    return false;
  }
  return true;
}

/**
 * Specifically for the Hot Zone / NYC Participant sync
 * Checks if user is in NYC and awards points for new favorites without double-counting.
 */
export async function syncHotZonePoints(session) {
  if (!session?.access_token) return { new_points_total: 0, events_processed: 0 };
  
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_hotzone_points`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: session.user.id }),
    });

    if (!res.ok) throw new Error('HotZone Sync failed');
    const data = await res.json();
    return data[0] || { new_points_total: 0, events_processed: 0 };
  } catch (error) {
    console.error('[PointsSystem] HotZone Sync error:', error);
    return { new_points_total: 0, events_processed: 0 };
  }
}

/**
 * Roaming Tracker — 1-10 pts based on zip heat, throttled to every 30 min.
 */
export async function processRoamingPoints(session, heatValue) {
  if (!session || !canAwardRoamPoints()) return 0;

  // Verify they are actually in NYC before awarding roam points
  if (!isLocalParticipant()) return 0;

  const pts = Math.max(1, Math.round(POINTS.HOT_ZONE_BASE + heatValue * (POINTS.HOT_ZONE_MAX - POINTS.HOT_ZONE_BASE)));

  await awardPoints(session, pts, `Hot zone roaming (heat: ${heatValue.toFixed(2)})`);

  recordRoamAward();
  return pts;
}

export async function checkAndAwardSubmitPoints(session, events) {
  if (!isEligibleForPoints(session)) return;
  const userId = session.user.id;
  const mine = events.filter(e => e.user_id === userId && e.is_approved && !e._auto && !e._sample);
  for (const event of mine) {
    await awardPoints(session, POINTS.SUBMIT_EVENT, `Event Submission: ${event.event_name}`, event.id, 'submit');
  }
}

export function isEligibleForPoints(session) {
  return !!(session?.user && session.user.email_confirmed_at);
}

const ROAM_INTERVAL = 30 * 60 * 1000; 
const ROAM_STORAGE_KEY = 'lapuff_last_roam_award';

function canAwardRoamPoints() {
  const lastAward = localStorage.getItem(ROAM_STORAGE_KEY);
  if (!lastAward) return true;
  return Date.now() - parseInt(lastAward) > ROAM_INTERVAL;
}

function recordRoamAward() {
  localStorage.setItem(ROAM_STORAGE_KEY, Date.now().toString());
}

export async function getReferralCode(session) {
  if (!session?.user?.id) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.user.id}&select=referral_code`, {
    headers: { 'apikey': SUPABASE_KEY },
  });
  if (res.ok) {
    const data = await res.json();
    return data[0]?.referral_code;
  }
  return null;
}

export async function getZipColonists(zip) {
  if (!zip || zip === 'SAFEZONE') return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?home_zip=eq.${zip}&select=username,clout_points,updated_at&order=clout_points.desc`, {
    headers: { 'apikey': SUPABASE_KEY },
  });
  return res.ok ? await res.json() : [];
}

export async function getBoroughColonists(boroughName) {
  const BOROUGH_ZIP_RANGES = {
    'Manhattan':    [10001, 10282],
    'Brooklyn':     [11201, 11256],
    'Queens':       [11004, 11697],
    'Bronx':        [10451, 10475],
    'Staten Island':[10301, 10314],
  };
  const range = BOROUGH_ZIP_RANGES[boroughName];
  if (!range) return [];
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=username,clout_points,updated_at,home_zip&order=clout_points.desc&limit=100`,
    { headers: { 'apikey': SUPABASE_KEY } }
  );
  if (!res.ok) return [];
  const all = await res.json();
  return all.filter(p => {
    const z = parseInt(p.home_zip, 10);
    return !isNaN(z) && z >= range[0] && z <= range[1];
  }).slice(0, 30);
}

export function isLocalParticipant() {
  try {
    const d = JSON.parse(localStorage.getItem('lapuff_nyc_24h'));
    return !!(d && (Date.now() - d.timestamp) < 24 * 3600 * 1000);
  } catch { return false; }
}

const PENDING_REACT_KEY = 'lapuff_pending_react_sync';
const PENDING_FAV_KEY   = 'lapuff_pending_fav_sync';

function _getPendingReacts() {
  try { return JSON.parse(localStorage.getItem(PENDING_REACT_KEY) || '[]'); } catch { return []; }
}

export function addPendingReactSync(postId, emoji) {
  const list = _getPendingReacts();
  const key = `${postId}:${emoji}`;
  if (!list.find(r => `${r.postId}:${r.emoji}` === key)) {
    list.push({ postId, emoji });
    localStorage.setItem(PENDING_REACT_KEY, JSON.stringify(list));
  }
}

export function removePendingReactSync(postId, emoji) {
  const key = `${postId}:${emoji}`;
  const list = _getPendingReacts().filter(r => `${r.postId}:${r.emoji}` !== key);
  localStorage.setItem(PENDING_REACT_KEY, JSON.stringify(list));
}

export async function rewardEventSubmitter(session, eventId) {
  if (!isEligibleForPoints(session) || !eventId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/award_submitter_clout`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target_event_id: eventId,
        clout_amount: POINTS.SUBMITTER_REWARD_PER_CHECKIN,
      }),
    });
  } catch {}
}

export async function syncOrbiterPending(session) {
  if (!isEligibleForPoints(session)) return;

  // 1. Sync pending favorites -> event_favorites
  let pendingFavs;
  try { pendingFavs = JSON.parse(localStorage.getItem(PENDING_FAV_KEY) || '[]'); } catch { pendingFavs = []; }
  for (const eventId of pendingFavs) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/event_favorites`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ user_id: session.user.id, event_id: eventId }),
      });
    } catch {}
  }
  if (pendingFavs.length > 0) localStorage.removeItem(PENDING_FAV_KEY);

  // 2. Sync pending reactions -> post_reactions
  const pendingReacts = _getPendingReacts();
  for (const { postId, emoji } of pendingReacts) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/post_reactions`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ post_id: postId, emoji_text: emoji, user_id: session.user.id }),
      });
    } catch {}
  }
  if (pendingReacts.length > 0) localStorage.removeItem(PENDING_REACT_KEY);

  // 3. SECURE HOTZONE SYNC: Award points for these newly synced favorites via RPC
  await syncHotZonePoints(session);
}