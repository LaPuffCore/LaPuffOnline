import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const SEAM = 140;
// Final expanded y position (more negative = higher on screen, overlaps screen more)
const BOTTOM_END_MT = -180;
// How much further DOWN kogane bottom sits before expansion (positive = lower)
// Higher number = more gap / less initial overlap
const BOTTOM_INIT_EXTRA_DOWN = 200;
// X offset right for koganebottom (both positions)
const BOTTOM_X = 153;
// translateY for the small (1/3 scale) rest position.
// +60px added from previous iteration to push it down into view.
// Controls where the small images sit AND where fly-in/out targets aim.
const ZOOM_Y_START = 'calc(157px + 2.833vw)';
// The on-screen resting transform at 1/3 scale (fly-in destination / fly-out origin)
const ZOOM_START_TRANSFORM = `translateX(0px) translateY(${ZOOM_Y_START}) scale(0.333)`;
const ZOOM_FULL_TRANSFORM  = 'translateX(0px) translateY(0px) scale(1.0)';

// Pick a random offscreen direction at the small scale — same Y plane so it
// swoops in/out laterally or diagonally, keeping composition aligned in Z.
function randomOffscreen() {
  const y = ZOOM_Y_START;
  const opts = [
    `translateX(-150vw) translateY(${y}) scale(0.333)`,
    `translateX(150vw) translateY(${y}) scale(0.333)`,
    `translateX(-110vw) translateY(-110vh) scale(0.333)`,
    `translateX(110vw) translateY(-110vh) scale(0.333)`,
    `translateX(0px) translateY(-130vh) scale(0.333)`,
    `translateX(-110vw) translateY(110vh) scale(0.333)`,
    `translateX(110vw) translateY(110vh) scale(0.333)`,
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}

const NUM = {
  color: '#8B0000',
  textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 1px 0 #000',
  fontWeight: 900,
  flexShrink: 0,
  minWidth: '42px',
};

// Brighter saturated lime — all layers transparent so content always shows through
const GLASS_BG = [
  // Diagonal light reflection streak — faint
  'linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.01) 45%, rgba(255,255,255,0.05) 100%)',
  // Top-left radial highlight — glass catch-light
  'radial-gradient(ellipse at 28% 12%, rgba(220,255,120,0.10) 0%, transparent 48%)',
  // Bottom-right depth shadow
  'radial-gradient(ellipse at 72% 88%, rgba(0,60,5,0.12) 0%, transparent 48%)',
  // Main lime tint — transparent
  'linear-gradient(180deg, rgba(110,255,0,0.38) 0%, rgba(55,215,0,0.44) 100%)',
  // Deep base — semi-transparent so backdrop shows
  'rgba(4, 22, 0, 0.42)',
].join(', ');

// 3D depth illusion via inset shadow geometry — lighter overall
const GLASS_SHADOW = [
  // Top bright bevel (lit edge)
  'inset 0 4px 0 rgba(200,255,130,0.45)',
  // Bottom dark bevel (shadow edge — gives depth)
  'inset 0 -4px 0 rgba(0,40,5,0.35)',
  // Left bright edge (perspective light)
  'inset 5px 0 8px rgba(180,255,100,0.18)',
  // Right dark edge (perspective shadow — makes it feel like screen curves away)
  'inset -5px 0 12px rgba(0,30,0,0.30)',
  // Inner ambient green glow
  'inset 0 0 40px rgba(80,255,0,0.08)',
  // Inner top-center bright spot (lit glass center)
  'inset 0 20px 40px rgba(160,255,60,0.10)',
  // Outer glow
  '0 6px 32px rgba(80,255,0,0.18)',
  // Outer border line
  '0 0 0 1px rgba(120,255,40,0.28)',
].join(', ');

// ── Text processor ──────────────────────────────────────────────────────────
// Bold phrases (longest first to avoid partial matches)
const BOLD_PHRASES = [
  'Clout Culling Games',
  'Games Master LaPuff',
  'Official Clout Colony',
  'Clout Alias',
  'giga-mogged',
  'Simulated',
  'motion',
];
// Underline+uppercase words
const UL_WORDS = [
  "Player's", "Players", "Player",
  "Participants", "Participant",
  "Orbiters", "Orbiter",
  "Normies",
  "Fallen Off",
];

// Build combined regex — bold phrases | underline words (all case-sensitive, word-boundary where applicable)
const escapedBold = BOLD_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const escapedUl   = UL_WORDS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const COMBINED_RE = new RegExp(
  `(${escapedBold.join('|')})|(${escapedUl.join('|')})`,
  'g'
);

function styleText(text) {
  const parts = [];
  let last = 0, m;
  COMBINED_RE.lastIndex = 0;
  while ((m = COMBINED_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      // Bold phrase
      parts.push(<strong key={m.index}>{m[1]}</strong>);
    } else {
      // Underline + uppercase word
      parts.push(
        <span key={m.index} style={{ textDecoration: 'underline', fontWeight: 900 }}>
          {m[2].toUpperCase()}
        </span>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
// ───────────────────────────────────────────────────────────────────────────

export default function KoganePopup({ onClose }) {
  const [headerH, setHeaderH] = useState(72);
  const [screenH, setScreenH] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showLocked, setShowLocked] = useState(false);
  const contentInnerRef = useRef(null);
  const closingRef = useRef(false);
  const openTimersRef = useRef([]);

  // Zoom transform — initialised to a random offscreen position, flies in to ZOOM_START on open
  const [zoomTransform, setZoomTransform] = useState(() => randomOffscreen());
  const [zoomTransition, setZoomTransition] = useState('none');
  // Backdrop blur ramps from 0 to 10px when images load
  const [blurPx, setBlurPx] = useState(0);

  // Images use stable versioned URLs (no cache-bust) — preloaded on mount and on site load
  const base = import.meta.env?.BASE_URL ?? '/';
  const topSrc    = `${base}data/koganetop.png?v=6`;
  const bottomSrc = `${base}data/koganebottom.png?v=3`;

  const triggerClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Cancel any pending open-phase timers immediately
    openTimersRef.current.forEach(clearTimeout);
    openTimersRef.current = [];
    setClosing(true);
    setScreenH(0);
    // At 1700ms: zoom-out to ZOOM_START over 1000ms
    setTimeout(() => {
      setZoomTransition('transform 1000ms cubic-bezier(0.7,0,1,0.9)');
      requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(ZOOM_START_TRANSFORM)));
    }, 1700);
    // At 2700ms: zoom done → fly off-screen in random direction over 1000ms
    setTimeout(() => {
      const target = randomOffscreen();
      setZoomTransition('transform 1000ms cubic-bezier(0.7,0,1,0.9)');
      requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(target)));
    }, 2700);
    // At 3700ms: fully closed
    setTimeout(() => onClose?.(), 3700);
  }, [onClose]);

  useEffect(() => {
    const hdr = document.querySelector('header');
    if (hdr) setHeaderH(Math.round(hdr.getBoundingClientRect().height));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') triggerClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [triggerClose]);

  useEffect(() => {
    if (!document.getElementById('kogane-css')) {
      const s = document.createElement('style');
      s.id = 'kogane-css';
      s.textContent = `
        @keyframes kogane-scan { 0%{background-position:0 0} 100%{background-position:0 8px} }
        @keyframes kogane-flicker { 0%,92%,100%{opacity:1} 93%{opacity:0.85} 94%{opacity:0.97} 95%{opacity:0.80} 96%{opacity:1} }
        @keyframes kogane-pulse { 0%,100%{filter:brightness(1) saturate(1)} 50%{filter:brightness(1.07) saturate(1.1)} }
      `;
      document.head.appendChild(s);
    }
    return () => { document.getElementById('kogane-css')?.remove(); };
  }, []);

  // Track image load state — fly-in starts as soon as both images are loaded
  const [imagesReady, setImagesReady] = useState(false);
  const loadedCount = useRef(0);
  const handleImageLoad = useCallback(() => {
    loadedCount.current += 1;
    if (loadedCount.current >= 2) {
      setBlurPx(10); // ramp blur 0→10px over 1000ms (matches fly-in duration)
      // rAF to ensure browser has painted the initial offscreen position before transitioning
      requestAnimationFrame(() => setImagesReady(true));
    }
  }, []);

  useEffect(() => {
    if (!imagesReady) return;
    const timers = [];
    // Phase 0 — immediately fly in from offscreen → ZOOM_START over 1000ms
    setZoomTransition('transform 1000ms cubic-bezier(0.22,1,0.36,1)');
    requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(ZOOM_START_TRANSFORM)));
    // Phase 1 — after fly-in(1000ms): zoom to full size over 1000ms
    timers.push(setTimeout(() => {
      if (closingRef.current) return;
      setZoomTransition('transform 1000ms cubic-bezier(0.33,0,0.2,1)');
      requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(ZOOM_FULL_TRANSFORM)));
    }, 1000));
    // Phase 2 — after fly(1000) + zoom(1000) + 200ms hold = 2200ms: expand screen
    timers.push(setTimeout(() => {
      if (closingRef.current) return;
      const inner = contentInnerRef.current;
      const h = inner ? Math.max(inner.scrollHeight + 8, 300) : 1200;
      setScreenH(h);
      setExpanded(true);
    }, 2200));
    openTimersRef.current = timers;
    return () => timers.forEach(clearTimeout);
  }, [imagesReady]);

  const heightTransition = closing
    ? 'height 1500ms cubic-bezier(0.7,0,1,0.9)'
    : expanded
      ? 'height 2000ms cubic-bezier(0.33,0,0.2,1)'
      : 'none';

  const ruleStyle = {
    display: 'flex',
    gap: '14px',
    marginBottom: '30px',
    fontWeight: 800,
    fontSize: '27px',
    lineHeight: 1.8,
    color: '#071000',
    textShadow: '0 1px 2px rgba(0,0,0,0.28), 0 0 5px rgba(0,60,0,0.15)',
  };

  const subStyle = {
    display: 'flex',
    gap: '14px',
    marginBottom: '18px',
    marginLeft: '56px',
    fontWeight: 800,
    fontSize: '27px',
    lineHeight: 1.8,
    color: '#071000',
    textShadow: '0 1px 2px rgba(0,0,0,0.28)',
  };

  const rules = [
    ['I.',    "Once a player has awakened their Clout Alias, they must declare their participation in the Clout Culling Games at a zip-colony of their choice within 28 days - these Players are the two types of either Orbiter or Participant."],
    ['II.',   "Any Players who break the previous rule will be subject to clout technique removal and coincidingly will be giga-mogged by other players."],
    ['III.',  "Orbiters who enter a colony without one chosen become Participants at the moment of entry and will be considered to have declared participation in the Clout Culling Games (Normies already inside a barrier at the start of the games will be given at least one chance to exit safely)."],
    ['IV.',   "Players score points by engaging in more motion than other Players."],
    ['V.',    "Players who refuse to participate by either not joining or becoming inactive will be Simulated at a fraction of their potential and coincidingly will be giga-mogged by other Players."],
    ['VI.',   "The point value categories of a Player's motion is decided by Games Master LaPuff. As a general rule, in real life motion is weighted more than digital motion (though both are still counted)."],
    ['VII.',  "Players can expend a set amount of points as determined by Games Master LaPuff to engage one of the three following options:"],
    ['VIII.', "In accordance with rule VII, Games Master LaPuff must accept any proposed new addition as long as it doesn't have a destructive effect on the Game."],
    ['IX.',   "If a Player's score remains the same for 28 days they will be subject to clout removal and they will enter 'Fallen Off' status."],
  ];

  const subRules = [
    ['A.', "Players may add a rule to the Clout Culling Games provided that the rule described does not end the Games. Rules added may not be subtracted."],
    ['B.', "Players may add a site function to the site which hosts the Clout Culling Games - if this function adds a way for Players to gain or lose points it will be accordingly balanced by Games Master LaPuff."],
    ['C.', "Players may claim a zip region as theirs to form as an Official Clout Colony gaining a name of their choosing, color of their choosing, and other perks as to be determined by the development of the Game."],
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[100000]"
      style={{ overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', fontFamily: 'Nunito, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial', cursor: 'pointer' }}
      onClick={triggerClose}
    >
      <div className="fixed inset-0 bg-black/60" style={{ backdropFilter: `blur(${blurPx}px)`, WebkitBackdropFilter: `blur(${blurPx}px)`, transition: 'backdrop-filter 500ms ease, -webkit-backdrop-filter 500ms ease', pointerEvents: 'none' }} />

      <div className="relative z-10 flex flex-col items-center" style={{ paddingTop: '0px', paddingBottom: '120px', cursor: 'default', transform: 'translateY(-60px)' }}>
        <div style={{ width: 'min(3600px, 144vw)', position: 'relative', overflow: 'visible' }}>

          <button
            onClick={(e) => { e.stopPropagation(); triggerClose(); }}
            className="absolute top-4 right-4 z-[100010] w-10 h-10 bg-black/70 text-white rounded-full font-black flex items-center justify-center border-2 border-white hover:bg-red-500 transition-colors"
            aria-label="Close"
          >✕</button>

          {/* ZOOM WRAPPER — starts at random offscreen position, flies to ZOOM_START on open,
              zooms to ZOOM_FULL, then reverses on close (zoom-out then fly off-screen).
              transformOrigin '50% 0%' keeps zoom anchored to top-center of composition. */}
          <div style={{ transform: zoomTransform, transformOrigin: '50% 0%', transition: zoomTransition, overflow: 'visible' }}>

          {/* KOGANE TOP — scale(0.96) from bottom-center, clips horizontally and vertically off-screen as intended */}
          <img src={topSrc} alt="scroll top" onClick={triggerClose} onLoad={handleImageLoad}
            fetchpriority="high" loading="eager"
            style={{ display: 'block', width: '100%', position: 'relative', zIndex: 4, transform: 'translateX(-5px) scale(0.96)', transformOrigin: 'bottom center', marginTop: 'calc(-8.5vw + 9px)', cursor: 'pointer' }}
          />

          {/* GREEN SCREEN */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: `-${SEAM}px`, position: 'relative', zIndex: 2 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'calc(100% / 3)', minWidth: '390px',
                height: expanded || closing ? `${screenH}px` : '0px',
                overflow: 'hidden',
                transition: heightTransition,
                position: 'relative',
                background: GLASS_BG,
                boxShadow: GLASS_SHADOW,
                border: '1.5px solid rgba(80,255,110,0.35)',
                borderRadius: '4px',
                cursor: 'default',
                animation: expanded && !closing ? 'kogane-flicker 9s ease-in-out infinite, kogane-pulse 5s ease-in-out infinite' : 'none',
              }}
            >
              {/* Scanlines */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10, backgroundImage: 'repeating-linear-gradient(0deg,rgba(0,0,0,0.032) 0px,rgba(0,0,0,0.032) 1px,transparent 1px,transparent 8px)', backgroundSize: '100% 8px', animation: 'kogane-scan 0.35s linear infinite' }} />
              {/* Subtle horizontal glow lines */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9, backgroundImage: 'repeating-linear-gradient(0deg,transparent 0px,transparent 28px,rgba(100,255,0,0.04) 28px,rgba(100,255,0,0.04) 30px)' }} />

              {/* Hexagonal etching pattern — fine outlined hex grid, futuristic texture below all effects */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 8, overflow: 'hidden' }}>
                <defs>
                  <pattern id="kogane-hex-pat" x="0" y="0" width="34.64" height="60" patternUnits="userSpaceOnUse">
                    {/* Two offset rows of hex outlines tile the entire surface */}
                    <polygon points="17.32,0 34.64,10 34.64,30 17.32,40 0,30 0,10"            fill="none" stroke="rgba(100,255,0,0.09)" strokeWidth="0.7"/>
                    <polygon points="0,30 17.32,40 17.32,60 0,70 -17.32,60 -17.32,40"          fill="none" stroke="rgba(100,255,0,0.09)" strokeWidth="0.7"/>
                    <polygon points="34.64,30 51.96,40 51.96,60 34.64,70 17.32,60 17.32,40"    fill="none" stroke="rgba(100,255,0,0.09)" strokeWidth="0.7"/>
                  </pattern>
                </defs>
                <rect x="0" y="0" width="100%" height="100%" fill="url(#kogane-hex-pat)"/>
              </svg>

              {/* 3D DEPTH GEOMETRY — drawn as SVG overlay, no layout change */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 14, overflow: 'visible' }} preserveAspectRatio="none">
                {/* Top-left corner bracket — perspective foreshortened */}
                <polyline points="18,18 18,52 28,42" fill="none" stroke="rgba(180,255,100,0.35)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                <polyline points="18,18 52,18 42,28" fill="none" stroke="rgba(180,255,100,0.35)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                {/* Top-right corner bracket */}
                <polyline points="calc(100% - 18px),18 calc(100% - 18px),52 calc(100% - 28px),42" fill="none" stroke="rgba(180,255,100,0.28)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                <polyline points="calc(100% - 18px),18 calc(100% - 52px),18 calc(100% - 42px),28" fill="none" stroke="rgba(180,255,100,0.28)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                {/* Bottom-left corner bracket */}
                <polyline points="18,calc(100% - 18px) 18,calc(100% - 52px) 28,calc(100% - 42px)" fill="none" stroke="rgba(80,200,40,0.22)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                <polyline points="18,calc(100% - 18px) 52,calc(100% - 18px) 42,calc(100% - 28px)" fill="none" stroke="rgba(80,200,40,0.22)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                {/* Bottom-right corner bracket */}
                <polyline points="calc(100% - 18px),calc(100% - 18px) calc(100% - 18px),calc(100% - 52px) calc(100% - 28px),calc(100% - 42px)" fill="none" stroke="rgba(80,200,40,0.18)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                <polyline points="calc(100% - 18px),calc(100% - 18px) calc(100% - 52px),calc(100% - 18px) calc(100% - 42px),calc(100% - 28px)" fill="none" stroke="rgba(80,200,40,0.18)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                {/* Left edge depth line — slight taper simulating perspective */}
                <line x1="8" y1="0%" x2="8" y2="100%" stroke="rgba(160,255,80,0.14)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                {/* Right edge depth line */}
                <line x1="calc(100% - 8px)" y1="0%" x2="calc(100% - 8px)" y2="100%" stroke="rgba(0,40,0,0.22)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                {/* Top edge inner highlight */}
                <line x1="0%" y1="7" x2="100%" y2="7" stroke="rgba(180,255,120,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                {/* Bottom edge inner shadow */}
                <line x1="0%" y1="calc(100% - 7px)" x2="100%" y2="calc(100% - 7px)" stroke="rgba(0,30,0,0.20)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
              </svg>

              {/* Top bevel gradient */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '60px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(180deg, rgba(180,255,100,0.14) 0%, transparent 100%)' }} />
              {/* Bottom depth gradient */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(0deg, rgba(0,40,5,0.22) 0%, transparent 100%)' }} />
              {/* Left bright edge band */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '14px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(90deg, rgba(160,255,80,0.13) 0%, transparent 100%)' }} />
              {/* Right dark edge band */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '14px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(270deg, rgba(0,30,0,0.18) 0%, transparent 100%)' }} />
              {/* CRT vignette */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11, background: 'radial-gradient(ellipse at 50% 50%, transparent 42%, rgba(0,0,0,0.22) 100%)' }} />

              <div
                ref={contentInnerRef}
                style={{
                  paddingTop: `${SEAM + 20}px`, paddingBottom: `${SEAM}px`,
                  paddingLeft: '42px', paddingRight: '42px',
                  position: 'relative', zIndex: 12,
                  opacity: expanded && !closing ? 1 : 0,
                  transition: closing ? 'opacity 200ms ease' : 'opacity 700ms ease 600ms',
                }}
              >
                <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '33px', marginBottom: '30px', color: '#8B0000', textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 1px 0 #000', letterSpacing: '0.04em' }}>
                  CLOUT CULLING GAME RULES
                </h2>

                <div style={{ fontSize: '27px', lineHeight: 1.8, color: '#071000' }}>
                  {rules.slice(0, 7).map(([num, text]) => (
                    <div key={num} style={ruleStyle}>
                      <span style={NUM}>{num}</span>
                      <span>{styleText(text)}</span>
                    </div>
                  ))}

                  {/* Sub-rules A/B/C under VII */}
                  {subRules.map(([lbl, text]) => (
                    <div key={lbl} style={subStyle}>
                      <span style={{ ...NUM, minWidth: '36px' }}>{lbl}</span>
                      <span>{styleText(text)}</span>
                    </div>
                  ))}

                  {rules.slice(7).map(([num, text]) => (
                    <div key={num} style={{ ...ruleStyle, marginBottom: num === 'IX.' ? '45px' : '30px' }}>
                      <span style={NUM}>{num}</span>
                      <span>{styleText(text)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ textAlign: 'center', paddingBottom: '12px' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowLocked(v => !v); }}
                    style={{ background: 'rgba(0,0,0,0.15)', border: '2px solid rgba(0,0,0,0.25)', borderRadius: '16px', padding: '15px 30px', fontWeight: 900, fontSize: '22px', color: 'rgba(0,20,0,0.38)', cursor: 'not-allowed', fontFamily: 'inherit', filter: 'grayscale(0.4)' }}
                  >
                    🔒 Add A Rule For Clout Points
                  </button>
                  {showLocked && (
                    <p style={{ marginTop: '12px', fontWeight: 800, fontSize: '21px', color: 'rgba(0,20,0,0.5)', textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>Not unlocked yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* KOGANE BOTTOM — initial pos = BOTTOM_END_MT + INIT_EXTRA_DOWN, expands to BOTTOM_END_MT, retracts to exact initial on close */}
          <img src={bottomSrc} alt="scroll bottom" onClick={triggerClose} onLoad={handleImageLoad}
            fetchpriority="high" loading="eager"
            style={{
              display: 'block',
              width: 'auto',
              margin: '0 auto',
              // expanded && !closing = fully open position; everything else (initial + retracted) = same initial value
              marginTop: `${BOTTOM_END_MT + (expanded && !closing ? 0 : BOTTOM_INIT_EXTRA_DOWN)}px`,
              position: 'relative',
              zIndex: 3,
              cursor: 'pointer',
              transform: `translateX(${BOTTOM_X}px) scale(1.08)`,
              transformOrigin: 'top center',
              opacity: 1,
              transition: [
                'opacity 500ms ease',
                expanded
                  ? `margin-top ${closing ? '1500ms cubic-bezier(0.7,0,1,0.9)' : '2000ms cubic-bezier(0.33,0,0.2,1)'}`
                  : '',
              ].filter(Boolean).join(', '),
            }}
          />

          </div>{/* END ZOOM WRAPPER */}
        </div>
      </div>
    </div>,
    document.body
  );
}
