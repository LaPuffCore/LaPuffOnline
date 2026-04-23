import { supabase } from './supabaseAuth';
import { getDeviceId } from './deviceId';

// Module-level lock: lives in the browser's memory for the duration of the tab session
let hasCapturedPulse = false;

/**
 * Captures the current session's IP and metadata once per session.
 * Can be called anonymously or with a userId.
 */
export async function captureSessionIP(userId = null) {
  // EXIT EARLY: If we've already logged this session, don't waste a DB request
  if (hasCapturedPulse) return;

  try {
    const deviceId = await getDeviceId();
    
    // Fetch the public IP from ipify
    const res = await fetch('https://api.ipify.org?format=json');
    if (!res.ok) throw new Error('IP API unreachable');
    const { ip } = await res.json();

    const { error } = await supabase
      .from('security_logs')
      .insert([{
        user_id: userId,
        device_id: deviceId,
        ip_address: ip,
        action_type: 'site_load',
        user_agent: navigator.userAgent,
        origin_page: window.location.pathname,
        metadata: { 
          resolution: `${window.screen.width}x${window.screen.height}`,
          referrer: document.referrer || 'direct'
        }
      }]);

    if (error) throw error;

    // LOCK ENGAGED: No more requests will fire from this tab
    hasCapturedPulse = true;
    console.log("[Security] Pulse captured and locked.");
    
  } catch (err) {
    // Silent fail so site load is never blocked
    console.warn("[Security] IP capture bypassed.");
  }
}