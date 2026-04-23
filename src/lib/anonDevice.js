// Handshake for anonymous device identity. Calls server RPC to subtract old anonymous contributions
// when the device identity has changed (cache wipe). Also performs selective volatile-key cleanup
// when the app version changes.
import { supabase } from './supabaseAuth';
import { getDeviceId } from './deviceId';

const PREV_KEY = 'lapuff_prev_device_id';
const APP_VERSION_KEY = 'APP_VERSION';
const SITE_VERSION = '2.0.4';

export async function initAnonDeviceHandshake() {
  try {
    const current = await getDeviceId();
    if (!current) return;

    // Version-based volatile key cleanup (selective persistence)
    try {
      const lastVersion = localStorage.getItem(APP_VERSION_KEY);
      if (lastVersion !== SITE_VERSION) {
        // Clear only UI/volatile keys — keep identity keys intact
        const volatileKeys = ['old_ui_layout_config', 'temp_event_filters', 'last_viewed_event'];
        volatileKeys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
        try { localStorage.setItem(APP_VERSION_KEY, SITE_VERSION); } catch (e) {}
      }
    } catch (e) { /* non-fatal */ }

    // Read last known device id (if any)
    let prev = null;
    try { prev = localStorage.getItem(PREV_KEY) || null; } catch (e) { prev = null; }

    // If we have a previous device id and it differs from current, call RPC to
    // subtract the old device's contributions and delete its anon rows.
    if (prev && prev !== current) {
      try {
        await supabase.rpc('sync_and_clean_anon_cache', { p_new_device_id: current, p_old_device_id: prev });
      } catch (err) {
        console.warn('sync_and_clean_anon_cache RPC failed', err?.message || err);
      }
    }

    // Ensure the current device id is persisted as the "last known" id
    try { localStorage.setItem(PREV_KEY, current); } catch (e) {}
  } catch (e) {
    console.warn('initAnonDeviceHandshake error', e?.message || e);
  }
}

export default initAnonDeviceHandshake;
