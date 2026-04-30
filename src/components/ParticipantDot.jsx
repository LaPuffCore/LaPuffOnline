// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { pingNYCLocation, getNYCParticipantStatus, markFavoriteContributions } from '../lib/locationService';
import { getValidSession } from '../lib/supabaseAuth';
import { awardPoints, POINTS, syncOrbiterPending } from '../lib/pointsSystem';

// Rate-limiting keys (stored in localStorage)
const ATTEMPTS_KEY = 'lapuff_participant_attempts'; // { hour: 'YYYY-MM-DDTHH', count: n }
const REFRESH_KEY  = 'lapuff_participant_refresh_at'; // unix ms of last successful refresh attempt
const MAX_ATTEMPTS = 5;

function getAttemptData() {
  try {
    const raw = JSON.parse(localStorage.getItem(ATTEMPTS_KEY));
    const nowHour = new Date().toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
    if (!raw || raw.hour !== nowHour) return { hour: nowHour, count: 0 };
    return raw;
  } catch { return { hour: new Date().toISOString().slice(0, 13), count: 0 }; }
}

function recordAttempt() {
  const d = getAttemptData();
  d.count += 1;
  try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(d)); } catch {}
}

function getParticipantExpiry() {
  try {
    const data = JSON.parse(localStorage.getItem('lapuff_nyc_24h'));
    if (!data?.timestamp) return null;
    return data.timestamp + 24 * 3600 * 1000; // ms
  } catch { return null; }
}

function formatTimeRemaining(msLeft) {
  if (msLeft <= 0) return '0m';
  const totalMin = Math.ceil(msLeft / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getMinutesUntilNextHour() {
  const now = new Date();
  return 60 - now.getMinutes();
}

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
  const [timeLeft, setTimeLeft] = useState(0); // ms remaining in participant window
  const progressTimerRef = useRef(null);
  const popupRef = useRef(null);

  // Refresh status + countdown every 30s
  useEffect(() => {
    const tick = () => {
      setStatus(getNYCParticipantStatus());
      const expiry = getParticipantExpiry();
      if (expiry) setTimeLeft(Math.max(0, expiry - Date.now()));
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // Also refresh countdown every minute for live countdown feel
  useEffect(() => {
    if (status !== 'participant') return;
    const id = setInterval(() => {
      const expiry = getParticipantExpiry();
      setTimeLeft(expiry ? Math.max(0, expiry - Date.now()) : 0);
    }, 60000);
    return () => clearInterval(id);
  }, [status]);

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
  const statusAccent = isParticipant ? '#22c55e' : '#ef4444';

  const attemptData = getAttemptData();
  const attemptsExceeded = attemptData.count >= MAX_ATTEMPTS;

  // 1-hour cooldown for participant refresh button
  function canRefresh() {
    try {
      const last = parseInt(localStorage.getItem(REFRESH_KEY) || '0', 10);
      return Date.now() - last > 3600 * 1000;
    } catch { return true; }
  }

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

  async function handleConfirm(isRefresh = false) {
    if (loading) return;

    // Check attempt rate limit (refresh uses the same bucket)
    const d = getAttemptData();
    if (d.count >= MAX_ATTEMPTS) return; // guard; UI should already block this

    recordAttempt();
    if (isRefresh) {
      try { localStorage.setItem(REFRESH_KEY, String(Date.now())); } catch {}
    }

    setManualOpen(true);
    setLoading(true);
    setStage('validating');
    setProgress(6);
    const startedAt = Date.now();

    progressTimerRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return 95;
        const remaining = 95 - prev;
        return prev + Math.max(0.4, remaining * 0.05);
      });
    }, 90);

    let nextStatus = null;
    let finalResultType = 'warning';
    let statusResultPayload = null;

    try {
      const result = await pingNYCLocation();

      if (isRefresh) {
        // Refresh: only update clock if inNYC; preserve participant status on failure
        if (result.inNYC) {
          nextStatus = 'participant';
          statusResultPayload = result;
          finalResultType = 'success';
        } else {
          // Keep existing participant status — do not demote
          nextStatus = isParticipant ? 'participant' : 'orbiter';
          statusResultPayload = result;
          finalResultType = 'fail';
        }
      } else {
        nextStatus = result.inNYC ? 'participant' : 'orbiter';
        statusResultPayload = result;
        finalResultType = result.inNYC ? 'success' : 'fail';
      }

      if (result.inNYC) {
        const session = await getValidSession();
        if (session?.user?.id) {
          await syncOrbiterPending(session);
          const eventsContributed = await markFavoriteContributions(session);
          if (eventsContributed > 0) {
            const pointsAmount = eventsContributed * POINTS.EVENT_FAVORITED;
            const newTotal = await awardPoints(
              session,
              pointsAmount,
              `Favorite point contributions (${eventsContributed} event${eventsContributed > 1 ? 's' : ''} as active participant)`
            );
            if (newTotal !== null) {
              statusResultPayload = { ...statusResultPayload, clout_points: newTotal };
            }
          }
        }
      }
    } catch (err) {
      console.warn('Ping failed:', err);
      finalResultType = 'warning';
      if (isRefresh && isParticipant) nextStatus = 'participant'; // preserve
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
        // Refresh countdown
        const expiry = getParticipantExpiry();
        if (expiry) setTimeLeft(Math.max(0, expiry - Date.now()));
      }
      setResultType(finalResultType);
      setProgress(100);
      setLoading(false);
      setTimeout(() => setStage('result'), 160);
    }
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
          <p className="mt-2 text-xs font-black text-red-700">
            {isParticipant ? "Not in NYC — your Participant status is unchanged." : "You are not in NYC and maintain class 'Orbiter'"}
          </p>
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

  // ─── Participant popup (when already participant) ───────────────────────────
  function renderParticipantPrompt() {
    const refreshAllowed = canRefresh();
    const attemptsLeft = MAX_ATTEMPTS - getAttemptData().count;
    return (
      <>
        <div className="flex flex-col items-center gap-1 mb-2">
          <span className="text-2xl leading-none">🟢</span>
          <p className="font-black text-[13px] text-emerald-300 uppercase tracking-tight">Participant Active</p>
          <div className="mt-1 px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-center">
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Status expires in</p>
            <p className="text-xl font-black text-emerald-300 leading-none mt-0.5">{formatTimeRemaining(timeLeft)}</p>
          </div>
        </div>
        <div className="my-2.5 h-px bg-white/20" />
        {!refreshAllowed ? (
          <p className="text-[10px] text-white/50 text-center italic">Refresh available in ~1hr</p>
        ) : attemptsLeft <= 0 ? (
          <p className="text-[10px] text-yellow-300 text-center font-bold">
            Please wait until {new Date(new Date().setMinutes(0, 0, 0) + 3600000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to try again ({getMinutesUntilNextHour()}min)
          </p>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); handleConfirm(true); }}
            className="w-full rounded-lg border border-emerald-300/70 bg-emerald-500/20 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-emerald-500/35 text-center"
          >
            🔄 Refresh Status
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); closePopup(); }}
          className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-white/20"
        >
          Close
        </button>
      </>
    );
  }

  // ─── Orbiter prompt ─────────────────────────────────────────────────────────
  function renderOrbiterPrompt() {
    if (isOffline) {
      return (
        <>
          <p className="mb-3">You are currently in Offline cache mode. Reconnect to upgrade with a one-time private location ping.</p>
          <div className="my-2 h-px bg-white/30" />
          <button
            onClick={e => { e.stopPropagation(); closePopup(); }}
            className="w-full rounded-lg border border-white/40 bg-white/10 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-white/20"
          >
            Close
          </button>
        </>
      );
    }

    const attemptsLeft = MAX_ATTEMPTS - getAttemptData().count;

    if (attemptsLeft <= 0) {
      const nextHourTime = new Date(new Date().setMinutes(0, 0, 0) + 3600000)
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return (
        <>
          <p className="font-black text-[13px] text-center mb-2">Attempts Exceeded</p>
          <p className="text-[11px] text-yellow-200 text-center">
            Please wait until <span className="font-black text-yellow-300">{nextHourTime}</span> to try again ({getMinutesUntilNextHour()} min)
          </p>
          <div className="my-3 h-px bg-white/30" />
          <button
            onClick={e => { e.stopPropagation(); closePopup(); }}
            className="w-full rounded-lg border border-white/40 bg-white/10 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-white/20"
          >
            Got it
          </button>
        </>
      );
    }

    return (
      <>
        {/* Title */}
        <p className="font-black text-[14px] text-center mb-2 tracking-tight">Upgrade to Participant?</p>

        {/* Bullets */}
        <div className="flex flex-col gap-1.5 text-left mb-1">
          <div className="flex items-start gap-1.5">
            <span className="text-white/60 text-[11px] mt-px leading-none">•</span>
            <p className="text-[11px] text-white/80 leading-snug">
              Verify your NYC location with a one-time, double-blind ping.
            </p>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="text-white/60 text-[11px] mt-px leading-none">•</span>
            <p className="text-[11px] text-white/80 leading-snug">
              Unlocks Participant status for 24hrs: earn clout points with checkins, use the exclusive tag and more.
            </p>
          </div>
        </div>

        <div className="my-2.5 h-px bg-white/30" />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={e => { e.stopPropagation(); closePopup(); }}
            className="rounded-lg border border-white/40 bg-white/10 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-white/20"
          >
            No
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleConfirm(false); }}
            className="rounded-lg border border-lime-300/70 bg-lime-500/20 px-2 py-1.5 text-[11px] font-black uppercase tracking-tight hover:bg-lime-500/35"
          >
            Yes
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="relative" onMouseLeave={() => { if (!manualOpen) setHoverOpen(false); }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (manualOpen) {
            // Do not close while verifying location — wait for result
            if (stage !== 'validating') closePopup();
            return;
          }
          openPrompt();
        }}
        onMouseEnter={() => { setHoverOpen(true); setBtnHovered(true); }}
        onMouseLeave={() => setBtnHovered(false)}
        className="flex items-center gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3.5 md:py-2.5 rounded-full md:rounded-2xl border-2 md:border-3 transition-colors shadow-[2px_2px_0px_black] md:shadow-[3px_3px_0px_black]"
        style={{
          backgroundColor: btnHovered ? statusAccent : '#fff',
          borderColor: btnHovered ? statusAccent : '#000',
          color: btnHovered ? '#fff' : undefined,
        }}
      >
        <span
          className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full flex-shrink-0 ${loading ? 'animate-pulse' : ''}`}
          style={{ background: btnHovered ? '#fff' : dotColor, boxShadow: `0 0 6px ${btnHovered ? '#fff' : dotColor}` }}
        />
        <span className="text-[11px] md:text-xs font-black uppercase tracking-tighter" style={{ color: btnHovered ? '#fff' : labelColor }}>
          {loading && stage === 'validating' ? 'syncing' : statusLabel}
        </span>
      </button>

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
          className="absolute top-12 left-0 sm:left-auto sm:right-0 md:right-auto md:left-0 md:translate-x-0 z-[99999] bg-black text-white text-[11px] rounded-2xl px-3 py-3 w-72 max-w-[calc(100vw-1rem)] font-bold shadow-lg whitespace-normal leading-snug"
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
            isParticipant ? renderParticipantPrompt() : renderOrbiterPrompt()
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
