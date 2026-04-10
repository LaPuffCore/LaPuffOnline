// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseAuth'; 
import { Trophy, Zap, ChevronRight, ChevronLeft } from 'lucide-react';

// ============================================================
// SAMPLE_MODE — set to false when done developing
// ============================================================
export const SAMPLE_MODE = true;

/** * @typedef {Object} LeaderboardUser
 * @property {string} username
 * @property {number} clout_points
 * @property {string} home_zip
 * @property {string} [bio]
 */

/** @type {LeaderboardUser[]} */
const MOCK_USERS = Array.from({ length: 50 }, (_, i) => ({
  username: `User_${Math.random().toString(36).substring(7)}`,
  clout_points: Math.floor(Math.random() * 5000) + (50 - i) * 100,
  home_zip: ['10002', '11211', '10009', '11206', '10013'][Math.floor(Math.random() * 5)],
  bio: "Sample bio for memetic visual testing."
}));

export default function Leaderboard() {
  /** @type {[LeaderboardUser[], Function]} */
  const [allUsers, setAllUsers] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(!SAMPLE_MODE);
  const [activeRow, setActiveRow] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  
  const USERS_PER_PAGE = 10;

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    async function fetchLeaders() {
      if (SAMPLE_MODE) {
        const sortedMocks = [...MOCK_USERS].sort((a, b) => b.clout_points - a.clout_points);
        setAllUsers(sortedMocks);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username, clout_points, home_zip, bio')
          .order('clout_points', { ascending: false })
          .limit(50);

        if (error) throw error;
        setAllUsers(data || []);
      } catch (err) {
        console.error("Leaderboard Sync Error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaders();
  }, []);

  const startIndex = currentPage * USERS_PER_PAGE;
  /** @type {LeaderboardUser[]} */
  const currentView = allUsers.slice(startIndex, startIndex + USERS_PER_PAGE);
  const totalPages = Math.ceil(allUsers.length / USERS_PER_PAGE);

  function tierFromRank(rank) {
    if (rank <= 3) return 'gold';
    if (rank <= 7) return 'silver';
    if (rank <= 10) return 'bronze';
    return 'rgb';
  }

  function tierTextClass(tier) {
    if (tier === 'gold') return 'text-amber-200';
    if (tier === 'silver') return 'text-slate-200';
    if (tier === 'bronze') return 'text-orange-200';
    return 'text-violet-100';
  }

  function tierShadow(tier, active) {
    if (!active) return 'none';
    if (tier === 'gold') return '-1px 0 rgba(255,120,0,0.9), 1px 0 rgba(255,230,80,0.9), 0 0 10px rgba(255,210,0,0.5)';
    if (tier === 'silver') return '-1px 0 rgba(140,180,255,0.85), 1px 0 rgba(255,255,255,0.9), 0 0 10px rgba(190,210,255,0.45)';
    if (tier === 'bronze') return '-1px 0 rgba(255,120,80,0.85), 1px 0 rgba(255,190,140,0.9), 0 0 10px rgba(230,140,80,0.45)';
    return '-1px 0 rgba(255,80,80,0.75), 1px 0 rgba(80,255,255,0.75), 0 0 8px rgba(170,120,255,0.4)';
  }

  if (loading) return <div className="p-4 font-black text-xs animate-pulse text-center text-black">SYNCING_CLOUT_INDEX...</div>;

  return (
    <div className="bg-black border-2 border-black rounded-xl overflow-hidden shadow-[4px_4px_0px_black] w-full max-w-sm mx-auto max-h-[calc(100dvh-1rem)] md:max-h-[calc(100dvh-3rem)]">
      {/* Header */}
      <div className="bg-violet-600 p-2.5 md:p-3 border-b-2 border-black flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-white" />
          <h2 className="text-white font-black text-[10px] md:text-xs tracking-tighter uppercase">Clout Index — Top 50</h2>
        </div>
        <div className="bg-black text-white text-[9px] px-2 py-0.5 rounded font-black">
          PAGE {currentPage + 1}/{totalPages || 1}
        </div>
      </div>

      <div className="bg-gray-100 border-b-2 border-black px-2.5 py-1 grid grid-cols-[22px_1fr_auto_62px] md:grid-cols-[22px_1fr_auto_72px] gap-2 text-[9px] md:text-[10px] font-black uppercase tracking-wide text-gray-600">
        <span>#</span>
        <span>Name</span>
        <span className="justify-self-end">Pts</span>
        <span className="justify-self-end">Zip</span>
      </div>

      {/* List */}
      <div className="bg-white divide-y-2 divide-gray-100 min-h-[360px] md:min-h-[480px] max-h-[calc(100dvh-13.5rem)] md:max-h-[calc(100dvh-16rem)] overflow-y-auto">
        {currentView.map((user, index) => (
          (() => {
            const rank = startIndex + index + 1;
            const tier = tierFromRank(rank);
            const rowKey = `${currentPage}-${user.username}`;
            const active = activeRow === rowKey;

            return (
          <div
            key={user.username}
            onMouseEnter={() => { if (!isMobile) setActiveRow(rowKey); }}
            onMouseLeave={() => { if (!isMobile) setActiveRow(null); }}
            onTouchStart={() => { if (isMobile) setActiveRow(rowKey); }}
            onClick={() => { if (isMobile) setActiveRow(prev => prev === rowKey ? null : rowKey); }}
            className={`px-2.5 py-2 md:p-3 grid grid-cols-[22px_1fr_auto_62px] md:grid-cols-[22px_1fr_auto_72px] items-center gap-2 transition-colors ${active ? 'bg-violet-100' : 'hover:bg-violet-50'}`}
          >
            <span className="font-black text-[10px] md:text-[11px] text-gray-400 w-5">{rank}</span>

            <div className="min-w-0">
              <p
                className={`relative font-black text-[12px] md:text-sm leading-none uppercase tracking-[0.06em] ${tierTextClass(tier)} truncate`}
                style={{
                  fontFamily: "'Orbitron','Rajdhani','Audiowide',monospace",
                  textShadow: tierShadow(tier, active),
                  transform: active ? 'translateX(0.2px)' : 'none',
                }}
              >
                {user.username}
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded-lg border border-black/5 justify-self-end">
              <Zap className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              <span className="font-black text-xs md:text-sm">{user.clout_points.toLocaleString()}</span>
            </div>

            <div className="justify-self-end text-[10px] md:text-[11px] font-black text-gray-600">
              {user.home_zip ? user.home_zip : <span className="italic font-bold">[NULL]</span>}
            </div>
          </div>
            );
          })()
        ))}
      </div>

      {/* Pagination Controls */}
      <div className="bg-gray-50 p-2 border-t-2 border-black flex items-center justify-between">
        <button 
          disabled={currentPage === 0}
          onClick={() => setCurrentPage(p => p - 1)}
          className="flex items-center gap-1 text-[10px] font-black uppercase disabled:opacity-30 hover:text-violet-600 transition-colors text-black"
        >
          <ChevronLeft className="w-4 h-4" /> Prev
        </button>
        
        <button 
          disabled={startIndex + USERS_PER_PAGE >= allUsers.length}
          onClick={() => setCurrentPage(p => p + 1)}
          className="flex items-center gap-1 text-[10px] font-black uppercase disabled:opacity-30 hover:text-violet-600 transition-colors text-black"
        >
          Show More <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}