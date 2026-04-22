// lib/pointsSystem.js
// Clout Points system - Managed via secure RPC to prevent client-side manipulation

const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';

export const POINTS = {
  EVENT_ATTEND_CHECKIN: 250,    // Highest — real-life attendance verified by GPS
  AFTERS_ATTEND_CHECKIN: 200,   // Afters location check-in — post-event social
  SELF_CHECKIN: 150,            // Organizer check-in at own event
  REFERRAL_SUCCESS: 50,         // Someone signed up via your referral link
  SUBMIT_EVENT: 50,             // Awarded when submitted event gets approved
  EVENT_FAVORITED: 20,          // When someone favorites your submitted event (one-time)
  HOT_ZONE_BASE: 1,             // Minimum roam pts (cold zone, every 30 min)
  HOT_ZONE_MAX: 10,             // Maximum roam pts (hottest zone, every 30 min)
};

/**
 * SECURE POINT AWARDING
 * Checks for a valid, signed-in session before allowing a point trigger.
 * The 'award_clout' function in SQL ensures only the auth.uid() can trigger their own growth,
 * or the Growth Loop trigger (SQL side) handles the Referral recipient.
 */
/**
 * SECURE POINT AWARDING
 * @param {object} session - auth session with access_token
 * @param {number} amount - points to award
 * @param {string} reason - audit reason string
 * @param {string|null} eventId - optional event UUID for dedup
 * @param {string|null} checkinType - 'main' | 'afters' | null
 */
export async function awardPoints(session, amount, reason, eventId = null, checkinType = null) {
  if (!session?.access_token) {
    console.warn("Points ignored: No active session or unvalidated user.");
    return false;
  }

  const body = {
    p_user_id: session.user.id,
    p_amount: amount,
    p_reason: reason,
    ...(eventId && { p_event_id: eventId }),
    ...(checkinType && { p_checkin_type: checkinType }),
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
 * Roaming Tracker — 1-10 pts based on zip heat, throttled to every 30 min.
 */
export async function processRoamingPoints(session, heatValue) {
  if (!session || !canAwardRoamPoints()) return 0;

  const pts = Math.max(1, Math.round(POINTS.HOT_ZONE_BASE + heatValue * (POINTS.HOT_ZONE_MAX - POINTS.HOT_ZONE_BASE)));

  await awardPoints(session, pts, `Hot zone roaming (heat: ${heatValue.toFixed(2)})`);

  recordRoamAward();
  return pts;
}

/**
 * Check approved events owned by the user and award submit points.
 * Safe to call on every events load — DB unique_clout_award blocks duplicates silently.
 */
export async function checkAndAwardSubmitPoints(session, events) {
  if (!isEligibleForPoints(session)) return;
  const userId = session.user.id;
  const mine = events.filter(e => e.user_id === userId && e.is_approved && !e._auto && !e._sample);
  for (const event of mine) {
    await awardPoints(session, POINTS.SUBMIT_EVENT, `Event Submission: ${event.event_name}`, event.id, 'submit');
  }
}

/**
 * Helper to check if a user is currently eligible for points (Validated & Authenticated)
 */
export function isEligibleForPoints(session) {
  // Checks if user is signed in AND their email is confirmed
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