import { supabase } from './supabaseAuth';
import { getDeviceId } from './deviceId';

// Module-level lock to prevent multiple captures in a single session/tab life
let hasCapturedPulse = false;

/**
 * Captures the current session's IP and metadata once per session.
 * Can be called anonymously or with a userId.
 */
export async function captureSessionIP(userId = null) {
  // If the pulse has already been captured for this session, exit early
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

    // Set lock to true only after a successful or attempted insert
    hasCapturedPulse = true;
  } catch (err) {
    // Silent fail so site load is never blocked by tracking errors
    console.warn("[Security] IP capture bypassed.");
    // We do not set the lock here to allow for a retry if the network was just blipping
  }
}