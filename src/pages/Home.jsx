import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import EventSubmitForm from '../components/EventSubmitForm';
import TileView from '../components/TileView';
import MapView from '../components/MapView';
import HamburgerMenu from '../components/HamburgerMenu';
import AuthModal from '../components/AuthModal';
import ParticipantDot from '../components/ParticipantDot';
import Leaderboard from '../components/Leaderboard'; 
import { getValidSession, signOut } from '../lib/supabaseAuth';

export default function Home({ events = [] }) {
  const [view, setView] = useState('tiles');
  const [showForm, setShowForm] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [user, setUser] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const lastScrollY = useRef(0);
  
  const isMap = view === 'map';

  useEffect(() => {
    async function initAuth() {
      const session = await getValidSession();
      if (session?.user) setUser(session.user);
    }
    initAuth();
  }, []);

  // Handle mobile scroll to hide/show header
  const handleScroll = (e) => {
    if (window.innerWidth >= 768) return; // Only mobile
    const currentScrollY = e.currentTarget.scrollTop;
    
    if (currentScrollY > lastScrollY.current && currentScrollY > 80) {
      setShowHeader(false);
    } else {
      setShowHeader(true);
    }
    lastScrollY.current = currentScrollY;
  };

  function handleAuthSuccess() {
    getValidSession().then(session => {
      if (session) setUser(session.user);
      setShowAuth(false);
    });
  }

  async function handleLogout() {
    await signOut();
    setUser(null);
    setShowUserMenu(false);
  }

  return (
    <div className="h-[100dvh] bg-[#FAFAF8] flex flex-col overflow-hidden" style={{ fontFamily: "'Nunito', cursive, sans-serif" }}>
      {/* Header */}
      <header className={`bg-white border-b-4 border-black z-50 shadow-[0_4px_0px_black] flex-shrink-0 transition-transform duration-300 ${!showHeader ? '-translate-y-full absolute w-full' : 'translate-y-0 relative'}`}>
        <div className="max-w-7xl mx-auto px-3 py-2 md:px-4 md:py-3">
          {/* Top Row: Logo, Nav, Menu */}
          <div className="flex items-center justify-between gap-2">
            {/* Logo - Scaled down for mobile */}
            <div className="flex items-center gap-1.5 md:gap-2 scale-90 md:scale-100 origin-left">
              <div className="w-9 h-9 md:w-11 md:h-11 bg-black rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl shadow-[2px_2px_0px_#7C3AED] md:shadow-[3px_3px_0px_#7C3AED]">
                💨
              </div>
              <div className="hidden xs:block">
                <h1 className="font-black text-sm md:text-lg leading-none">LaPuff Online</h1>
                <p className="text-[10px] md:text-xs text-gray-500 font-bold leading-none">NYC Events</p>
              </div>
              <ParticipantDot />
            </div>

            {/* View Toggles - Scaled for mobile */}
            <div className="bg-gray-100 border-2 md:border-3 border-black rounded-xl md:rounded-2xl p-0.5 md:p-1 flex shadow-[2px_2px_0px_black] md:shadow-[3px_3px_0px_black] scale-90 md:scale-100">
              <button onClick={() => { setView('tiles'); setShowLeaderboard(false); setShowHeader(true); }}
                className={`px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all ${view === 'tiles' && !showLeaderboard ? 'bg-[#7C3AED] text-white shadow-[1px_1px_0px_#333]' : 'hover:bg-gray-200'}`}>
                🎴 Tiles
              </button>
              <button onClick={() => { setView('map'); setShowLeaderboard(false); }}
                className={`px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all ${view === 'map' && !showLeaderboard ? 'bg-[#7C3AED] text-white shadow-[1px_1px_0px_#333]' : 'hover:bg-gray-200'}`}>
                🗺️ Map
              </button>
              <button onClick={() => setShowLeaderboard(true)} 
                className={`px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all flex items-center gap-1 ${showLeaderboard ? 'bg-violet-600 text-white shadow-[1px_1px_0px_#333]' : 'hover:bg-gray-200'}`}>
                🏆 Top
              </button>
            </div>

            {/* Desktop Actions / Mobile Hamburger */}
            <div className="flex items-center gap-2">
              <button onClick={() => setShowForm(true)}
                className="hidden md:block bg-[#7C3AED] text-white font-black px-5 py-2.5 rounded-full text-sm hover:bg-[#6D28D9] transition-all shadow-[3px_3px_0px_#333] hover:scale-105 whitespace-nowrap">
                + Submit Event
              </button>

              <div className="hidden md:block">
                {user ? (
                  <div className="relative">
                    <button onClick={() => setShowUserMenu(v => !v)}
                      className="flex items-center gap-2 bg-white border-3 border-[#7C3AED] rounded-full px-4 py-2 font-black text-sm text-[#7C3AED] hover:bg-violet-50 transition-colors shadow-[3px_3px_0px_#333]">
                      💜 {user.username || user.email?.split('@')[0]}
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
                    className="bg-white border-3 border-black rounded-full px-4 py-2 font-black text-sm hover:bg-violet-50 transition-all shadow-[3px_3px_0px_black] whitespace-nowrap">
                    Sign In / Up
                  </button>
                )}
              </div>
              <HamburgerMenu events={events} />
            </div>
          </div>

          {/* Mobile Secondary Row: Auth + Submit (New centered row for mobile only) */}
          <div className="flex md:hidden items-center justify-center gap-3 mt-2 pb-1">
             {user ? (
                <button onClick={() => setShowUserMenu(v => !v)}
                  className="bg-white border-2 border-[#7C3AED] rounded-full px-3 py-1.5 font-black text-[11px] text-[#7C3AED] shadow-[2px_2px_0px_#333]">
                  💜 Profile
                </button>
             ) : (
                <button onClick={() => setShowAuth(true)}
                  className="bg-white border-2 border-black rounded-full px-3 py-1.5 font-black text-[11px] shadow-[2px_2px_0px_black]">
                  Sign In / Up
                </button>
             )}
             <button onClick={() => setShowForm(true)}
                className="bg-[#7C3AED] text-white font-black px-3 py-1.5 rounded-full text-[11px] shadow-[2px_2px_0px_#333]">
                + Submit Event
             </button>
          </div>
        </div>
      </header>

      {/* Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {isMap ? (
            <div className="h-full w-full">
              <MapView events={events} />
            </div>
        ) : (
          <main className="h-full overflow-y-auto" onScroll={handleScroll}>
            <div className={`max-w-7xl mx-auto w-full transition-all duration-300 ${!showHeader ? 'pt-2' : 'pt-0'}`}>
              <TileView events={events} />
            </div>
          </main>
        )}

        {/* Leaderboard Overlay */}
        {showLeaderboard && (
          <div className="absolute inset-0 z-40 bg-white/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="relative w-full max-w-md animate-in fade-in zoom-in duration-200">
                <button onClick={() => setShowLeaderboard(false)}
                  className="absolute -top-12 right-0 bg-black text-white px-4 py-2 rounded-full font-black text-xs shadow-[3px_3px_0px_#7C3AED]">
                  CLOSE [X]
                </button>
                <Leaderboard />
              </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showForm && <EventSubmitForm onClose={() => setShowForm(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={handleAuthSuccess} />}
    </div>
  );
}