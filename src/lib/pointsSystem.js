// lib/pointsSystem.js
// Clout Points system - Managed via secure RPC to prevent client-side manipulation

const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';

export const POINTS = {
  EVENT_ATTEND_CHECKIN: 300,    // Highest — real-life attendance verified by GPS
  SELF_CHECKIN: 150,            
  ATTENDEE_TO_ORGANIZER: 80,    
  REFERRAL_SUCCESS: 50,         
  SUBMIT_EVENT: 20,             
  EVENT_FAVORITED: 5,           
  HOT_ZONE_BASE: 3,             
  HOT_ZONE_MULTIPLIER_MAX: 8,   
};

/**
 * SECURE POINT AWARDING
 * Checks for a valid, signed-in session before allowing a point trigger.
 * The 'award_clout' function in SQL ensures only the auth.uid() can trigger their own growth,
 * or the Growth Loop trigger (SQL side) handles the Referral recipient.
 */
export async function awardPoints(session, amount, reason) {
  // 1. Fundamental Logic: Only signed-in users can trigger point events
  if (!session?.access_token) {
    console.warn("Points ignored: No active session or unvalidated user.");
    return false;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/award_clout`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      points_to_add: amount, 
      audit_reason: reason 
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    console.error("Clout Grant Failed:", err.message);
    return false;
  }
  return true;
}

/**
 * Roaming Tracker - Only triggers if session is present
 */
export async function processRoamingPoints(session, heatValue) {
  if (!session || !canAwardRoamPoints()) return 0;
  
  const multiplier = 1 + heatValue * (POINTS.HOT_ZONE_MULTIPLIER_MAX - 1);
  const pts = Math.round(POINTS.HOT_ZONE_BASE * multiplier);
  
  // Award via secure RPC
  await awardPoints(session, pts, `Hot zone roaming (heat: ${heatValue.toFixed(2)})`);
  
  recordRoamAward();
  return pts;
}

/**
 * Helper to check if a user is currently eligible for points (Validated & Authenticated)
 */
export function isEligibleForPoints(session) {
  // Checks if user is signed in AND their email is confirmed
  return !!(session?.user && session.user.email_confirmed_at);
}

const ROAM_INTERVAL = 15 * 60 * 1000; 
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