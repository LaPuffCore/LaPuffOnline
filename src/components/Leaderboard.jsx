import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseAuth'; 
import { Trophy, Zap, ChevronRight, ChevronLeft } from 'lucide-react';

// ============================================================
// SAMPLE_MODE — set to false when done developing
// ============================================================
export const SAMPLE_MODE = true;

const MOCK_USERS = Array.from({ length: 50 }, (_, i) => ({
  username: `User_${Math.random().toString(36).substring(7)}`,
  clout_points: Math.floor(Math.random() * 5000) + (50 - i) * 100,
  home_zip: ['10002', '11211', '10009', '11206', '10013'][Math.floor(Math.random() * 5)],
  bio: "Sample bio for memetic visual testing."
}));

export default function Leaderboard() {
  const [allUsers, setAllUsers] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(!SAMPLE_MODE);
  
  const USERS_PER_PAGE = 10;

  useEffect(() => {
    async function fetchLeaders() {
      if (SAMPLE_MODE) {
        setAllUsers(MOCK_USERS.sort((a, b) => b.clout_points - a.clout_points));
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
  const currentView = allUsers.slice(startIndex, startIndex + USERS_PER_PAGE);
  const totalPages = Math.ceil(allUsers.length / USERS_PER_PAGE);

  if (loading) return <div className="p-4 font-black text-xs animate-pulse text-center">SYNCING_POWER_INDEX...</div>;

  return (
    <div className="bg-black border-2 border-black rounded-xl overflow-hidden shadow-[4px_4px_0px_black] w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="bg-violet-600 p-3 border-b-2 border-black flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-white" />
          <h2 className="text-white font-black text-xs tracking-tighter uppercase">Power Index — Top 50</h2>
        </div>
        <div className="bg-black text-white text-[9px] px-2 py-0.5 rounded font-black">
          PAGE {currentPage + 1}/{totalPages}
        </div>
      </div>

      {/* List */}
      <div className="bg-white divide-y-2 divide-gray-100 min-h-[480px]">
        {currentView.map((u, i) => (
          <div key={u.username} className="p-3 flex items-center justify-between hover:bg-violet-50 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-black text-[11px] text-gray-400 w-5">
                {startIndex + i + 1}
              </span>
              <div>
                <p className="font-black text-sm leading-none text-black">{u.username}</p>
                <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">{u.home_zip || 'Sector Unknown'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded-lg border border-black/5">
              <Zap className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              <span className="font-black text-sm">{u.clout_points.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Controls */}
      <div className="bg-gray-50 p-2 border-t-2 border-black flex items-center justify-between">
        <button 
          disabled={currentPage === 0}
          onClick={() => setCurrentPage(p => p - 1)}
          className="flex items-center gap-1 text-[10px] font-black uppercase disabled:opacity-30 hover:text-violet-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Prev
        </button>
        
        <button 
          disabled={startIndex + USERS_PER_PAGE >= allUsers.length}
          onClick={() => setCurrentPage(p => p + 1)}
          className="flex items-center gap-1 text-[10px] font-black uppercase disabled:opacity-30 hover:text-violet-600 transition-colors"
        >
          Show More <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}