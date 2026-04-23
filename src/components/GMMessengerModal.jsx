import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseAuth';
import { getDeviceId } from '../lib/deviceId';
import { useSiteTheme } from '../lib/theme';

export default function GMMessengerModal({ onClose }) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: '', msg: '' });
  const { resolvedTheme } = useSiteTheme();

  // Close on Escape key
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim() || message.length < 10) {
      setStatus({ type: 'error', msg: 'Message too short. Be descriptive.' });
      return;
    }

    setLoading(true);
    setStatus({ type: '', msg: '' });

    try {
      const deviceId = await getDeviceId();
      
      // Send to Supabase 'gm_messages' table
      const { error } = await supabase
        .from('gm_messages')
        .insert([
          { 
            content: message.trim(), 
            device_id: deviceId,
            metadata: { 
              ua: navigator.userAgent,
              ref: window.location.href 
            }
          }
        ]);

      if (error) throw error;

      // SUCCESS: Set the 12-hour lockout timestamp
      localStorage.setItem(`gm_msg_${deviceId}`, Date.now().toString());
      
      setStatus({ type: 'success', msg: 'Transmission received. The GM will review your report.' });
      setTimeout(() => onClose(), 2500);

    } catch (err) {
      setStatus({ type: 'error', msg: 'System failure: Could not reach the GM.' });
      console.error('GM Message Error:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    /* FIXED OVERLAY: This ensures it covers the whole screen and centers the content */
    <div 
      className="fixed inset-0 w-screen h-screen bg-black/70 backdrop-blur-sm z-[2000] flex items-center justify-center p-4 overflow-y-auto" 
      onClick={onClose}
    >
      <div 
        className="bg-white border-4 border-black rounded-3xl w-full shadow-[8px_8px_0px_black] overflow-hidden animate-in zoom-in duration-200"
        style={{ 
          maxWidth: '500px', 
          backgroundColor: resolvedTheme.surfaceBackgroundColor,
          borderColor: resolvedTheme.buttonOutlineColor,
          boxShadow: `8px 8px 0px ${resolvedTheme.tileShadowColor}` 
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header - Styled like AuthModal */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b-3 border-black" style={{ borderColor: resolvedTheme.buttonOutlineColor }}>
          <h2 className="text-xl font-black flex items-center gap-2" style={{ color: resolvedTheme.titleTextColor }}>
            <span className="lp-emoji">📟</span> GM Handshake
          </h2>
          <button 
            onClick={onClose} 
            className="w-8 h-8 bg-black text-white rounded-full font-black text-sm flex items-center justify-center hover:bg-red-500 transition-colors"
            style={{ backgroundColor: resolvedTheme.buttonOutlineColor }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: resolvedTheme.bodyTextColor + '80' }}>
            Direct report to the Game Master. 12-hour cooldown applies.
          </p>

          <div className="relative mb-4">
            <textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              placeholder="Report a bug, suggestion, or clout dispute..."
              rows={5}
              disabled={loading || status.type === 'success'}
              className="w-full border-3 border-black rounded-2xl px-4 py-3 text-sm font-medium resize-none focus:outline-none transition-all shadow-[4px_4px_0px_black]"
              style={{ 
                borderColor: resolvedTheme.buttonOutlineColor,
                backgroundColor: resolvedTheme.surfaceBackgroundColor,
                color: resolvedTheme.bodyTextColor,
                boxShadow: `4px 4px 0px ${resolvedTheme.tileShadowColor}`
              }}
            />
            <div className="absolute bottom-3 right-3 text-[10px] font-black opacity-40">
              {message.length}/500
            </div>
          </div>

          {status.msg && (
            <div className={`mb-4 p-3 rounded-xl border-2 font-bold text-xs animate-in slide-in-from-bottom-1 ${
              status.type === 'success' ? 'bg-green-100 border-green-500 text-green-700' : 'bg-red-100 border-red-500 text-red-700'
            }`}>
              {status.type === 'success' ? '✅' : '⚠️'} {status.msg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || status.type === 'success'}
            className="w-full text-white font-black text-lg py-4 rounded-2xl transition-all disabled:opacity-50 active:translate-y-1 shadow-[4px_4px_0px_#333]"
            style={{ 
              backgroundColor: resolvedTheme.accentColor,
              boxShadow: `4px 4px 0px ${resolvedTheme.tileShadowColor}`
            }}
          >
            {loading ? 'TRANSMITTING...' : 'SEND MESSAGE'}
          </button>
        </form>

        <div className="px-6 pb-4 text-center">
          <p className="text-[9px] font-black uppercase opacity-30 tracking-tighter">
            Hardware ID: { (localStorage.getItem('lapuff_device_id') || 'unidentified').slice(0, 18) }...
          </p>
        </div>
      </div>
    </div>
  );
}