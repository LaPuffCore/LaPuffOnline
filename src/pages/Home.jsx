import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import EventSubmitForm from '../components/EventSubmitForm';
import TileView from '../components/TileView';
import MapView from '../components/MapView';
import HamburgerMenu from '../components/HamburgerMenu';
import AuthModal from '../components/AuthModal';
import ParticipantDot from '../components/ParticipantDot';
// Updated imports to include the "Smart" session logic
import { getValidSession, signOut } from '../lib/supabaseAuth';

export default function Home({ events = [] }) {
  const [view, setView] = useState('tiles');
  const [showForm, setShowForm] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [user, setUser] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const isMap = view === 'map';

  // Improved Auth Logic: Triggers a silent refresh on mount if needed
  useEffect(() => {
    async function initAuth() {
      const session = await getValidSession();
      if (session?.user) {
        setUser(session.user);
      }
    }
    initAuth();
  }, []);

  function handleAuthSuccess() {
    // Re-run the valid session check to get the latest user data
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
      <header className="bg-white border-b-4 border-black z-50 shadow-[0_4px_0px_black] flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-11 h-11 bg-black rounded-2xl flex items-center justify-center text-2xl shadow-[3px_3px_0px_#7C3AED]">
                💨
              </div>
              <div>
                <h1 className="font-black text-lg leading-none">LaPuff Online</h1>
                <p className="text-xs text-gray-500 font-bold leading-none">NYC Events</p>
              </div>
              <ParticipantDot />
            </div>

            {/* View toggle + Leaderboard Link */}
            <div className="bg-gray-100 border-3 border-black rounded-2xl p-1 flex shadow-[3px_3px_0px_black]">
              <button onClick={() => setView('tiles')}
                className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${view === 'tiles' ? 'bg-[#7C3AED] text-white shadow-[2px_2px_0px_#333]' : 'hover:bg-gray-200'}`}>
                🎴 Tiles
              </button>
              <button onClick={() => setView('map')}
                className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${view === 'map' ? 'bg-[#7C3AED] text-white shadow-[2px_2px_0px_#333]' : 'hover:bg-gray-200'}`}>
                🗺️ Map
              </button>
              <Link to="/leaderboard" 
                className="px-4 py-2 rounded-xl text-sm font-black hover:bg-gray-200 transition-all flex items-center gap-1">
                🏆 Top
              </Link>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button onClick={() => setShowForm(true)}
                className="hidden md:block bg-[#7C3AED] text-white font-black px-5 py-2.5 rounded-full text-sm hover:bg-[#6D28D9] transition-all shadow-[3px_3px_0px_#333] hover:scale-105 whitespace-nowrap">
                + Submit Event
              </button>

              {/* Auth button */}
              {user ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(v => !v)}
                    className="flex items-center gap-2 bg-white border-3 border-[#7C3AED] rounded-full px-4 py-2 font-black text-sm text-[#7C3AED] hover:bg-violet-50 transition-colors shadow-[3px_3px_0px_#333]"
                  >
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

              <HamburgerMenu events={events} />
            </div>
          </div>
        </div>
      </header>

      {/* Content Area */}
      {isMap ? (
        <div className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
          <MapView events={events} />
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto w-full">
            <TileView events={events} />
          </div>
        </main>
      )}

      {/* Modals */}
      {showForm && <EventSubmitForm onClose={() => setShowForm(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={handleAuthSuccess} />}
    </div>
  );
}