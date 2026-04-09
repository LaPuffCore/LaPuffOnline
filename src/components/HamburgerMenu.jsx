import { useState, useRef, useEffect } from 'react';
import { getFavorites } from '../lib/favorites';
import { Link } from 'react-router-dom';
import ReferralModal from './ReferralModal';

export default function HamburgerMenu({ events, user, onAuthClick }) {
  const [open, setOpen] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    setFavCount(getFavorites().length);
    const handler = () => setFavCount(getFavorites().length);
    window.addEventListener('favoritesChanged', handler);
    return () => window.removeEventListener('favoritesChanged', handler);
  }, []);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-11 h-11 border-3 border-black rounded-2xl flex flex-col items-center justify-center gap-1 shadow-[3px_3px_0px_black] transition-colors ${open ? 'bg-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
      >
        <span className={`w-5 h-0.5 rounded transition-colors ${open ? 'bg-white' : 'bg-black'}`}></span>
        <span className={`w-5 h-0.5 rounded transition-colors ${open ? 'bg-white' : 'bg-black'}`}></span>
        <span className={`w-5 h-0.5 rounded transition-colors ${open ? 'bg-white' : 'bg-black'}`}></span>
      </button>

      {open && (
        <div className="absolute right-0 top-14 w-60 bg-white border-3 border-black rounded-3xl shadow-[8px_8px_0px_black] z-[999] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-5 pt-4 pb-2 border-b-2 border-black">
            <h3 className="font-black text-base uppercase tracking-tight">System Menu</h3>
          </div>
          
          <div className="p-2">
            <Link to="/favorites" onClick={() => setOpen(false)}
              className="w-full text-left px-4 py-3 rounded-2xl hover:bg-violet-50 font-bold flex items-center gap-3 transition-colors">
              <span className="text-xl">⭐</span>
              <span>My Favorites <span className="text-[#7C3AED] text-sm font-black">({favCount})</span></span>
            </Link>

            <Link to="/calendar" onClick={() => setOpen(false)}
              className="w-full text-left px-4 py-3 rounded-2xl hover:bg-violet-50 font-bold flex items-center gap-3 transition-colors">
              <span className="text-xl">📅</span>
              <span>Favorites Calendar</span>
            </Link>

            {/* NEUTRAL REFERRAL BUTTON */}
            <button 
              onClick={() => {
                setOpen(false);
                if (user) {
                  setShowReferral(true);
                } else {
                  onAuthClick();
                }
              }}
              className="w-full text-left px-4 py-3 rounded-2xl hover:bg-violet-50 font-bold flex items-center gap-3 transition-colors group"
            >
              <span className="text-xl group-hover:rotate-12 transition-transform">👥</span>
              <div className="flex flex-col">
                <span className="leading-none">Refer A User</span>
                <span className="text-[9px] text-[#7C3AED] font-black mt-1 uppercase">Expand The Network</span>
              </div>
            </button>

            <div className="border-t border-gray-100 mt-2 pt-2 px-4 pb-3">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">LaPuff Online · NYC</p>
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
    </div>
  );
}