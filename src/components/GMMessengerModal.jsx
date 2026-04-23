import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseAuth';
import { getDeviceId } from '../lib/deviceId';
import { useSiteTheme } from '../lib/theme';

export default function GMMessengerModal({ onClose, user }) {
  const [formData, setFormData] = useState({ name: '', title: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
    if (!formData.message.trim() || formData.message.length < 10) {
      setStatus({ type: 'error', msg: 'Message too short. Be descriptive.' });
      return;
    }

    setLoading(true);
    setStatus({ type: '', msg: '' });

    try {
      const deviceId = await getDeviceId();
      
      const { error } = await supabase
        .from('gm_messages')
        .insert([
          { 
            sender_name: formData.name.trim() || 'Anonymous',
            subject_title: formData.title.trim() || 'No Subject',
            content: formData.message.trim(), 
            user_id: user?.id || null,
            device_id: deviceId,
            metadata: { 
              ua: navigator.userAgent,
              ref: window.location.href 
            }
          }
        ]);

      if (error) throw error;

      // Local 12-hour lockout timestamp
      localStorage.setItem(`gm_msg_${deviceId}`, Date.now().toString());
      
      // Trigger success animation
      setSubmitted(true);
      
      // Auto-close after 2 seconds
      setTimeout(() => onClose(), 2000);

    } catch (err) {
      setStatus({ type: 'error', msg: 'System failure: Could not reach the GM.' });
      console.error('GM Message Error:', err);
      setLoading(false);
    }
  }

  const inputStyle = {
    borderColor: resolvedTheme.buttonOutlineColor,
    backgroundColor: resolvedTheme.surfaceBackgroundColor,
    color: resolvedTheme.bodyTextColor,
    boxShadow: `4px 4px 0px ${resolvedTheme.tileShadowColor}`
  };

  return (
    <div 
      className="fixed inset-0 w-screen h-screen bg-black/60 z-[9999] flex items-center justify-center p-4" 
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
        {!submitted ? (
          <>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b-3 border-black" style={{ borderColor: resolvedTheme.buttonOutlineColor }}>
              <h2 className="text-xl font-black flex items-center gap-2" style={{ color: resolvedTheme.titleTextColor }}>
                <span className="lp-emoji">📟</span> GM Handshake
              </h2>
              <button onClick={onClose} className="w-8 h-8 bg-black text-white rounded-full font-black text-sm flex items-center justify-center hover:bg-red-500 transition-colors" style={{ backgroundColor: resolvedTheme.buttonOutlineColor }}>✕</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-[10px] font-black uppercase mb-1 block opacity-60" style={{ color: resolvedTheme.titleTextColor }}>Your Name</label>
                  <input 
                    type="text" 
                    placeholder="Handle..."
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full border-3 border-black rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase mb-1 block opacity-60" style={{ color: resolvedTheme.titleTextColor }}>Subject</label>
                  <input 
                    type="text" 
                    placeholder="Bug, Idea, etc..."
                    value={formData.title}
                    onChange={e => setFormData({...formData, title: e.target.value})}
                    className="w-full border-3 border-black rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div className="relative mb-4">
                <label className="text-[10px] font-black uppercase mb-1 block opacity-60" style={{ color: resolvedTheme.titleTextColor }}>Message Body</label>
                <textarea
                  autoFocus
                  value={formData.message}
                  onChange={(e) => setFormData({...formData, message: e.target.value.slice(0, 500)})}
                  placeholder="Be descriptive..."
                  rows={4}
                  disabled={loading}
                  className="w-full border-3 border-black rounded-2xl px-4 py-3 text-sm font-medium resize-none focus:outline-none transition-all"
                  style={inputStyle}
                />
                <div className="absolute bottom-3 right-3 text-[10px] font-black opacity-30" style={{ color: resolvedTheme.bodyTextColor }}>
                  {formData.message.length}/500
                </div>
              </div>

              {status.msg && (
                <div className="mb-4 p-3 rounded-xl border-2 bg-red-100 border-red-500 text-red-700 font-bold text-xs animate-in slide-in-from-bottom-1">
                  ⚠️ {status.msg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full text-white font-black text-lg py-4 rounded-2xl transition-all disabled:opacity-50 active:translate-y-1"
                style={{ 
                  backgroundColor: resolvedTheme.accentColor, 
                  boxShadow: `4px 4px 0px ${resolvedTheme.tileShadowColor}` 
                }}
              >
                {loading ? 'TRANSMITTING...' : 'SEND MESSAGE'}
              </button>
            </form>
          </>
        ) : (
          /* SUCCESS STATE - 2 SECOND AUTO-CLOSE SEQUENCE */
          <div className="p-12 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-300">
            <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-lg animate-bounce">
              <span className="text-4xl text-white">✓</span>
            </div>
            <h2 className="text-2xl font-black mb-2" style={{ color: resolvedTheme.titleTextColor }}>Transmission Received</h2>
            <p className="font-bold opacity-60 px-4" style={{ color: resolvedTheme.bodyTextColor }}>
              Your request was submitted. The GM will review your report shortly.
            </p>
            
            {/* Countdown Progress Bar */}
            <div className="mt-8 w-full bg-gray-100 h-1.5 rounded-full overflow-hidden max-w-[200px]">
               <div 
                 className="h-full bg-green-500" 
                 style={{ 
                   animation: 'lp-progress-shrink 2s linear forwards' 
                 }}
               ></div>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes lp-progress-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}} />
    </div>
  );
}