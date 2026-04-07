import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseAuth'; // Adjust path if needed
import { Trophy, Medal, User } from 'lucide-react';

export default function Leaderboard() {
    const [leaders, setLeaders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchLeaders() {
            try {
                // Fetching from your 'profiles' table ordered by clout_points
                const { data, error } = await supabase
                    .from('profiles')
                    .select('username, clout_points, bio')
                    .order('clout_points', { ascending: false })
                    .limit(10);

                if (error) throw error;
                setLeaders(data || []);
            } catch (err) {
                console.error("Error loading leaderboard:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchLeaders();
    }, []);

    if (loading) return <div className="p-4 text-center text-slate-400 animate-pulse">Calculating Power Index...</div>;

    return (
        <div className="w-full max-w-md mx-auto bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 p-4 flex items-center justify-between">
                <h3 className="text-white font-bold flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    POWER INDEX
                </h3>
                <span className="text-slate-400 text-xs uppercase tracking-widest">Top 10</span>
            </div>

            <div className="divide-y divide-slate-100">
                {leaders.map((player, index) => (
                    <div key={player.username} className="flex items-center p-4 hover:bg-slate-50 transition-colors">
                        <div className="w-8 font-mono text-slate-400">
                            {index === 0 ? <Medal className="text-amber-500 w-5 h-5" /> : index + 1}
                        </div>
                        <div className="flex-1">
                            <p className="font-bold text-slate-800 flex items-center gap-2">
                                {player.username}
                                {index === 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">Archon</span>}
                            </p>
                            <p className="text-xs text-slate-500 truncate max-w-[200px]">{player.bio}</p>
                        </div>
                        <div className="text-right">
                            <p className="font-mono font-bold text-slate-900">{player.clout_points.toLocaleString()}</p>
                            <p className="text-[10px] text-slate-400 uppercase tracking-tighter">Clout</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}