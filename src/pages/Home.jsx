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

function SmartMarquee({ text, className = '' }) {
  const shouldMarquee = text && text.length > 12;
  return (
    <div className="overflow-hidden flex-1 min-w-0">
      <span className={`${shouldMarquee ? 'radio-marquee-inner' : ''} ${className}`} style={shouldMarquee ? { display: 'inline-block', whiteSpace: 'nowrap' } : { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {text}
      </span>
    </div>
  );
}

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
  const [currentMode,   setCurrentMode]   = useState(null); 
  const [currentTrack,  setCurrentTrack]  = useState(null); 
  const [showMusicMenu, setShowMusicMenu] = useState(false);
  const [musicVolume,   setMusicVolume]   = useState(80);
  
  // DUAL-IFRAME ARCHITECTURE — no w.load() ever called, both stations pre-loaded on mount
  const scWidgetCloutRef   = useRef(null);
  const scWidgetDimesRef   = useRef(null);
  
  const loadedPlaylistRef  = useRef(null); // active station: 'clout' | 'dimes' | null
  const musicVolumeRef     = useRef(80);
  const musicDesktopRef    = useRef(null);
  const musicMobileRef     = useRef(null);
  
  // JS-managed shuffle queue — cleared on every station swap
  const playlistQueueRef   = useRef([]); 
  const queuePointerRef    = useRef(0);  

  // Pre-armed track indices fetched on READY (eliminates async gap during click)
  const cloutArmedIndicesRef = useRef([]);
  const dimesArmedIndicesRef = useRef([]);
  // Guards against spurious PAUSE event that w.skip() fires on a cold widget
  const isStartingRef        = useRef(false);

  const CLOUT_URL = 'https://soundcloud.com/justin-lapuff/sets/clout-culling-games';
  const DIMES_URL = 'https://soundcloud.com/justin-lapuff/sets/dimes-square';

  const location = useLocation();
  const isMap = view === 'map';
  const displayName = user?.username || user?.user_metadata?.username || user?.email?.split('@')[0] || 'Account';

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const refCode = params.get('ref');
    if (refCode) {
      localStorage.setItem('lapuff_pending_referral', refCode);
      const timer = setTimeout(() => { if (!user) setShowAuth(true); }, 1000);
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
    const handleKey = (e) => { if (e.key === 'Escape') setShowLeaderboard(false); };
    if (showLeaderboard) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showLeaderboard]);

  const handleScroll = (e) => {
    if (window.innerWidth >= 768) return; 
    const scrollContainer = e.currentTarget;
    const currentScrollY = scrollContainer.scrollTop;
    const atTopOfTileViewport = currentScrollY <= 2;
    const MIN_DELTA = 4;
    const HIDE_AFTER_Y = 96;
    const HIDE_SCROLL_DISTANCE = 18;

    const delta = currentScrollY - lastScrollY.current;
    if (Math.abs(delta) < MIN_DELTA) {
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

  // ── SoundCloud Widget API (Dual Instances) ─────────────────────────────────

  const getActiveWidget = () => loadedPlaylistRef.current === 'clout' ? scWidgetCloutRef.current : scWidgetDimesRef.current;

  // Advance or reverse the JS-owned shuffle queue, skip absolutely
  function advanceQueue(direction = 1) {
    const w = getActiveWidget();
    const queue = playlistQueueRef.current;
    if (!w || queue.length === 0) return;
    queuePointerRef.current = (queuePointerRef.current + direction + queue.length) % queue.length;
    w.skip(queue[queuePointerRef.current]);
    w.play();
    setIsMusicOn(true);
  }

  // Start a station: uses pre-armed indices from READY so the entire click handler
  // is synchronous — no async gap that can let the browser's gesture token expire.
  function startStation(modeKey) {
    const activeW      = modeKey === 'clout' ? scWidgetCloutRef.current : scWidgetDimesRef.current;
    const inactiveW    = modeKey === 'clout' ? scWidgetDimesRef.current : scWidgetCloutRef.current;
    const armedIndices = modeKey === 'clout' ? cloutArmedIndicesRef.current : dimesArmedIndicesRef.current;
    if (!activeW) return;

    isStartingRef.current = true;
    loadedPlaylistRef.current = modeKey;
    setCurrentMode(modeKey);

    if (inactiveW) inactiveW.pause();

    // Shuffle the pre-fetched index list synchronously — no callback, no wait
    let indices = armedIndices.length > 0 ? [...armedIndices] : [0];
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    playlistQueueRef.current = indices;
    queuePointerRef.current  = 0;

    // Everything below runs in one synchronous block — gesture token never expires
    activeW.skip(indices[0]);
    activeW.setVolume(musicVolumeRef.current);
    activeW.play();
    setIsMusicOn(true);

    // Release the startup guard after skip()'s cold PAUSE has had time to fire
    setTimeout(() => { isStartingRef.current = false; }, 1000);
  }

  // Initialise BOTH widgets independently on mount
  useEffect(() => {
    function setupWidget(iframeId, widgetRefTarget, modeKey) {
      const iframe = document.getElementById(iframeId);
      if (!iframe || !window.SC) return;
      const w = window.SC.Widget(iframe);
      widgetRefTarget.current = w;
      const E = window.SC.Widget.Events;
      w.bind(E.READY, () => {
        w.setVolume(musicVolumeRef.current);
        // Pre-fetch track list so startStation can shuffle synchronously on click
        w.getSounds(sounds => {
          if (sounds && sounds.length > 0) {
            const indices = Array.from({ length: sounds.length }, (_, i) => i);
            if (modeKey === 'clout') cloutArmedIndicesRef.current = indices;
            else dimesArmedIndicesRef.current = indices;
          }
        });
      });
      w.bind(E.PLAY, () => {
        if (loadedPlaylistRef.current === modeKey) {
          setIsMusicOn(true);
          w.getCurrentSound(sound => {
            if (sound) setCurrentTrack({
              title:   sound.title || 'Unknown Track',
              artist:  sound.user?.username || '',
              url:     sound.permalink_url || '',
              artwork: sound.artwork_url ? sound.artwork_url.replace('-large', '-t300x300') : null,
            });
          });
        }
      });
      w.bind(E.PAUSE,  () => {
        // Ignore the spurious PAUSE that w.skip() fires on a cold widget during startup
        if (loadedPlaylistRef.current === modeKey && !isStartingRef.current) setIsMusicOn(false);
      });
      w.bind(E.FINISH, () => { if (loadedPlaylistRef.current === modeKey) advanceQueue(1); });
    }

    function initAllWidgets() {
      setupWidget('sc-ghost-clout', scWidgetCloutRef, 'clout');
      setupWidget('sc-ghost-dimes', scWidgetDimesRef, 'dimes');
    }

    if (window.SC) { initAllWidgets(); return; }
    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.onload = initAllWidgets;
    document.head.appendChild(script);
  }, []);

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
    if (loadedPlaylistRef.current === 'clout' && isMusicOn) {
      advanceQueue(1);
    } else {
      startStation('clout');
    }
  }

  function triggerDimesRadio() {
    if (loadedPlaylistRef.current === 'dimes' && isMusicOn) {
      advanceQueue(1);
    } else {
      startStation('dimes');
    }
  }

  function stopMusic() {
    setIsMusicOn(false);
    setCurrentMode(null);
    loadedPlaylistRef.current = null;
    playlistQueueRef.current  = [];
    queuePointerRef.current   = 0;
    setShowMusicMenu(false);
    if (scWidgetCloutRef.current) scWidgetCloutRef.current.pause();
    if (scWidgetDimesRef.current) scWidgetDimesRef.current.pause();
  }

  function handleVolumeChange(val) {
    setMusicVolume(val);
    musicVolumeRef.current = val;
    if (scWidgetCloutRef.current) scWidgetCloutRef.current.setVolume(val);
    if (scWidgetDimesRef.current) scWidgetDimesRef.current.setVolume(val);
  }

  function handlePrevTrack() { advanceQueue(-1); }
  function handleNextTrack() { advanceQueue(1);  }

  function handleTogglePlayPause() {
    const w = getActiveWidget();
    if (isMusicOn) {
      setIsMusicOn(false);
      if (w) w.pause();
    } else if (currentMode) {
      setIsMusicOn(true);
      if (w) w.play();
    } else {
      triggerCloutCullingGames();
    }
  }

  function handleMapClick() {
    setView('map');
    setShowLeaderboard(false);
    const alreadyPlayed = localStorage.getItem('lapuff_music_firstplayed');
    if (!alreadyPlayed) {
      localStorage.setItem('lapuff_music_firstplayed', '1');
      triggerCloutCullingGames();
    }
  }

  return (
    <div className="h-[100dvh] lp-page-bg flex flex-col overflow-hidden" style={{ fontFamily: "'Nunito', cursive, sans-serif" }}>
      {/* Header — hidden when map is active and user collapsed it */}
      <header ref={headerRef} className={`lp-topbar bg-white border-b-4 border-black z-50 shadow-[0_4px_0px_black] flex-shrink-0 transition-[margin-top,transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${(isMap && headerCollapsed) ? '-translate-y-full opacity-0' : 'translate-y-0'} ${isMap ? 'absolute w-full' : 'relative'}`} style={!isMap ? { marginTop: !showHeader && measuredHeaderH ? `-${measuredHeaderH}px` : '0px', opacity: !showHeader ? 0 : 1 } : {}}>
        <div className="max-w-7xl mx-auto px-3 py-2 md:px-4 md:py-3">
          {/* Top Row: Logo, Nav, Menu */}
          <div className="flex items-center gap-1 md:gap-2 md:justify-between md:relative">
            {/* Logo + Music Button */}
            <div className="flex items-center gap-2">
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

              {/* Desktop Music Button */}
              <div className="relative hidden md:block" ref={musicDesktopRef}>
                <button
                  onClick={() => setShowMusicMenu(v => !v)}
                  className={`w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-xl border-2 md:border-3 border-black bg-white shadow-[2px_2px_0px_black] md:shadow-[3px_3px_0px_black] transition-all hover:scale-105${isMusicOn ? ' radio-beat-btn' : ''}`}
                  title="Radio"
                  style={isMusicOn ? { borderColor: accentColor, boxShadow: `3px 3px 0px ${accentColor}`, color: accentColor } : {}}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className={isMusicOn ? 'radio-beat-icon' : ''} style={isMusicOn ? { filter: `drop-shadow(0 0 3px ${accentColor})` } : {}}>
                    <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                  </svg>
                </button>
                {showMusicMenu && (
                  <div className="absolute left-0 top-full mt-2 z-[60] w-52 bg-white border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] overflow-hidden">
                    <div className="px-3 py-1.5 border-b-2 border-gray-100">
                      <p className="font-black text-[10px] text-gray-400 uppercase tracking-widest">Radio</p>
                    </div>
                    <button
                      onClick={() => triggerCloutCullingGames()}
                      className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100 transition-colors"
                      style={currentMode === 'clout' ? { color: accentColor } : {}}>
                      <span>🎮</span>
                      <span className="flex-1">Clout Culling Games</span>
                      {currentMode === 'clout' && isMusicOn && <span className="text-[8px] animate-pulse" style={{ color: accentColor }}>▶</span>}
                    </button>
                    <button
                      onClick={() => triggerDimesRadio()}
                      className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100 transition-colors"
                      style={currentMode === 'dimes' ? { color: accentColor } : {}}>
                      <span>🎵</span>
                      <span className="flex-1">Dimes Radio</span>
                      {currentMode === 'dimes' && isMusicOn && <span className="text-[8px] animate-pulse" style={{ color: accentColor }}>▶</span>}
                    </button>
                    <button
                      onClick={() => stopMusic()}
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
                    <div className="px-3 pb-1.5 flex items-center gap-2">
                      <span className="text-[11px] text-gray-400 flex-shrink-0">🔊</span>
                      <input type="range" min="0" max="100" value={musicVolume}
                        onChange={e => handleVolumeChange(Number(e.target.value))}
                        className="flex-1 h-1 cursor-pointer"
                        style={{ accentColor }} />
                    </div>
                    {currentTrack && isMusicOn && (
                      <div className="px-3 pb-3">
                        <a href={currentTrack.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-xl border-2 border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-400 transition-all cursor-pointer no-underline overflow-hidden">
                          {currentTrack.artwork && (
                            <img src={currentTrack.artwork} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0 border border-gray-200" />
                          )}
                          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                            <SmartMarquee text={currentTrack.title} className="font-black text-[10px] text-gray-800 leading-tight" />
                            <p className="font-bold text-[9px] text-gray-500 truncate leading-tight mt-0.5">{currentTrack.artist}</p>
                          </div>
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* View Toggles — center */}
            <div className="flex items-center gap-1 md:gap-2 scale-90 md:scale-100 md:absolute md:left-1/2 md:-translate-x-1/2">
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
                  className="px-2.5 py-1 md:px-4 md:py-2 rounded-lg md:rounded-xl text-[8px] md:text-sm font-black transition-all flex flex-col md:flex-row items-center justify-center gap-0 md:gap-1"
                  style={view === 'geo' && !showLeaderboard ? { backgroundColor: accentColor, color: '#fff', boxShadow: '1px 1px 0px #333' } : {}}
                  onMouseEnter={e => { if (!(view === 'geo' && !showLeaderboard)) e.currentTarget.style.backgroundColor = accentColor + '30'; }}
                  onMouseLeave={e => { if (!(view === 'geo' && !showLeaderboard)) e.currentTarget.style.backgroundColor = ''; }}>
                  <span className="text-xs md:text-sm leading-none">🌍</span>
                  <span className="leading-none hidden md:inline"> Geo-Post</span>
                  <span className="leading-[1.15] md:hidden text-center">Geo-<br />Post</span>
                </button>
              </div>
            </div>

            {/* Desktop Actions / Mobile Hamburger */}
            <div className="flex items-center gap-2 ml-auto md:ml-0">
              {isMap && (
                <button onClick={() => setHeaderCollapsed(true)}
                  className="hidden md:flex items-center justify-center px-3 py-2 rounded-full font-black border-2 border-black bg-white shadow-[2px_2px_0px_black] transition-all"
                  title="Collapse header to see more map"
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                  <svg width="14" height="18" viewBox="0 0 12 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 7 6 3 10 7"/>
                    <polyline points="2 13 6 9 10 13"/>
                  </svg>
                </button>
              )}
              <button onClick={() => setShowForm(true)}
                className="hidden md:block text-white font-black px-3.5 py-1.5 rounded-full text-xs transition-all shadow-[2px_2px_0px_black] hover:scale-105 whitespace-nowrap text-center"
                style={{ backgroundColor: accentColor, minWidth: '112px' }}>
                + Submit Event
              </button>
              <div className="hidden md:block">
                {user ? (
                  <div className="relative">
                    <button onClick={() => setShowUserMenu(v => !v)}
                      className="w-[112px] bg-white rounded-full px-3 py-1.5 font-black text-xs hover:bg-violet-50 transition-colors shadow-[2px_2px_0px_#333] truncate text-center border-2 lp-accent-border lp-accent-color-text">
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
                    className="bg-white border-2 border-black rounded-full px-3.5 py-1.5 font-black text-xs transition-all shadow-[2px_2px_0px_black] whitespace-nowrap text-center"
                    style={{ minWidth: '112px' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                    Sign In / Up
                  </button>
                )}
              </div>
              <HamburgerMenu events={events} user={user} onAuthClick={() => setShowAuth(true)} />
            </div>
          </div>

          {/* Mobile Secondary Row */}
          <div className="flex md:hidden items-center justify-center gap-3 mt-2 pb-1">
            <div className="relative" ref={musicMobileRef}>
              <button
                onClick={() => setShowMusicMenu(v => !v)}
                className={`w-9 h-9 flex items-center justify-center rounded-xl border-2 border-black bg-white shadow-[2px_2px_0px_black] transition-all flex-shrink-0${isMusicOn ? ' radio-beat-btn' : ''}`}
                title="Radio"
                style={isMusicOn ? { borderColor: accentColor, boxShadow: `2px 2px 0px ${accentColor}`, color: accentColor } : {}}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" className={isMusicOn ? 'radio-beat-icon' : ''} style={isMusicOn ? { filter: `drop-shadow(0 0 3px ${accentColor})` } : {}}>
                  <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                </svg>
              </button>
              {showMusicMenu && (
                <div className="absolute left-0 top-full mt-2 z-[60] w-52 max-w-[calc(100vw-2rem)] bg-white border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] overflow-hidden">
                  <div className="px-3 py-1.5 border-b-2 border-gray-100">
                    <p className="font-black text-[10px] text-gray-400 uppercase tracking-widest">Radio</p>
                  </div>
                  <button
                    onClick={() => triggerCloutCullingGames()}
                    className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100 transition-colors"
                    style={currentMode === 'clout' ? { color: accentColor } : {}}>
                    <span>🎮</span>
                    <span className="flex-1">Clout Culling Games</span>
                    {currentMode === 'clout' && isMusicOn && <span className="text-[8px] animate-pulse" style={{ color: accentColor }}>▶</span>}
                  </button>
                  <button
                    onClick={() => triggerDimesRadio()}
                    className="w-full px-3 py-2 text-left text-xs font-black hover:bg-gray-50 flex items-center gap-2 border-b border-gray-100 transition-colors"
                    style={currentMode === 'dimes' ? { color: accentColor } : {}}>
                    <span>🎵</span>
                    <span className="flex-1">Dimes Radio</span>
                    {currentMode === 'dimes' && isMusicOn && <span className="text-[8px] animate-pulse" style={{ color: accentColor }}>▶</span>}
                  </button>
                  <button
                    onClick={() => stopMusic()}
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
                  <div className="px-3 pb-1.5 flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 flex-shrink-0">🔊</span>
                    <input type="range" min="0" max="100" value={musicVolume}
                      onChange={e => handleVolumeChange(Number(e.target.value))}
                      className="flex-1 h-1 cursor-pointer"
                      style={{ accentColor }} />
                  </div>
                  {currentTrack && isMusicOn && (
                    <div className="px-3 pb-3">
                      <a href={currentTrack.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-xl border-2 border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-400 transition-all cursor-pointer no-underline overflow-hidden">
                        {currentTrack.artwork && (
                          <img src={currentTrack.artwork} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0 border border-gray-200" />
                        )}
                        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                          <SmartMarquee text={currentTrack.title} className="font-black text-[10px] text-gray-800 leading-tight" />
                          <p className="font-bold text-[9px] text-gray-500 truncate leading-tight mt-0.5">{currentTrack.artist}</p>
                        </div>
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
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
              className="w-[112px] text-white font-black px-3 py-1.5 rounded-full text-[11px] shadow-[2px_2px_0px_black] whitespace-nowrap flex-shrink-0 text-center"
              style={{ backgroundColor: accentColor }}>
              + Submit Event
            </button>
            {isMap && (
              <button onClick={() => setHeaderCollapsed(true)}
                className="flex items-center justify-center px-2.5 py-1.5 rounded-full font-black border-2 border-black bg-white shadow-[2px_2px_0px_black] transition-all"
                title="Collapse header"
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                <svg width="11" height="14" viewBox="0 0 12 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 7 6 3 10 7"/>
                  <polyline points="2 13 6 9 10 13"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {isMap ? (
          <div className="h-full w-full relative">
            {headerCollapsed && (
              <button
                onClick={() => setHeaderCollapsed(false)}
                className="absolute top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center justify-center px-3 py-2 rounded-full font-black border-2 border-black bg-white shadow-[2px_2px_0px_black] transition-all"
                title="Expand header"
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = accentColor; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = accentColor; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}>
                <svg width="14" height="18" viewBox="0 0 12 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 3 6 7 10 3"/>
                  <polyline points="2 9 6 13 10 9"/>
                </svg>
              </button>
            )}
            <MapView events={events} headerCollapsed={headerCollapsed} />
          </div>
        ) : view === 'geo' ? (
          <div className="h-full overflow-y-auto">
            <GeoPostView session={session} />
          </div>
        ) : (
          <main className="h-full overflow-y-auto" onScroll={handleScroll}>
            <div className="max-w-7xl mx-auto w-full">
              <TileView key={tileViewKey} events={events} eventsLoading={eventsLoading} />
            </div>
          </main>
        )}

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

      {showForm && <EventSubmitForm onClose={() => setShowForm(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={handleAuthSuccess} />}

      {/* Two dedicated ghost players — pre-loaded on mount, never reloaded */}
      <iframe
        id="sc-ghost-clout"
        width="0" height="0" allow="autoplay"
        src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(CLOUT_URL)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=false`}
        style={{ visibility: 'hidden', position: 'absolute', pointerEvents: 'none', top: 0, left: 0 }}
        title="SC Ghost Clout"
      />
      <iframe
        id="sc-ghost-dimes"
        width="0" height="0" allow="autoplay"
        src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(DIMES_URL)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=false`}
        style={{ visibility: 'hidden', position: 'absolute', pointerEvents: 'none', top: 0, left: 0 }}
        title="SC Ghost Dimes"
      />
    </div>
  );
}
