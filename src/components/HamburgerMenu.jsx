import { useState, useRef, useEffect } from 'react';
import { getFavorites } from '../lib/favorites';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseAuth';
import { useSiteTheme } from '../lib/theme';
import ReferralModal from './ReferralModal';
import ThemeCustomizerModal from './ThemeCustomizerModal';

export default function HamburgerMenu({ events, user, onAuthClick }) {
  const [open, setOpen] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [cloutPoints, setCloutPoints] = useState(0);
  const ref = useRef(null);
  const { resolvedTheme } = useSiteTheme();

  useEffect(() => {
    // Count only favorites that actually exist in the loaded events list.
    // Raw getFavorites().length can include stale IDs for deleted/missing events.
    const compute = () => {
      const favIds = getFavorites();
      setFavCount(events.filter(e => favIds.includes(String(e.id))).length);
    };
    compute();
    window.addEventListener('favoritesChanged', compute);
    return () => window.removeEventListener('favoritesChanged', compute);
  }, [events]);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    let mounted = true;

    async function loadCloutPoints() {
      if (!user?.id) {
        setCloutPoints(0);
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('clout_points')
        .eq('id', user.id)
        .single();

      if (mounted) setCloutPoints(data?.clout_points || 0);
    }

    loadCloutPoints();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-11 h-11 border-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors ${open ? 'lp-button-active' : 'lp-button-base'}`}
        style={{ boxShadow: `3px 3px 0px ${resolvedTheme.tileShadowColor}` }}
      >
        <span className="w-5 h-0.5 rounded transition-colors" style={{ backgroundColor: open ? '#ffffff' : resolvedTheme.microIconColor }}></span>
        <span className="w-5 h-0.5 rounded transition-colors" style={{ backgroundColor: open ? '#ffffff' : resolvedTheme.microIconColor }}></span>
        <span className="w-5 h-0.5 rounded transition-colors" style={{ backgroundColor: open ? '#ffffff' : resolvedTheme.microIconColor }}></span>
      </button>

      {open && (
        <div
          className="lp-theme-scope absolute right-0 top-14 w-64 z-[999] overflow-hidden rounded-3xl border-3 animate-in fade-in slide-in-from-top-2 duration-200"
          style={{
            backgroundColor: resolvedTheme.surfaceBackgroundColor,
            borderColor: resolvedTheme.buttonOutlineColor,
            boxShadow: `8px 8px 0px ${resolvedTheme.tileShadowColor}`,
          }}
        >
          <div className="px-5 pt-4 pb-2 border-b-2" style={{ borderColor: resolvedTheme.buttonOutlineColor }}>
            <h3 className="font-black text-base uppercase tracking-tight" style={{ color: resolvedTheme.titleTextColor }}>System Menu</h3>
          </div>

          <div className="p-2">
            <Link
              to="/favorites"
              onClick={() => setOpen(false)}
              className="w-full text-left px-4 py-3 rounded-2xl font-bold flex items-center gap-3 transition-colors"
              style={{ color: resolvedTheme.buttonTextColor || resolvedTheme.bodyTextColor || resolvedTheme.microIconColor }}
              onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = resolvedTheme.accentColor + '14'; }}
              onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span className="text-xl lp-emoji">⭐</span>
              <span>My Favorites <span className="text-sm font-black" style={{ color: resolvedTheme.accentColor }}>({favCount})</span></span>
            </Link>

            <Link
              to="/calendar"
              onClick={() => setOpen(false)}
              className="w-full text-left px-4 py-3 rounded-2xl font-bold flex items-center gap-3 transition-colors"
              style={{ color: resolvedTheme.buttonTextColor || resolvedTheme.bodyTextColor || resolvedTheme.microIconColor }}
              onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = resolvedTheme.accentColor + '14'; }}
              onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span className="text-xl lp-emoji">📅</span>
              <span>Favorites Calendar</span>
            </Link>

            <button
              onClick={() => {
                setOpen(false);
                setShowCustomizer(true);
              }}
              className="w-full text-left px-4 py-3 rounded-2xl font-bold flex items-center gap-3 transition-colors"
              style={{ color: resolvedTheme.buttonTextColor || resolvedTheme.bodyTextColor || resolvedTheme.microIconColor }}
              onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = resolvedTheme.accentColor + '14'; }}
              onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span className="text-xl lp-emoji">🎨</span>
              <span>Theme Customizer</span>
            </button>

            <button
              onClick={() => {
                setOpen(false);
                if (user) {
                  setShowReferral(true);
                } else {
                  onAuthClick();
                }
              }}
              className="w-full text-left px-4 py-3 rounded-2xl font-bold flex items-center gap-3 transition-colors group"
              style={{ color: resolvedTheme.buttonTextColor || resolvedTheme.bodyTextColor || resolvedTheme.microIconColor }}
              onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = resolvedTheme.accentColor + '14'; }}
              onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span className="text-xl group-hover:rotate-12 transition-transform lp-emoji">👥</span>
              <div className="flex flex-col">
                <span className="leading-none">Refer A User</span>
                <span className="text-[9px] font-black mt-1 uppercase" style={{ color: resolvedTheme.accentColor }}>Expand The Network</span>
              </div>
            </button>

            {user && (
              <div className="mt-2 rounded-2xl border-3 px-4 py-3" style={{ backgroundColor: resolvedTheme.surfaceBackgroundColor, borderColor: resolvedTheme.buttonOutlineColor, boxShadow: `3px 3px 0px ${resolvedTheme.tileShadowColor}` }}>
                <div className="flex items-start gap-3">
                  <span className="text-xl lp-emoji">⚡</span>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: resolvedTheme.titleTextColor }}>Clout Points</p>
                    <p className="mt-1 pl-2 text-lg font-black" style={{ color: resolvedTheme.accentColor }}>{cloutPoints.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t mt-3 pt-2 px-4 pb-3" style={{ borderColor: '#e5e7eb' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9ca3af' }}>LaPuff Online · NYC</p>
            </div>
          </div>
        </div>
      )}

      {showReferral && (
        <ReferralModal
          user={user}
          onClose={() => setShowReferral(false)}
        />
      )}

      {showCustomizer && <ThemeCustomizerModal onClose={() => setShowCustomizer(false)} />}
    </div>
  );
}