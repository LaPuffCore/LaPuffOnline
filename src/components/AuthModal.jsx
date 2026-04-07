import { useState, useEffect } from 'react';
import { signIn, signUp } from '../lib/supabaseAuth';
import { containsProfanity } from '../lib/profanityFilter';

export default function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', username: '', bio: '', home_zip: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { username } = await signIn(form.email, form.password);
        onSuccess(username);
      } else {
        // Validations
        if (!form.username.trim()) throw new Error('Username required');
        if (form.password.length < 8) throw new Error('Password must be at least 8 characters');
        if (form.password !== form.confirmPassword) throw new Error('Passwords do not match');
        if (containsProfanity(form.username)) throw new Error('Error profanity filter');
        if (containsProfanity(form.bio)) throw new Error('Error profanity filter');
        if (form.home_zip && !/^\d{5}$/.test(form.home_zip)) throw new Error('Enter a valid 5-digit NYC ZIP');

        const result = await signUp(form.email, form.password, form.username, form.bio, form.home_zip || '10001');
        if (result.pending) {
          setSuccess('📨 Check your email to finish enlisting! You must confirm your email before you can log in.');
        } else {
          onSuccess(result.username || form.username);
        }
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border-4 border-black rounded-3xl w-full shadow-[8px_8px_0px_black] overflow-hidden"
        style={{ maxWidth: 760, maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b-3 border-black flex-shrink-0">
          <h2 className="text-xl font-black">☁️ Join LaPuff Online</h2>
          <button onClick={onClose} className="w-9 h-9 bg-black text-white rounded-full font-black text-lg hover:bg-red-500 transition-colors flex items-center justify-center">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b-3 border-black">
          <button onClick={() => { setMode('signin'); setError(''); }}
            className={`flex-1 py-3 font-black text-sm transition-colors ${mode === 'signin' ? 'bg-[#7C3AED] text-white' : 'bg-gray-50 hover:bg-violet-50'}`}>
            🔑 Sign In
          </button>
          <button onClick={() => { setMode('signup'); setError(''); }}
            className={`flex-1 py-3 font-black text-sm transition-colors border-l-3 border-black ${mode === 'signup' ? 'bg-[#7C3AED] text-white' : 'bg-gray-50 hover:bg-violet-50'}`}>
            ✨ Create Account
          </button>
        </div>

        {success ? (
          <div className="p-10 text-center">
            <div className="text-5xl mb-4">📨</div>
            <p className="font-black text-xl mb-2">Almost there, recruit!</p>
            <p className="text-gray-600 max-w-sm mx-auto">{success}</p>
            <p className="text-gray-400 text-sm mt-3">Once confirmed, come back and Sign In.</p>
            <button onClick={onClose} className="mt-6 bg-[#7C3AED] text-white font-black px-8 py-3 rounded-2xl hover:bg-[#6D28D9]">Got it!</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 160px)' }}>
            <div className={`grid gap-4 p-6 ${mode === 'signup' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 max-w-sm mx-auto'}`}>

              {/* Left column: shared fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-black uppercase mb-1">Email *</label>
                  <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} required
                    placeholder="you@example.com"
                    className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]" />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase mb-1">Password *</label>
                  <input type="password" value={form.password} onChange={e => setField('password', e.target.value)} required
                    placeholder={mode === 'signup' ? 'Min 8 characters' : '••••••••'}
                    minLength={mode === 'signup' ? 8 : undefined}
                    className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]" />
                  {mode === 'signup' && (
                    <p className="text-xs text-red-500 font-bold mt-1">⚠️ One life — no password resets. Keep it safe.</p>
                  )}
                </div>
                {mode === 'signup' && (
                  <>
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Re-type Password *</label>
                      <input type="password" value={form.confirmPassword} onChange={e => setField('confirmPassword', e.target.value)} required
                        placeholder="Confirm your password"
                        className={`w-full border-3 rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none shadow-[3px_3px_0px_black] ${form.confirmPassword && form.confirmPassword !== form.password ? 'border-red-500 bg-red-50' : 'border-black focus:bg-violet-50'}`} />
                      {form.confirmPassword && form.confirmPassword !== form.password && (
                        <p className="text-red-500 text-xs mt-1">⚠ Passwords don't match</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-black uppercase mb-1">Username *</label>
                      <input value={form.username} onChange={e => setField('username', e.target.value)}
                        placeholder="your_handle"
                        className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]" />
                    </div>
                  </>
                )}
              </div>

              {/* Right column: signup extras */}
              {mode === 'signup' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Bio <span className="text-gray-400 font-normal normal-case">({form.bio.length}/320)</span></label>
                    <textarea value={form.bio} onChange={e => setField('bio', e.target.value.slice(0, 320))}
                      placeholder="Tell NYC who you are..."
                      rows={4}
                      className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-medium resize-none focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]" />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Home ZIP Code *</label>
                    <input value={form.home_zip} onChange={e => setField('home_zip', e.target.value)}
                      placeholder="e.g. 10001"
                      maxLength={5}
                      className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]" />
                    <p className="text-xs text-gray-400 mt-1">Your NYC colony ZIP — this is your territory.</p>
                  </div>
                  <div className="bg-violet-50 border-2 border-[#7C3AED] rounded-2xl p-3">
                    <p className="text-xs font-black text-[#7C3AED]">💜 Clout Points</p>
                    <p className="text-xs text-gray-600 mt-1">Earn Clout Points by submitting events, getting favorites, and showing up. Your ZIP code is your colony.</p>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="mx-6 mb-4 bg-red-100 border-3 border-red-500 rounded-2xl p-3 text-red-700 font-medium text-sm">⚠ {error}</div>
            )}

            <div className="px-6 pb-6">
              <button type="submit" disabled={loading}
                className="w-full bg-[#7C3AED] text-white font-black text-lg py-4 rounded-2xl hover:bg-[#6D28D9] transition-colors disabled:opacity-50 shadow-[4px_4px_0px_#333]">
                {loading ? '...' : mode === 'signin' ? '🔑 Sign In' : '🚀 Join the Games'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}