// @ts-nocheck
// Location service — PING ONLY (no continuous tracking)
// Location is only accessed when:
//   A. User clicks the location / center button on the map
//   B. User checks into an event
// It is NOT continuously tracked and turns off when the session ends.

const LOC_CONSENT_KEY = 'lapuff_loc_consent';
const LOC_CACHE_KEY = 'lapuff_last_loc';
const NYC_24H_KEY = 'lapuff_nyc_24h';

// NYC geographic bounding box
const NYC = { minLat: 40.47, maxLat: 40.93, minLng: -74.27, maxLng: -73.68 };

let lastLocation = null;

export function hasLocationConsent() {
  return localStorage.getItem(LOC_CONSENT_KEY) === 'granted';
}

export function setLocationConsent(granted) {
  localStorage.setItem(LOC_CONSENT_KEY, granted ? 'granted' : 'denied');
}

function getCached() {
  try { return JSON.parse(localStorage.getItem(LOC_CACHE_KEY)); } catch { return null; }
}

/** @param {any} loc */
function cache(loc) {
  localStorage.setItem(LOC_CACHE_KEY, JSON.stringify({ ...loc, cachedAt: Date.now() }));
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isInNYC(lat, lng) {
  return lat >= NYC.minLat && lat <= NYC.maxLat && lng >= NYC.minLng && lng <= NYC.maxLng;
}

// Single location ping (no continuous watch)
export async function pingLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        // Spoofing check: impossible speed
        const prev = lastLocation || getCached();
        if (prev?.lat) {
          const dist = haversine(prev.lat, prev.lng, loc.lat, loc.lng);
          const dt = Math.max((loc.timestamp - (prev.timestamp || Date.now() - 5000)) / 1000, 1);
          if (dist / dt > 55) { reject(new Error('Impossible speed detected')); return; }
        }
        lastLocation = loc;
        cache(loc);
        setLocationConsent(true);
        resolve(loc);
      },
      err => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

// Ping + NYC check — updates 24hr participant status if in NYC
export async function pingNYCLocation() {
  const loc = await pingLocation();
  const inNYC = isInNYC(loc.lat, loc.lng);
  if (inNYC) {
    localStorage.setItem(NYC_24H_KEY, JSON.stringify({ timestamp: Date.now(), lat: loc.lat, lng: loc.lng }));
  }
  return { ...loc, inNYC };
}

/**
 * Check if user has a valid NYC ping in the last 24 hours
 * Returns 'participant' if verified in NYC, otherwise 'orbiter'
 */
export function getNYCParticipantStatus() {
  try {
    const data = JSON.parse(localStorage.getItem(NYC_24H_KEY));
    if (!data) return 'orbiter';
    return (Date.now() - data.timestamp) < 24 * 3600 * 1000 ? 'participant' : 'orbiter';
  } catch { return 'orbiter'; }
}

export function getLastLocation() {
  return lastLocation || getCached();
}

export function isWithinCheckInRadius(userLat, userLng, eventLat, eventLng, radiusMeters = 200) {
  return haversine(userLat, userLng, eventLat, eventLng) <= radiusMeters;
}

export function isEventCheckInActive(eventDate, eventTimeUtc) {
  const now = Date.now();
  const start = eventTimeUtc ? new Date(eventTimeUtc).getTime() : new Date(eventDate + 'T00:00:00').getTime();
  return now >= start && now <= start + 6 * 3600 * 1000;
}

// Legacy no-ops for compatibility (ping only now)
export const requestLocation = pingLocation;
export function startWatching() {}
export function stopWatching() {}

/**
 * When user becomes participant while signed in, mark favorite contributions.
 * Frontend will then call awardPoints() with calculated amount.
 * @param {any} session - the authenticated session from getValidSession()
 * @returns {Promise<number>} number of events that received contribution marks
 */
export async function markFavoriteContributions(session) {
  if (!session?.user?.id || !session?.access_token) {
    console.warn('markFavoriteContributions: No valid session');
    return 0;
  }

  try {
    const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/award_points_for_active_favorites`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: session.user.id }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.warn('markFavoriteContributions error:', err.message || err);
      return 0;
    }

    const eventsCount = await res.json();
    return eventsCount || 0;
  } catch (error) {
    console.warn('markFavoriteContributions exception:', error?.message || error);
    return 0;
  }
}