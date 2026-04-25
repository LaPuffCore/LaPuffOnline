import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getReferralCode } from '../lib/pointsSystem';

export default function ReferralModal({ user, onClose }) {
  const [code, setCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCode() {
      if (user) {
        // PointsSystem helper updated in previous step
        const refCode = await getReferralCode({ user, access_token: true });
        setCode(refCode);
        setLoading(false);
      }
    }
    fetchCode();
  }, [user]);

  const handleCopy = () => {
    if (!code) return;
    const link = `${window.location.origin}/?ref=${code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const modal = (
    <div className="lp-theme-scope fixed inset-0 z-[100000] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      {/* Modal Container */}
      <div className="bg-white border-4 border-black w-full max-w-sm rounded-[32px] shadow-[12px_12px_0px_black] overflow-hidden animate-in zoom-in duration-200">
        
        {/* Header Section */}
        <div className="bg-[#7C3AED] p-6 border-b-4 border-black text-white relative">
          <button 
            onClick={onClose} 
            className="absolute top-4 right-4 bg-black text-white w-8 h-8 rounded-full border-2 border-white flex items-center justify-center font-black text-xs hover:scale-110 active:scale-95 transition-transform z-10"
          >
            X
          </button>
          <div className="space-y-1">
            <h2 className="font-black text-2xl leading-none uppercase tracking-tighter">Refer A User</h2>
            <p className="text-[10px] font-bold opacity-90 uppercase tracking-[0.2em]">Expansion Protocol v1.0</p>
          </div>
        </div>

        {/* Body Section */}
        <div className="p-6 space-y-6">
          
          {/* Link Generator Area */}
          <div className="space-y-2">
            <label className="font-black text-[10px] text-gray-400 uppercase tracking-widest ml-1">
              Your Unique Portal Link
            </label>
            <div className="flex items-center gap-2 bg-gray-100 border-3 border-black rounded-2xl p-2 transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-[#7C3AED]/20">
              <input 
                readOnly 
                value={loading ? 'GENERATING...' : `${window.location.host}/?ref=${code}`} 
                className="flex-1 bg-transparent border-none outline-none font-bold text-[11px] px-2 truncate text-gray-600"
              />
              <button 
                onClick={handleCopy}
                disabled={loading}
                className={`w-10 h-10 rounded-xl border-2 border-black flex items-center justify-center transition-all active:scale-90 relative group ${copied ? 'bg-green-400' : 'bg-white hover:bg-violet-100 disabled:opacity-50'}`}
              >
                <span className={`text-lg transition-transform ${copied ? 'scale-0' : 'scale-100'}`}>📎</span>
                {copied && <span className="absolute inset-0 flex items-center justify-center font-black text-[10px] animate-in zoom-in">✔</span>}
                
                {/* Hover Tooltip */}
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap font-black transition-opacity">
                  {copied ? 'COPIED!' : 'COPY LINK'}
                </div>
              </button>
            </div>
          </div>

          {/* Roadmap / Value Proposition */}
          <div className="bg-violet-50 border-2 border-[#7C3AED] border-dashed rounded-2xl p-4">
            <div className="flex gap-3">
              <div className="text-xl bg-white w-10 h-10 rounded-lg border-2 border-black flex items-center justify-center flex-shrink-0 shadow-[2px_2px_0px_black]">
                📈
              </div>
              <div className="space-y-1">
                <h4 className="font-black text-[#7C3AED] text-xs uppercase tracking-tight">Clout Roadmap</h4>
                <p className="text-[11px] font-bold text-gray-500 leading-tight">
                  Recruit new participants to the grid. Every unique email verified through your link grants you <span className="text-[#7C3AED] font-black">+50 Clout Points</span>.
                </p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <button 
            onClick={onClose}
            className="w-full bg-white border-3 border-black py-3 rounded-2xl font-black text-sm hover:bg-gray-50 shadow-[4px_4px_0px_black] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
          >
            RETURN TO GRID
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}