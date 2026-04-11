// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { pingNYCLocation, getNYCParticipantStatus, markFavoriteContributions } from '../lib/locationService';
import { getValidSession } from '../lib/supabaseAuth';
import { awardPoints, POINTS } from '../lib/pointsSystem';

/**
 * Status dot near logo shows participant (green) or orbiter (red)
 * Hover reveals prompt on desktop, click or touch opens interactive prompt on all devices.
 * @param {{ onStatusChange?: (status: string, result: any) => void }} props
 */
export default function ParticipantDot({ onStatusChange }) {
  const [status, setStatus] = useState(() => getNYCParticipantStatus());
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [loading, setLoading] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [stage, setStage] = useState('prompt'); // prompt | validating | result
  const [progress, setProgress] = useState(0);
  const [resultType, setResultType] = useState(null); // success | fail | warning
  const progressTimerRef = useRef(null);
  const popupRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setStatus(getNYCParticipantStatus()), 120000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  const [btnHovered, setBtnHovered] = useState(false);
  const popupOpen = manualOpen || hoverOpen;
  const isParticipant = status === 'participant';
  const statusLabel = isParticipant ? 'participant' : (isOffline ? 'offline' : 'orbiter');
  const dotColor = loading ? '#eab308' : isParticipant ? '#22c55e' : '#ef4444';
  const labelColor = loading ? '#ca8a04' : isParticipant ? '#16a34a' : '#dc2626';
  const statusAccent = isParticipant ? '#22c55e' : '#ef4444'; // green or red

  function resetPromptState() {
    setStage('prompt');
    setResultType(null);
    setProgress(0);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function closePopup() {
    setManualOpen(false);
    setHoverOpen(false);
    resetPromptState();
  }

  function openPrompt() {
    setManualOpen(true);
    resetPromptState();
  }

  async function handleConfirm() {
    if (loading) return;

    // Lock the popup open for the full validation flow regardless of hover state
    setManualOpen(true);
    setLoading(true);
    setStage('validating');
    setProgress(6);
    const startedAt = Date.now();

    progressTimerRef.current = setInterval(() => {
      setProgress(prev => (prev >= 92 ? prev : prev + Math.floor(Math.random() * 8 + 2)));
    }, 140);

    let nextStatus = null;
    let finalResultType = 'warning';
    let statusResultPayload = null;

    try {
      const result = await pingNYCLocation();
      nextStatus = result.inNYC ? 'participant' : 'orbiter';
      statusResultPayload = result;

      if (result.inNYC) {
        const session = await getValidSession();
        if (session?.user?.id) {
          const eventsContributed = await markFavoriteContributions(session);
          if (eventsContributed > 0) {
            const pointsAmount = eventsContributed * POINTS.EVENT_FAVORITED;
            const awarded = await awardPoints(
              session,
              pointsAmount,
              `Favorite point contributions (${eventsContributed} event${eventsContributed > 1 ? 's' : ''} as active participant)`
            );
            if (awarded) {
              console.log(`Awarded ${pointsAmount} points for ${eventsContributed} favorite(s)`);
            }
          }
        }
      }

      finalResultType = result.inNYC ? 'success' : 'fail';
    } catch (err) {
      console.warn('Ping failed:', err);
      finalResultType = 'warning';
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 3000) {
        await new Promise(resolve => setTimeout(resolve, 3000 - elapsed));
      }

      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }

      if (nextStatus) {
        setStatus(nextStatus);
        if (onStatusChange) onStatusChange(nextStatus, statusResultPayload);
      }

      setResultType(finalResultType);
      setProgress(100);
      setLoading(false);
      setTimeout(() => setStage('result'), 160);
    }
  }

  function renderPromptText() {
    if (isParticipant) {
      return 'would you like to re-sync your Participant Status? (Disables every 24 hours)';
    }
    if (isOffline) {
      return 'You are currently in Offline cache mode. Reconnect to upgrade with a one-time private location ping.';
    }
    return 'Would you like to upgrade from Orbiter with a one time and private location ping?';
  }

  function renderResult() {
    if (resultType === 'success') {
      return (
        <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-center">
          <div className="text-4xl leading-none">✅</div>
          <p className="mt-2 text-xs font-black text-emerald-700">You have been made a 'Participant'</p>
        </div>
      );
    }

    if (resultType === 'fail') {
      return (
        <div className="mt-3 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-center">
          <div className="text-4xl leading-none">❌</div>
          <p className="mt-2 text-xs font-black text-red-700">You are not in NYC and maintain class 'Orbiter'</p>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-center">
        <div className="text-4xl leading-none">⚠️</div>
        <p className="mt-2 text-xs font-black text-amber-700">Check location permissions and try again</p>
      </div>
    );
  }

  return (
    <div className="relative" onMouseLeave={() => { if (!manualOpen) setHoverOpen(false); }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (manualOpen) {
            closePopup();
          } else {
            openPrompt();
          }
        }}
        onMouseEnter={() => { setHoverOpen(true); setBtnHovered(true); }}
        onMouseLeave={() => setBtnHovered(false)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border-2 transition-colors shadow-[2px_2px_0px_black]"
        style={{
          backgroundColor: btnHovered ? statusAccent : '#fff',
          borderColor: btnHovered ? statusAccent : '#000',
          color: btnHovered ? '#fff' : undefined,
        }}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${loading ? 'animate-pulse' : ''}`}
          style={{ background: btnHovered ? '#fff' : dotColor, boxShadow: `0 0 6px ${btnHovered ? '#fff' : dotColor}` }}
        />
        <span className="text-xs font-black uppercase tracking-tighter" style={{ color: btnHovered ? '#fff' : labelColor }}>
          {loading && stage === 'validating' ? 'syncing' : statusLabel}
        </span>
      </button>

      {/* Invisible bridge covers the gap between button bottom and popup top so hover doesn't dismiss mid-travel */}
      {hoverOpen && !manualOpen && (
        <div
          className="absolute top-full left-0 right-0 h-3"
          onMouseEnter={() => setHoverOpen(true)}
        />
      )}

      {popupOpen && (
        <div
          ref={popupRef}
          onMouseEnter={() => setHoverOpen(true)}
          className="absolute top-10 left-0 sm:left-auto sm:right-0 md:right-auto md:left-1/2 md:-translate-x-1/2 z-50 bg-black text-white text-[11px] rounded-2xl px-3 py-3 w-72 max-w-[calc(100vw-0.5rem)] text-center font-bold shadow-lg whitespace-normal leading-snug"
        >
          {stage === 'result' && (
            <button
              onClick={(e) => { e.stopPropagation(); closePopup(); }}
              className="absolute -top-2 -right-2 w-7 h-7 rounded-full border-2 border-black bg-white text-black hover:bg-gray-100 flex items-center justify-center text-xs font-black leading-none z-30 shadow-[2px_2px_0px_black]"
              aria-label="Close"
            >
              X
            </button>
          )}

          {stage === 'prompt' && (
            <>
              <p>{renderPromptText()}</p>
              <div className="my-3 h-px bg-white/30" />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); closePopup(); }}
                  className="rounded-lg border border-white/40 bg-white/10 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-white/20"
                >
                  No
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleConfirm(); }}
                  className="rounded-lg border border-lime-300/70 bg-lime-500/20 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-lime-500/35"
                >
                  Yes
                </button>
              </div>
            </>
          )}

          {stage === 'validating' && (
            <div className="pt-1">
              <div className="mx-auto h-20 w-20 rounded-full border border-emerald-300/40 bg-gradient-to-br from-emerald-300/10 via-cyan-300/10 to-lime-300/10 flex items-center justify-center animate-spin">
                <div className="h-14 w-14 rounded-full border border-emerald-200/40 grid grid-cols-4 grid-rows-4 text-[8px] text-emerald-200/80 leading-none">
                  {'0101010011111010'.split('').map((n, i) => (
                    <span key={i} className="flex items-center justify-center animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>{n}</span>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[11px] font-black uppercase tracking-wide">Validating Location....</p>
              <div className="mt-2 h-2 w-full rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-300 via-lime-300 to-cyan-300 transition-all duration-200"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>
          )}

          {stage === 'result' && renderResult()}
        </div>
      )}
    </div>
  );
}
