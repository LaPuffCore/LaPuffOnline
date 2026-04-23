// Handshake for anonymous device identity. Calls server RPC to subtract old anonymous contributions
// when the device identity has changed (cache wipe). Also performs selective volatile-key cleanup
// when the app version changes.
import { supabase } from './supabaseAuth';
import { initializeDeviceId } from './deviceId';

const APP_VERSION_KEY = 'APP_VERSION';
const SITE_VERSION = '2.0.4';

/**
 * Main Handshake Initialization.
 * Called on app boot to ensure anonymous contributions are honest and subtract spoofed counts.
 */
export async function initAnonDeviceHandshake() {
  try {
    // 1) Initialize Triple-Lock identity and detect cache wipes via recovery anchors
    const { id: current, wasWiped, prevId } = await initializeDeviceId();
    if (!current) return;

    // 2) Version-based volatile key cleanup (selective persistence)
    try {
      const lastVersion = localStorage.getItem(APP_VERSION_KEY);
      if (lastVersion !== SITE_VERSION) {
        // Clear UI/volatile keys — keep identity keys (deviceId, interactions) intact
        const volatileKeys = [
          'old_ui_layout_config', 
          'temp_event_filters', 
          'last_viewed_event',
          'active_filters',      // Added for comprehensive UI reset
          'map_position'         // Added to reset map view to defaults
        ];
        
        volatileKeys.forEach(k => { 
          try { localStorage.removeItem(k); } catch (e) {} 
        });
        
        try { localStorage.setItem(APP_VERSION_KEY, SITE_VERSION); } catch (e) {}
      }
    } catch (e) { /* non-fatal version check error */ }

    // 3) SUBTRACTIVE HANDSHAKE
    // If wasWiped is true, it means localStorage was empty but the identity was 
    // recovered from the backup anchors. We must now "clean" the DB contributions.
    if (wasWiped && prevId && prevId !== current) {
      console.log('🔄 Detection: Cache wipe detected. Syncing subtractive identity...');
      
      try {
        const { error } = await supabase.rpc('sync_and_clean_anon_cache', { 
          p_new_device_id: current, 
          p_old_device_id: prevId 
        });

        if (error) throw error;
        console.log('✅ Success: Old anonymous contributions subtracted.');
      } catch (err) {
        console.warn('⚠️ sync_and_clean_anon_cache RPC failed:', err?.message || err);
      }
    }

    // Note: Manual PREV_KEY storage is no longer needed here, as deviceId.js 
    // now manages identity persistence across all three storage layers internally.
    
  } catch (e) {
    console.warn('❌ initAnonDeviceHandshake error:', e?.message || e);
  }
}

export default initAnonDeviceHandshake;