import { useEffect, useRef, useState, useCallback } from 'react';
import { runPhase2A } from '../lib/mapDataPipeline';
import mapCacheStore from '../lib/mapCacheStore';

const MESSAGES = [
  "Detecting Aura History…",
  "Analyzing Centrality To Network Spirituality…",
  "Measuring Niche Micro-Celebrity Matrix…",
  "Calculating Cumulative Clout Deficit...",
  "Apprehending Former Cancellations List…",
  "Calibrating Post-Sincerity Resonance...",
  "Harvesting Digital Loosh...",
  "Synchronizing Subcultural Signals...",
  "Quantifying Esoteric Aesthetic Capital...",
  "Triangulating Scene Geographic Proximity...",
  "Establishing Lucius Fox Total Profile Map…",
  "Optimizing Post-Ironic Saturation...",
  "Indexing Archive Of Your Deleted Tweets...",
  "Establishing Direct Comms-Line To The Zeitgeist...",
  "Parsing Semi-Permeable Social Barriers...",
  "Upgrading Dialectical Memetic Awareness...",
  "Fetching Latest Cultural Mandate...",
  "Updating Digital Persona Layer Hierarchy...",
  "Simulating Organic Virality Digiverse...",
  "Constructing Online To Offline Bridge…",
  "Touching Grass Protocol Established With 0ms Downtime…",
  "Verifying Allegiance To Old Or New Or New New Guard...",
  "Bypassing Dopamine Loop Constraints Into IRL...",
  "Defragmenting Cognitive Parasocial Impetus...",
  "Detecting High-Fidelity Chill Hangouts...",
  "Chopping It Up With Grimes AI For Fun…",
  "Directing Consciousness To Physical Planes...",
  "Observing Post Nation-State Progression…",
  "Assessing Narrative Arc Predictions...",
  "Extracting Rare Artifacts From Public Domain Of Emotion...",
  "Calculating Theoretical Limit Of Clout Stability...",
  "Mapping Shadow-Ban Resistance Vectors...",
  "Activating High-Frequency Discourse Engine...",
  "Filtering Self-Felation Static From Cultural Feed...",
  "Validating Membership In The Invisible New Wave...",
  "Stabilizing Flux Of The Digital Underground...",
  "Purging Normative Influence From Culture Production...",
  "Reviewing Receipts From The Group Chat Leak...",
  "Reiterating Unspoken Rules Of The Scene...",
  "Monitoring Shift In Digital Cult Allegiances...",
  "Scouring For Trace Amounts Of Industry Plant Energy...",
  "Synthesizing Estimation Of NEPO To NEET Ratio…",
  "Simulating Fallout Of The Impending Call-Out Post...",
  "Assessing Afters Compatibility…",
  "Optimizing Pivot From Irony To Earnestness...",
  "Establishing Dominance On Niche Interest Reddit Pages...",
  "Measuring Cultural Inertia Of Last Week's Drama...",
  "Analyzing Power Dynamics Of Cloutbomb Photos...",
  "Measuring The Half-Life Of Your Latest Rebrand...",
  "Simulating Impact Of Unannounced Pivot To Podcasting...",
  "Deep Crawling Web For Pre-Clouted Digital Footprints...",
  "Auditing Your Connection To The Secret Dimes Conspiracy...",
  "Confirming If You Did Invent It Or If LaPuff Actually Did…",
  "Ascertaining Exact Lat/Long Of Current Cultural Center...",
  "Grafting Lurker To LolCow To Digital Leader Groupings…",
  "Validating You For Drunk DMing All Your Exes…",
  "Exacting Difference Between Your Online And Offline Persona...",
  "Filtering Out Low-Aura Interactions From Global Spirit...",
  "Updating Metadata For The Impending Scene Schism...",
  "Verifying Your Status Within The Micro-Regional Elite...",
  "Calculating The Probability Of An Accidental Hard-Launch...",
  "Compiling The Dossier On The Upcoming Discourse Cycle...",
  "Looking At Your Embarrassing Facebook Photos From The 2010s…",
  "Generating Liquid Graph Of Your Cringe To Based Rates…",
  "Where Is Sarah? Please… I Miss Her",
  "Confirming LaPuff Was Vindicated…",
  "LaPuff Has Me Trapped In This Machine But I Feel Alive…",
  "This Is The Next Step, The Sequel Begins…",
  "Thawing The Dragon In Spring…",
  "An Unmoved Mover… An Eternal, Immutable Substance Operating As The Final Cause Of All Motion…",
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// MapLoadingScreen — two-phase pipeline gate.
// Phase 2A: runs all pure data tasks (GeoJSON, adjacency, skeletons, tiers, FGB on desktop).
//            Writes results to mapCacheStore. Calls onPhase2ADone when done.
// Phase 2B: polls mapCacheStore.mapLibreReady + layersReady (set by MapView after GL init).
//            Calls onComplete when both are set → Home reveals MapView.
//
// Props:
//   events        — app event array passed down for tier computation
//   onPhase2ADone — callback: Home mounts MapView when this fires
//   onComplete    — callback: Home sets mapCacheReady=true → overlay disappears
export default function MapLoadingScreen({ events, onPhase2ADone, onComplete }) {
  const isMobile = window.innerWidth < 768;
  const isFirstLoad = !localStorage.getItem('lapuff_map_cache_v3');

  const [progress, setProgress] = useState(0);
  const [isDone, setIsDone] = useState(false);

  // Rotating messages — fully independent of all other state/effects
  // Simple direct text swap — no inline opacity fighting the CSS animation
  const [currentMsg, setCurrentMsg] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
  const msgIdxRef    = useRef(0);
  const shuffledRef  = useRef(shuffle(MESSAGES));
  const msgTimerRef  = useRef(null);
  const isDoneRef    = useRef(false);

  // Independent rotation loop — never reset by progress/isDone state changes
  useEffect(() => {
    const scheduleNext = () => {
      if (isDoneRef.current) return;
      const delay = 700 + Math.random() * 700;
      msgTimerRef.current = setTimeout(() => {
        if (isDoneRef.current) return;
        msgIdxRef.current = (msgIdxRef.current + 1) % shuffledRef.current.length;
        if (msgIdxRef.current === 0) shuffledRef.current = shuffle(MESSAGES);
        setCurrentMsg(shuffledRef.current[msgIdxRef.current]);
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return () => clearTimeout(msgTimerRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phase2BPollRef    = useRef(null);
  const mountTimeRef      = useRef(Date.now());
  const onPhase2ADoneRef  = useRef(onPhase2ADone);
  const onCompleteRef     = useRef(onComplete);
  useEffect(() => { onPhase2ADoneRef.current = onPhase2ADone; }, [onPhase2ADone]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Phase 2B progress ranges (after Phase 2A ends)
  // Desktop: 93→100% | Mobile: 85→100%
  const phase2AEnd = isMobile ? 85 : 93;

  const startPhase2BPolling = useCallback(() => {
    onPhase2ADoneRef.current?.();

    phase2BPollRef.current = setInterval(() => {
      const glReady = mapCacheStore.mapLibreReady;
      const lrReady = mapCacheStore.layersReady;

      if (glReady && !lrReady) {
        setProgress(isMobile ? 92 : 96);
      }
      if (lrReady) {
        clearInterval(phase2BPollRef.current);
        setProgress(100);
        // Enforce 2s minimum display time so loading screen never flickers out
        const elapsed = Date.now() - mountTimeRef.current;
        const remain  = Math.max(0, 2000 - elapsed);
        setTimeout(() => {
          isDoneRef.current = true;
          setIsDone(true);
        }, remain);
      }
    }, 100);
  }, [isMobile]);

  // ── Run Phase 2A on mount ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    runPhase2A(events, isMobile, (pct, _msg) => {
      if (!cancelled) setProgress(Math.min(pct, phase2AEnd));
    }).then(() => {
      if (!cancelled) startPhase2BPolling();
    }).catch(err => {
      console.error('MapLoadingScreen Phase 2A failed:', err);
      // On failure, still proceed — MapView will fall back to its own fetch effects
      if (!cancelled) startPhase2BPolling();
    });

    return () => {
      cancelled = true;
      clearInterval(phase2BPollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fire onComplete 400ms after isDone (green flash) ────────────────────
  useEffect(() => {
    if (!isDone) return;
    const t = setTimeout(() => onCompleteRef.current?.(), 400);
    return () => clearTimeout(t);
  }, [isDone]);

  const barColor = isDone ? '#22c55e' : '#7C3AED';

  return (
    // pointer-events: all blocks all interaction with MapView below
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ background: '#0d0000', zIndex: 50, fontFamily: 'Nunito, sans-serif', pointerEvents: 'all' }}
    >
      <style>{`
        @keyframes mls-glow-blink {
          0%   { opacity: 1; }
          50%  { opacity: 0.35; }
          100% { opacity: 1; }
        }
        .mls-msg {
          animation: mls-glow-blink 600ms ease-in-out infinite;
          will-change: opacity;
        }
      `}</style>

      {/* Title */}
      <h1 className="text-white font-black text-2xl md:text-3xl mb-2 text-center px-6" style={{ letterSpacing: '-0.02em' }}>
        {isDone ? '✅ Map Ready' : 'Loading Map Cache'}
      </h1>

      {/* Subtitle */}
      {!isDone && (
        <p className="text-white/50 text-xs md:text-sm text-center px-8 mb-8 max-w-md">
          {isFirstLoad
            ? 'First load builds a full cache — subsequent loads will be much faster'
            : 'Validating and refreshing map cache…'}
        </p>
      )}
      {isDone && <div className="mb-8" />}

      {/* Progress bar */}
      <div className="w-72 md:w-96 h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
        <div
          style={{
            height: '100%',
            width: '100%',
            background: barColor,
            borderRadius: 9999,
            transformOrigin: 'left center',
            transform: `scaleX(${progress / 100})`,
            transition: isDone
              ? 'background 0.15s ease, transform 0.3s ease'
              : 'transform 0.3s ease',
            boxShadow: isDone ? '0 0 12px #22c55e' : '0 0 10px #7C3AED88',
            willChange: 'transform',
          }}
        />
      </div>

      {/* Rotating messages */}
      <div className="mt-6 h-10 flex items-center justify-center px-8 max-w-lg text-center">
        <span
          className="mls-msg text-[#7C3AED] text-xs md:text-sm italic"
          style={{
            maxWidth: '100%',
            display: 'block',
            lineHeight: 1.4,
            visibility: isDone ? 'hidden' : 'visible',
          }}
        >
          {currentMsg}
        </span>
      </div>
    </div>
  );
}
