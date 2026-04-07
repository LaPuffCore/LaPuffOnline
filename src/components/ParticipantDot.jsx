import { useState, useEffect } from 'react';
import { pingNYCLocation, getNYCParticipantStatus } from '../lib/locationService';

// Status dot near logo — shows participant (green) or spectator (red)
// Click to run a location ping and update status
export default function ParticipantDot({ onStatusChange }) {
  const [status, setStatus] = useState(() => getNYCParticipantStatus());
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState(false);

  // Re-check status every 2 minutes
  useEffect(() => {
    const id = setInterval(() => setStatus(getNYCParticipantStatus()), 120000);
    return () => clearInterval(id);
  }, []);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const result = await pingNYCLocation();
      const s = result.inNYC ? 'participant' : 'spectator';
      setStatus(s);
      if (onStatusChange) onStatusChange(s, result);
    } catch {}
    setLoading(false);
  }

  const isParticipant = status === 'participant';
  const dotColor = loading ? '#eab308' : isParticipant ? '#22c55e' : '#ef4444';
  const labelColor = loading ? '#ca8a04' : isParticipant ? '#16a34a' : '#dc2626';

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        onMouseEnter={() => setTooltip(true)}
        onMouseLeave={() => setTooltip(false)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border-2 border-black bg-white hover:bg-gray-50 transition-colors shadow-[2px_2px_0px_black]"
      >
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${loading ? 'animate-pulse' : ''}`}
          style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
        />
        <span className="text-xs font-black" style={{ color: labelColor }}>
          {loading ? '...' : isParticipant ? 'participant' : 'spectator'}
        </span>
      </button>

      {tooltip && !loading && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-black text-white text-xs rounded-xl px-3 py-2 w-52 text-center font-medium shadow-lg whitespace-normal">
          {isParticipant
            ? '✅ NYC verified in last 24h. Click to re-verify.'
            : '📍 Click to ping your NYC location and become a participant.'}
        </div>
      )}
    </div>
  );
}