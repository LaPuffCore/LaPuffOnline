import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EventSubmitForm from '../components/EventSubmitForm';
import TileView from '../components/TileView';
import MapView from '../components/MapView';
import GeoPostView from '../components/GeoPostView';
import HamburgerMenu from '../components/HamburgerMenu';
import AuthModal from '../components/AuthModal';
import ParticipantDot from '../components/ParticipantDot';
import Leaderboard from '../components/Leaderboard'; 
import { getValidSession, signOut } from '../lib/supabaseAuth';
import { useSiteTheme } from '../lib/theme';

export default function Home({ events = [], eventsLoading = false }) {
  const { resolvedTheme } = useSiteTheme();
  const accentColor = resolvedTheme?.accentColor || '#7C3AED';
  const [view, setView] = useState('tiles');
  const [tileViewKey, setTileViewKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const lastScrollY = useRef(0);
  const downScrollAccum = useRef(0);
  const headerRef = useRef(null);
  const [measuredHeaderH, setMeasuredHeaderH] = useState(0);
  useLayoutEffect(() => {
    if (headerRef.current) setMeasuredHeaderH(headerRef.current.offsetHeight);
  }, []);

  // ── Ghost Music Player state ──────────────────────────────────────────────
  const [isMusicOn,     setIsMusicOn]     = useState(false);
  const [currentMode,   setCurrentMode]   = useState(null); // 'clout' | null
  const [showMusicMenu, setShowMusicMenu] = useState(false);
  const [musicVolume,   setMusicVolume]   = useState(80);
  const [hasVisitedMap, setHasVisitedMap] = useState(false); // gate music button visibility
  const scIframeRef      = useRef(null);
  const scWidgetRef      = useRef(null);
  const scReadyRef       = useRef(false);
  const pendingPlayRef   = useRef(false);  // play queued before widget READY
  const musicVolumeRef   = useRef(80);    // stable ref for closure access
  const mapAutoPlayedRef = useRef(false);
  const musicDesktopRef  = useRef(null);
  const musicMobileRef   = useRef(null);

  const location = useLocation();
  const isMap = view === 'map';
  const displayName = user?.username || user?.user_metadata?.username || user?.email?.split('@')[0] || 'Account';

  // REFERRAL LOGIC: Capture and Persist
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const refCode = params.get('ref');
    
    if (refCode) {
      // Save to local storage so it persists through email validation redirects
      localStorage.setItem('lapuff_pending_referral', refCode);
      
      // If not logged in, auto-open the sign up modal after 1000ms delay
      const timer = setTimeout(() => {
        if (!user) {
          setShowAuth(true);
        }
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [location.search, user]);

  useEffect(() => {
    async function initAuth() {
      const session = await getValidSession();
      if (session?.user) { setUser(session.user); setSession(session); }
    }
    initAuth();
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') setShowLeaderboard(false);
    };
    if (showLeaderboard) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showLeaderboard]);

  // Handle mobile scroll to hide/show header
  const handleScroll = (e) => {
    if (window.innerWidth >= 768) return; // Only mobile
    const scrollContainer = e.currentTarget;
    const currentScrollY = scrollContainer.scrollTop;
    const atTopOfTileViewport = currentScrollY <= 2;

    // Hysteresis tuning: reduce jitter from tiny touch scroll fluctuations.
    const MIN_DELTA = 4;
    const HIDE_AFTER_Y = 96;
    const HIDE_SCROLL_DISTANCE = 18;

    const delta = currentScrollY - lastScrollY.current;
    if (Math.abs(delta) < MIN_DELTA) {
      // Keep top-state authoritative even for tiny movements.
      if (atTopOfTileViewport && !showHeader) setShowHeader(true);
      return;
    }

    if (atTopOfTileViewport) {
      if (!showHeader) setShowHeader(true);
      downScrollAccum.current = 0;
      lastScrollY.current = currentScrollY;
      return;
    }

    if (delta > 0) {
      downScrollAccum.current += delta;
      if (currentScrollY > HIDE_AFTER_Y && downScrollAccum.current >= HIDE_SCROLL_DISTANCE && showHeader) {
        setShowHeader(false);
        downScrollAccum.current = 0;
      }
    } else {
      // Intentionally do not re-show on upward movement unless the viewport
      // actually reaches the top of the TileView scroll container.
      downScrollAccum.current = 0;
    }

    lastScrollY.current = currentScrollY;
  };

  function handleAuthSuccess() {
    getValidSession().then(sess => {
      if (sess) { setUser(sess.user); setSession(sess); }
      setShowAuth(false);
    });
  }

  async function handleLogout() {
    await signOut();
    setUser(null);
    setShowUserMenu(false);
  }

  function handleLogoHomeReset() {
    setView('tiles');
    setShowLeaderboard(false);
    setShowHeader(true);
    setShowUserMenu(false);
    setTileViewKey((prev) => prev + 1);
  }

  // ── SoundCloud Widget API bootstrap ──────────────────────────────────────
  useEffect(() => {
    function initWidget() {
      if (!scIframeRef.current || !window.SC) return;
      const widget = window.SC.Widget(scIframeRef.current);
      scWidgetRef.current = widget;
      widget.bind(window.SC.Widget.Events.READY, () => {
        scReadyRef.current = true;
        widget.setVolume(musicVolumeRef.current);
        if (pendingPlayRef.current) {
          pendingPlayRef.current = false;
          widget.play();
          widget.setShuffle(true);
        }
      });
    }
    if (window.SC) { initWidget(); return; }
    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.onload = initWidget;
    document.head.appendChild(script);
  }, []);

  // Close music menu on outside click
  useEffect(() => {
    if (!showMusicMenu) return;
    const handler = (e) => {
      const inD = musicDesktopRef.current?.contains(e.target);
      const inM = musicMobileRef.current?.contains(e.target);
      if (!inD && !inM) setShowMusicMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMusicMenu]);

  function triggerCloutCullingGames() {
    setCurrentMode('clout');
    setIsMusicOn(true);
    if (scWidgetRef.current && scReadyRef.current) {
      scWidgetRef.current.play();
      scWidgetRef.current.setShuffle(true);
    } else {
      pendingPlayRef.current = true; // will fire when READY event arrives
    }
  }

  function stopMusic() {
    setIsMusicOn(false);
    setCurrentMode(null);
    pendingPlayRef.current = false;
    if (scWidgetRef.current) scWidgetRef.current.pause();
  }

  function handleVolumeChange(val) {
    setMusicVolume(val);
    musicVolumeRef.current = val;
    if (scWidgetRef.current && scReadyRef.current) scWidgetRef.current.setVolume(val);
  }

  function handlePrevTrack() {
    if (scWidgetRef.current && scReadyRef.current) scWidgetRef.current.prev();
  }

  function handleNextTrack() {
    if (scWidgetRef.current && scReadyRef.current) scWidgetRef.current.next();
  }

  function handleTogglePlayPause() {
    if (isMusicOn) {
      setIsMusicOn(false);
      if (scWidgetRef.current) scWidgetRef.current.pause();
    } else if (currentMode === 'clout') {
      setIsMusicOn(true);
      if (scWidgetRef.current && scReadyRef.current) scWidgetRef.current.play();
      else pendingPlayRef.current = true;
    } else {
      triggerCloutCullingGames();
    }
  }

  function handleMapClick() {
    setView('map');
    setShowLeaderboard(false);
    setHasVisitedMap(true);
    // Auto-play only first time ever — check localStorage
    const alreadyPlayed = localStorage.getItem('lapuff_music_firstplayed');
    if (!alreadyPlayed) {
      localStorage.setItem('lapuff_music_firstplayed', '1');
      // Call immediately — same click-event tick satisfies browser autoplay policy
      triggerCloutCullingGames();
    }
  }

  return (
    <div className="h-[100dvh] lp-page-bg flex flex-col overflow-hidden" style={{ fontFamily: "'Nunito', cursive, sans-serif" }}>
      {/* Header — hidden when map is active and user collapsed it */}
      <header ref={headerRef} className={`lp-topbar bg-white border-b-4 border-black z-50 shadow-[0_4px_0px_black] flex-shrink-0 transition-[margin-top,transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${(isMap && headerCollapsed) ? '-translate-y-full opacity-0' : 'translate-y-0'} ${isMap ? 'absolute w-full' : 'relative'}`} style={!isMap ? { marginTop: !showHeader && measuredHeaderH ? `-${measuredHeaderH}px` : '0px', opacity: !showHeader ? 0 : 1 } : {}}>
        <div className="max-w-7xl mx-auto px-3 py-2 md:px-4 md:py-3">
          {/* Top Row: Logo, Nav, Menu */}
          <div className="flex items-center justify-between gap-1 md:gap-2">
            {/* Logo + Music Button — grouped so music button stays right of the orbiter button */}
            <div className="flex items-center gap-2">
            {/* Logo - Scaled down for mobile */}
            <button
              onClick={handleLogoHomeReset}
              onMouseEnter={() => setLogoHovered(true)}
              onMouseLeave={() => setLogoHovered(false)}
              className="flex items-center gap-1.5 md:gap-2 scale-90 md:scale-100 origin-left text-left"
              aria-label="Go to Home tile view and reset filters"
            >
              <div
                className="w-9 h-9 md:w-11 md:h-11 rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl transition-all duration-150"
                style={{
                  backgroundColor: logoHovered ? accentColor : '#000',
                  boxShadow: logoHovered
                    ? '2px 2px 0px #000, 3px 3px 0px #000'
                    : `2px 2px 0px ${accentColor}`,
                }}
              >
                💨
              </div>
              <div className="hidden xs:block">
                <h1 className="font-black text-sm md:text-lg leading-none">LaPuff Online</h1>
                <p className="text-[10px] md:text-xs text-gray-500 font-bold leading-none">NYC Events</p>
              </div>
              <ParticipantDot />
            </button>

            {/* Desktop Music Button — hugs right of orbiter/logo, only after visiting map */}
            {hasVisitedMap && <div className="relative hidden md:block" ref={musicDesktopRef}>
              <button
                onClick={() => setShowMusicMenu(v => !v)}
                className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-xl border-2 md:border-3 border-black bg-white shadow-[2px_2px_0px_black] md:shadow-[3px_3px_0px_black] transition-all hover:scale-105"
                title="Radio"
                style={isMusicOn ? { borderColor: accentColor, boxShadow: `3px 3px 0px ${accentColor}`, color: accentColor } : {}}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style={isMusicOn ? { filter: `drop-shadow(0 0 3px ${accentColor})` } : {}}>
                  <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                </svg>
              </button>
              {showMusicMenu && (
                <div className="absolute left-0 top-full mt-2 z-[60] w-52 bg-white border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] overflow-hidden">
                  <div className="px-3 py-1.5 border-b-2 border-gray-100">
                    <p className="font-black text-[10px] text-gray-400 uppercase tracking-widest">Radio</p>
                  </div>
                  <button
                    onClick={() => { triggerCloutCullingGames(); setShowMusicMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100 transition-colors"
                    style={currentMode === 'clout' ? { color: accentColor } : {}}>
                    <span>🎮</span>
                    <span className="flex-1">Clout Culling Games</span>
                    {currentMode === 'clout' && isMusicOn && <span className="text-[8px] animate-pulse" style={{ color: accentColor }}>▶</span>}
                  </button>
                  <button
                    onClick={() => { stopMusic(); setShowMusicMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 transition-colors"
                    style={!isMusicOn ? { color: accentColor } : { color: '#9ca3af' }}>
                    <span>⏹</span>
                    <span className="flex-1">Off</span>
                    {!isMusicOn && <span className="text-[8px]">✓</span>}
                  </button>
                  <div className="px-3 py-2 border-t-2 border-gray-100 flex items-center justify-center gap-5">
                    <button onClick={handlePrevTrack} title="Previous" className="text-gray-400 hover:text-gray-900 transition-colors text-sm leading-none">⏮</button>
                    <button onClick={handleTogglePlayPause} title={isMusicOn ? 'Pause' : 'Play'} className="text-sm leading-none transition-colors" style={{ color: isMusicOn ? accentColor : '#374151' }}>
                      {isMusicOn ? '⏸' : '▶'}
                    </button>
                    <button onClick={handleNextTrack} title="Next" className="text-gray-400 hover:text-gray-900 transition-colors text-sm leading-none">⏭</button>
                  </div>
                  <div className="px-3 pb-2.5 flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 flex-shrink-0">🔊</span>
                    <input type="range" min="0" max="100" value={musicVolume}
                      onChange={e => handleVolumeChange(Number(e.target.value))}
                      className="flex-1 h-1 cursor-pointer"
                      style={{ accentColor }} />
                  </div>
                </div>
              )}
            </div>}
            </div>{/* end logo+music group */}

            {/* View Toggles — center */}
            <div className="flex items-center gap-1 md:gap-2 scale-90 md:scale-100">
              <div className="bg-gray-100 border-2 md:border-3 border-black rounded-xl md:rounded-2xl p-0.5 md:p-1 flex shadow-[2px_2px_0px_black] md:shadow-[3px_3px_0px_black]">
                <button onClick={() => { setView('tiles'); setShowLeaderboard(false); setShowHeader(true); }}
                  className="px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all"
                  style={view === 'tiles' && !showLeaderboard ? { backgroundColor: accentColor, color: '#fff', boxShadow: '1px 1px 0px #333' } : {}}
                  onMouseEnter={e => { if (!(view === 'tiles' && !showLeaderboard)) e.currentTarget.style.backgroundColor = accentColor + '30'; }}
                  onMouseLeave={e => { if (!(view === 'tiles' && !showLeaderboard)) e.currentTarget.style.backgroundColor = ''; }}>
                  🎴 Tiles
                </button>
                <button onClick={handleMapClick}
                  className="px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all"
                  style={view === 'map' && !showLeaderboard ? { backgroundColor: accentColor, color: '#fff', boxShadow: '1px 1px 0px #333' } : {}}
                  onMouseEnter={e => { if (!(view === 'map' && !showLeaderboard)) e.currentTarget.style.backgroundColor = accentColor + '30'; }}
                  onMouseLeave={e => { if (!(view === 'map' && !showLeaderboard)) e.currentTarget.style.backgroundColor = ''; }}>
                  🗺️ Map
                </button>
                <button onClick={() => setShowLeaderboard(v => !v)}
                  className="px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all flex items-center gap-1"
                  style={showLeaderboard ? { backgroundColor: accentColor, color: '#fff', boxShadow: '1px 1px 0px #333' } : {}}
                  onMouseEnter={e => { if (!showLeaderboard) e.currentTarget.style.backgroundColor = accentColor + '30'; }}
                  onMouseLeave={e => { if (!showLeaderboard) e.currentTarget.style.backgroundColor = ''; }}>
                  🏆 Top
                </button>
                <button onClick={() => { setView('geo'); setShowLeaderboard(false); }}
                  className="px-1.5 py-1 md:px-4 md:py-2 rounded-lg md:rounded-xl text-[9px] md:text-sm font-black transition-all flex flex-col md:flex-row items-center justify-center gap-0 md:gap-1"
                  style={view === 'geo' && !showLeaderboard ? { backgroundColor: accentColor, color: '#fff', boxShadow: '1px 1px 0px #333' } : {}}
                  onMouseEnter={e => { if (!(view === 'geo' && !showLeaderboard)) e.currentTarget.style.backgroundColor = accentColor + '30'; }}
                  onMouseLeave={e => { if (!(view === 'geo' && !showLeaderboard)) e.currentTarget.style.backgroundColor = ''; }}>
                  <span className="text-xs md:text-sm leading-none">🌍</span>
                  <span className="leading-none hidden md:inline"> Geo-Post</span>
                  <span className="leading-[1.1] md:hidden text-center">Geo-<br />Post</span>
                </button>
              </div>
            </div>

            {/* Desktop Actions / Mobile Hamburger */}
            <div className="flex items-center gap-2">
              {/* Map-only collapse button (desktop) */}
              {isMap && (
                <button onClick={() => setHeaderCollapsed(true)}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black border-2 border-black bg-white shadow-[2px_2px_0px_black] transition-all whitespace-nowrap"
                  title="Collapse header to see more map"
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 6 6 2 10 6"/>
                    <polyline points="2 10 6 6 10 10"/>
                  </svg>
                  Collapse
                </button>
              )}
              <button onClick={() => setShowForm(true)}
                className="hidden md:block text-white font-black px-5 py-2.5 rounded-full text-sm transition-all shadow-[3px_3px_0px_#333] hover:scale-105 whitespace-nowrap"
                style={{ backgroundColor: accentColor }}>
                + Submit Event
              </button>

              <div className="hidden md:block">
                {user ? (
                  <div className="relative">
                    <button onClick={() => setShowUserMenu(v => !v)}
                      className="w-[136px] bg-white rounded-full px-4 py-2 font-black text-sm hover:bg-violet-50 transition-colors shadow-[3px_3px_0px_#333] truncate text-center border-3 lp-accent-border lp-accent-color-text">
                      {displayName}
                    </button>
                    {showUserMenu && (
                      <div className="absolute right-0 top-12 bg-white border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] z-50 overflow-hidden min-w-40">
                        <Link to="/favorites" className="block w-full px-4 py-3 text-left font-black text-sm hover:bg-gray-50 border-b-2 border-gray-100">
                          ⭐ My Favorites
                        </Link>
                        <button onClick={handleLogout}
                          className="w-full px-4 py-3 text-left font-black text-sm hover:bg-red-50 text-red-600 transition-colors">
                          🚪 Logout
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button onClick={() => setShowAuth(true)}
                    className="w-[136px] bg-white border-3 border-black rounded-full px-4 py-2 font-black text-sm transition-all shadow-[3px_3px_0px_black] whitespace-nowrap text-center"
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                    Sign In / Up
                  </button>
                )}
              </div>
              <HamburgerMenu events={events} user={user} onAuthClick={() => setShowAuth(true)} />
            </div>
          </div>

          {/* Mobile Secondary Row: Music + Auth + Submit + Map Collapse */}
          <div className="flex md:hidden items-center justify-center gap-3 mt-2 pb-1">

             {/* Mobile Music Button — only shown after user enters map */}
             {hasVisitedMap && <div className="relative" ref={musicMobileRef}>
               <button
                 onClick={() => setShowMusicMenu(v => !v)}
                 className="w-9 h-9 flex items-center justify-center rounded-xl border-2 border-black bg-white shadow-[2px_2px_0px_black] transition-all flex-shrink-0"
                 title="Radio"
                 style={isMusicOn ? { borderColor: accentColor, boxShadow: `2px 2px 0px ${accentColor}`, color: accentColor } : {}}>
                 <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" style={isMusicOn ? { filter: `drop-shadow(0 0 3px ${accentColor})` } : {}}>
                   <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                 </svg>
               </button>
               {showMusicMenu && (
                 <div className="absolute left-0 top-full mt-2 z-[60] w-52 max-w-[calc(100vw-2rem)] bg-white border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] overflow-hidden">
                   <div className="px-3 py-1.5 border-b-2 border-gray-100">
                     <p className="font-black text-[10px] text-gray-400 uppercase tracking-widest">Radio</p>
                   </div>
                   <button
                     onClick={() => { triggerCloutCullingGames(); setShowMusicMenu(false); }}
                     className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100 transition-colors"
                     style={currentMode === 'clout' ? { color: accentColor } : {}}>
                     <span>🎮</span>
                     <span className="flex-1">Clout Culling Games</span>
                     {currentMode === 'clout' && isMusicOn && <span className="text-[8px] animate-pulse" style={{ color: accentColor }}>▶</span>}
                   </button>
                   <button
                     onClick={() => { stopMusic(); setShowMusicMenu(false); }}
                     className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 transition-colors"
                     style={!isMusicOn ? { color: accentColor } : { color: '#9ca3af' }}>
                     <span>⏹</span>
                     <span className="flex-1">Off</span>
                     {!isMusicOn && <span className="text-[8px]">✓</span>}
                   </button>
                   {/* Playback controls */}
                   <div className="px-3 py-2 border-t-2 border-gray-100 flex items-center justify-center gap-5">
                     <button onClick={handlePrevTrack} title="Previous" className="text-gray-400 hover:text-gray-900 transition-colors text-sm leading-none">⏮</button>
                     <button onClick={handleTogglePlayPause} title={isMusicOn ? 'Pause' : 'Play'} className="text-sm leading-none transition-colors" style={{ color: isMusicOn ? accentColor : '#374151' }}>
                       {isMusicOn ? '⏸' : '▶'}
                     </button>
                     <button onClick={handleNextTrack} title="Next" className="text-gray-400 hover:text-gray-900 transition-colors text-sm leading-none">⏭</button>
                   </div>
                   {/* Volume slider */}
                   <div className="px-3 pb-2.5 flex items-center gap-2">
                     <span className="text-[11px] text-gray-400 flex-shrink-0">🔊</span>
                     <input type="range" min="0" max="100" value={musicVolume}
                       onChange={e => handleVolumeChange(Number(e.target.value))}
                       className="flex-1 h-1 cursor-pointer"
                       style={{ accentColor }} />
                   </div>
                 </div>
               )}
             </div>}
             {user ? (
                <button onClick={() => setShowUserMenu(v => !v)}
                className="w-[112px] bg-white rounded-full px-3 py-1.5 font-black text-[11px] shadow-[2px_2px_0px_#333] truncate text-center border-2 lp-accent-border lp-accent-color-text">
                {displayName}
                </button>
             ) : (
                <button onClick={() => setShowAuth(true)}
                className="w-[112px] bg-white border-2 border-black rounded-full px-3 py-1.5 font-black text-[11px] shadow-[2px_2px_0px_black] text-center transition-all"
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                  Sign In / Up
                </button>
             )}
             <button onClick={() => setShowForm(true)}
                className="text-white font-black px-2.5 py-1.5 rounded-full text-[10px] shadow-[2px_2px_0px_#333] whitespace-nowrap flex-shrink-0"
                style={{ backgroundColor: accentColor }}>
                + Submit Event
             </button>
             {/* Map-only collapse button (mobile) */}
             {isMap && (
               <button onClick={() => setHeaderCollapsed(true)}
                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black border-2 border-black bg-white shadow-[2px_2px_0px_black] transition-all"
                 title="Collapse header"
                 onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                 onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                 <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                   <polyline points="2 6 6 2 10 6"/>
                   <polyline points="2 10 6 6 10 10"/>
                 </svg>
                 Collapse
               </button>
             )}
          </div>
        </div>
      </header>

      {/* Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {isMap ? (
            <div className="h-full w-full relative">
              {/* Expand button — shown when header is collapsed, floats above map controls */}
              {headerCollapsed && (
                <button
                  onClick={() => setHeaderCollapsed(false)}
                  className="absolute top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-1.5 px-4 py-2 rounded-full font-black text-sm border-3 border-black bg-white shadow-[3px_3px_0px_black] transition-all"
                  title="Expand header"
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 6 6 10 10 6"/>
                    <polyline points="2 2 6 6 10 2"/>
                  </svg>
                  Expand
                </button>
              )}
              <MapView events={events} headerCollapsed={headerCollapsed} />
            </div>
        ) : view === 'geo' ? (
          <div className="h-full overflow-hidden">
            <GeoPostView session={session} />
          </div>
        ) : (
          <main className="h-full overflow-y-auto" onScroll={handleScroll}>
            <div className="max-w-7xl mx-auto w-full">
              <TileView key={tileViewKey} events={events} eventsLoading={eventsLoading} />
            </div>
          </main>
        )}

        {/* Leaderboard Overlay */}
        {showLeaderboard && (
          <div
            className="fixed inset-0 z-[70] bg-white/55 backdrop-blur-sm p-2 md:p-4 overflow-y-auto"
            onClick={() => setShowLeaderboard(false)}
          >
              <div className="min-h-full flex items-center justify-center">
                <div
                  className="relative w-full max-w-md animate-in fade-in zoom-in duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Leaderboard onClose={() => setShowLeaderboard(false)} />
                </div>
              </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showForm && <EventSubmitForm onClose={() => setShowForm(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={handleAuthSuccess} />}

      {/* ── Ghost SoundCloud Player iframe (completely hidden, controls via SC Widget API) ── */}
      <iframe
        ref={scIframeRef}
        id="sc-ghost-player"
        width="0"
        height="0"
        allow="autoplay"
        src="https://w.soundcloud.com/player/?url=https%3A//soundcloud.com/justin-lapuff/sets/clout-culling-games&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=false"
        style={{ visibility: 'hidden', position: 'absolute', pointerEvents: 'none', top: 0, left: 0 }}
        title="SC Ghost Player"
      />
    </div>
  );
}