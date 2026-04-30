import { useEffect, useRef, useState } from 'react';

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

export default function MapLoadingScreen({ progress, isFirstLoad, isDone, onComplete }) {
  const [currentMsg, setCurrentMsg] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
  const [msgKey, setMsgKey] = useState(0);
  const shuffledRef = useRef(shuffle(MESSAGES));
  const msgIdxRef = useRef(0);
  const timerRef = useRef(null);

  // Message rotation
  useEffect(() => {
    if (isDone) {
      clearTimeout(timerRef.current);
      return;
    }
    const rotate = () => {
      msgIdxRef.current = (msgIdxRef.current + 1) % shuffledRef.current.length;
      if (msgIdxRef.current === 0) shuffledRef.current = shuffle(MESSAGES);
      setCurrentMsg(shuffledRef.current[msgIdxRef.current]);
      setMsgKey(k => k + 1);
      timerRef.current = setTimeout(rotate, 500 + Math.random() * 500);
    };
    timerRef.current = setTimeout(rotate, 500 + Math.random() * 500);
    return () => clearTimeout(timerRef.current);
  }, [isDone]);

  // Fire onComplete 300ms after isDone
  useEffect(() => {
    if (!isDone) return;
    const t = setTimeout(onComplete, 300);
    return () => clearTimeout(t);
  }, [isDone, onComplete]);

  const barColor = isDone ? '#22c55e' : '#7C3AED';
  const displayProgress = isDone ? 100 : progress;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ background: '#0d0000', zIndex: 50, fontFamily: 'Nunito, sans-serif' }}
    >
      <style>{`
        @keyframes mls-glow-blink {
          0%   { opacity: 1;   text-shadow: 0 0 8px #7C3AED, 0 0 16px #7C3AED; }
          50%  { opacity: 0.4; text-shadow: none; }
          100% { opacity: 1;   text-shadow: 0 0 8px #7C3AED, 0 0 16px #7C3AED; }
        }
        .mls-msg {
          animation: mls-glow-blink 400ms ease-in-out infinite;
        }
      `}</style>

      {/* Title */}
      <h1
        className="text-white font-black text-2xl md:text-3xl mb-2 text-center px-6"
        style={{ letterSpacing: '-0.02em' }}
      >
        {isDone ? '✅ Cache Complete' : 'Loading Map Cache'}
      </h1>

      {/* Subtitle */}
      {!isDone && (
        <p className="text-white/50 text-xs md:text-sm text-center px-8 mb-8 max-w-md">
          {isFirstLoad
            ? 'This will be more intensive on first cache so that it can be much faster on any cache loads afterward'
            : 'Reloading map cache…'}
        </p>
      )}
      {isDone && <div className="mb-8" />}

      {/* Progress bar */}
      <div
        className="w-72 md:w-96 h-3 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      >
        <div
          style={{
            height: '100%',
            width: `${displayProgress}%`,
            background: barColor,
            borderRadius: 9999,
            transition: isDone ? 'background 0.15s ease, width 0.3s ease' : 'width 0.3s ease',
            boxShadow: isDone ? '0 0 12px #22c55e' : '0 0 10px #7C3AED88',
          }}
        />
      </div>

      {/* Rotating messages */}
      {!isDone && (
        <div className="mt-6 h-10 flex items-center justify-center px-8 max-w-lg text-center">
          <span
            key={msgKey}
            className="mls-msg text-[#7C3AED] text-xs md:text-sm italic"
            style={{
              maxWidth: '100%',
              display: 'block',
              lineHeight: 1.4,
            }}
          >
            {currentMsg}
          </span>
        </div>
      )}
    </div>
  );
}
