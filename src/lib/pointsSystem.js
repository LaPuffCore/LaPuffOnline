// Clout Points system
// All point values defined here - processed via Supabase RPC or direct REST

const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';

export const POINTS = {
  SELF_CHECKIN: 150,            // Checking in to event yourself
  ATTENDEE_TO_ORGANIZER: 80,    // Per attendee who checks in to your event
  SUBMIT_EVENT: 20,             // Submitting an event
  EVENT_FAVORITED: 5,           // Per favorite on your event
  HOT_ZONE_BASE: 3,             // Points per 15min in any zone
  HOT_ZONE_MULTIPLIER_MAX: 8,   // Max multiplier at full heat (0-1 scale * this)
};

function getHotZonePoints(heatValue) {
  // heatValue: 0-1, scaled by heat reading
  const multiplier = 1 + heatValue * (POINTS.HOT_ZONE_MULTIPLIER_MAX - 1);
  return Math.round(POINTS.HOT_ZONE_BASE * multiplier);
}

// Hot zone roaming tracker (15-min intervals)
const ROAM_INTERVAL = 15 * 60 * 1000; // 15 minutes
const ROAM_STORAGE_KEY = 'lapuff_last_roam_award';
const ROAM_LOC_KEY = 'lapuff_roam_location_history';

export function canAwardRoamPoints() {
  const last = parseInt(localStorage.getItem(ROAM_STORAGE_KEY) || '0');
  return Date.now() - last >= ROAM_INTERVAL;
}

export function recordRoamAward() {
  localStorage.setItem(ROAM_STORAGE_KEY, String(Date.now()));
}

export function recordLocationHistory(loc) {
  const hist = JSON.parse(localStorage.getItem(ROAM_LOC_KEY) || '[]');
  hist.push({ ...loc, ts: Date.now() });
  // Keep last 2 hours
  const cutoff = Date.now() - 2 * 3600 * 1000;
  const trimmed = hist.filter(h => h.ts > cutoff);
  localStorage.setItem(ROAM_LOC_KEY, JSON.stringify(trimmed));
}

export function getLocationHistory() {
  return JSON.parse(localStorage.getItem(ROAM_LOC_KEY) || '[]');
}

// Supabase RPC call to add clout safely
async function callAddCloutRPC(userId, amount, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_clout_to_user`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, points: amount }),
  });
  if (!res.ok) {
    // Fallback: direct update
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=clout_points`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${accessToken}` },
    });
    const profiles = await pRes.json();
    const current = profiles?.[0]?.clout_points || 0;
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ clout_points: current + amount }),
    });
  }
}

export async function awardPoints(session, amount, reason) {
  if (!session?.access_token || !session?.user?.id) return;
  console.log(`Awarding ${amount} clout for: ${reason}`);
  await callAddCloutRPC(session.user.id, amount, session.access_token);
}

export async function awardRoamPoints(session, heatValue) {
  if (!canAwardRoamPoints()) return 0;
  const pts = getHotZonePoints(heatValue);
  await awardPoints(session, pts, `Hot zone roaming (heat: ${heatValue.toFixed(2)})`);
  recordRoamAward();
  return pts;
}

export async function submitEventAttendance(session, eventId, status = 'confirmed') {
  if (!session?.access_token) return;
  await fetch(`${SUPABASE_URL}/rest/v1/event_attendance`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: session.user.id, event_id: eventId, status }),
  });
}

export async function getZipColonists(zip) {
  if (!zip || zip === 'SAFEZONE') return [];
  // Also merge sample users when in sample mode
  const { SAMPLE_MODE } = await import('./sampleConfig');
  const { getSampleUsersForZip } = await import('./sampleUsers');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?home_zip=eq.${zip}&select=username,clout_points,updated_at&order=clout_points.desc`, {
    headers: { 'apikey': SUPABASE_KEY },
  });
  const real = res.ok ? await res.json() : [];
  const samples = getSampleUsersForZip(zip);
  // Merge: real users take priority, samples fill in for demo
  const merged = [...real];
  samples.forEach(s => { if (!merged.find(u => u.username === s.username)) merged.push(s); });
  return merged.sort((a, b) => (b.clout_points || 0) - (a.clout_points || 0));
}