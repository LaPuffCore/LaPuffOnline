import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const SEAM = 140;
// Final expanded y position (more negative = higher on screen, overlaps screen more)
const BOTTOM_END_MT = -180;
// How much further DOWN kogane bottom sits before expansion (positive = lower)
const BOTTOM_INIT_EXTRA_DOWN = 200;
// X offset right for koganebottom (both positions)
const BOTTOM_X = 153;

// ── Mobile variants (< 640px) ───────────────────────────────────────────────
// ── All mobile tuning happens here. Desktop constants above are untouched. ──

// Green screen seam overlap with koganetop
const SEAM_M                   = 90;

// koganetop image scale at full/initial zoom (0.96 on desktop)
const TOP_SCALE_M               = 3.00;
// koganetop horizontal offset in px (positive = right). Applied at all zoom levels.
const TOP_X_M                   = -2;
// koganetop marginTop in the layout (controls vertical gap/overlap with content above)
const TOP_MARGIN_TOP_M          = 'calc(-8.5vw + 9px)';

// koganebottom image scale at full/initial zoom (1.08 on desktop)
const BOTTOM_SCALE_M            = 1.40;
// koganebottom horizontal offset in px (positive = right). Applied at all zoom levels.
const BOTTOM_X_M                = 62;
// koganebottom marginTop when fully EXPANDED (more negative = rides higher / overlaps screen more)
const BOTTOM_END_MT_M           = -65;
// Extra downward gap for koganebottom when CLOSED/INITIAL (positive = further down from seam)
const BOTTOM_INIT_EXTRA_DOWN_M  = 90;

// ── Zoom position tuning ────────────────────────────────────────────────────
// Y position of the entire popup composition when at FULL/EXTENDED zoom (px, positive = lower on screen)
const POPUP_Y_OFFSET_M          = 200;
// translateY of the whole zoom wrapper at the SMALL (1/3 scale) resting position
const ZOOM_Y_START_M_PX         = 160;   // px component
const ZOOM_Y_START_M_VW         = 2.833; // vw component (compensates for koganetop marginTop at small scale)
// translateX of the whole zoom wrapper at the SMALL (1/3 scale) resting position (positive = right)
const ZOOM_X_START_M            = 0;     // px — centre by default
// Scale of the small resting position (1/3 = 0.333 of full size)
const ZOOM_SCALE_SMALL_M        = 0.333;

// ── Extra tuning knobs ───────────────────────────────────────────────────────
// Animation speed multiplier (1.0 = same as desktop, 2.0 = twice as slow, 0.5 = twice as fast)
const ANIM_SPEED_M              = 1.0;
// Max zoom scale the popup reaches at its full/initial position (1.0 = 100% of natural size = current default)
const ZOOM_FULL_SCALE_M         = 1.0;
// Green screen panel width as a fraction of the viewport (1.0 = 100vw = current full-width default)
const GREEN_SCREEN_WIDTH_M      = 1.0;

// ── Derived strings — do not edit below this line, tune the constants above ──
const ZOOM_Y_START_M         = `calc(${ZOOM_Y_START_M_PX}px + ${ZOOM_Y_START_M_VW}vw)`;
const ZOOM_START_TRANSFORM_M = `translateX(${ZOOM_X_START_M}px) translateY(${ZOOM_Y_START_M}) scale(${ZOOM_SCALE_SMALL_M})`;
// Full/initial zoom position for mobile — scale driven by ZOOM_FULL_SCALE_M
const ZOOM_FULL_TRANSFORM_M  = `translateX(0px) translateY(0px) scale(${ZOOM_FULL_SCALE_M})`;

// ── Desktop zoom constants (do not edit here, see desktop seam/bottom at top of file) ──
const ZOOM_Y_START         = 'calc(157px + 2.833vw)';
const ZOOM_START_TRANSFORM = `translateX(0px) translateY(${ZOOM_Y_START}) scale(0.333)`;
const ZOOM_FULL_TRANSFORM  = 'translateX(0px) translateY(0px) scale(1.0)';

// Pick a random offscreen direction — mobile-aware
function randomOffscreen(mobile) {
  const y  = mobile ? ZOOM_Y_START_M   : ZOOM_Y_START;
  const x  = mobile ? `${ZOOM_X_START_M}px` : '0px';
  const s  = mobile ? ZOOM_SCALE_SMALL_M    : 0.333;
  const opts = [
    `translateX(-150vw) translateY(${y}) scale(${s})`,
    `translateX(150vw) translateY(${y}) scale(${s})`,
    `translateX(-110vw) translateY(-110vh) scale(${s})`,
    `translateX(110vw) translateY(-110vh) scale(${s})`,
    `translateX(${x}) translateY(-130vh) scale(${s})`,
    `translateX(-110vw) translateY(110vh) scale(${s})`,
    `translateX(110vw) translateY(110vh) scale(${s})`,
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}

// Mobile glass: simpler box-shadow — just border-line + subtle outer glow (no 3D bevel insets)
const GLASS_SHADOW_M = [
  '0 0 0 1.5px rgba(120,255,40,0.45)',
  '0 4px 20px rgba(80,255,0,0.12)',
].join(', ');

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
  // Detect mobile once at mount — drives all mobile-specific sizing
  const isMobile = useRef(typeof window !== 'undefined' && window.innerWidth < 640).current;

  // Pick correct constants based on device
  const seam         = isMobile ? SEAM_M : SEAM;
  const bottomEndMt  = isMobile ? BOTTOM_END_MT_M : BOTTOM_END_MT;
  const bottomInitDn = isMobile ? BOTTOM_INIT_EXTRA_DOWN_M : BOTTOM_INIT_EXTRA_DOWN;
  const bottomX      = isMobile ? BOTTOM_X_M : BOTTOM_X;
  const zoomStartXf  = isMobile ? ZOOM_START_TRANSFORM_M : ZOOM_START_TRANSFORM;
  const zoomFullXf   = isMobile ? ZOOM_FULL_TRANSFORM_M  : ZOOM_FULL_TRANSFORM;
  // Mobile timing helper — multiply all ms values by ANIM_SPEED_M
  const t = isMobile ? (ms) => Math.round(ms * ANIM_SPEED_M) : (ms) => ms;

  const [headerH, setHeaderH] = useState(72);
  const [screenH, setScreenH] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showLocked, setShowLocked] = useState(false);
  const contentInnerRef = useRef(null);
  const closingRef = useRef(false);
  const openTimersRef = useRef([]);

  // Mobile: GPU-composited clip-path replaces the laggy height transition.
  // 'inset(0 0 100% 0)' = fully clipped (invisible), 'inset(0 0 0% 0)' = fully visible.
  const [mobileClip, setMobileClip] = useState('inset(0 0 100% 0)');

  // Zoom transform — initialised to a random offscreen position, flies in to ZOOM_START on open
  const [zoomTransform, setZoomTransform] = useState(() => randomOffscreen(isMobile));
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
    openTimersRef.current.forEach(clearTimeout);
    openTimersRef.current = [];
    setClosing(true);
    if (isMobile) {
      requestAnimationFrame(() => requestAnimationFrame(() => setMobileClip('inset(0 0 100% 0)')));
    } else {
      setScreenH(0);
    }
    // At t(1700)ms: zoom-out to ZOOM_START over t(1000)ms
    setTimeout(() => {
      setZoomTransition(`transform ${t(1000)}ms cubic-bezier(0.7,0,1,0.9)`);
      requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(zoomStartXf)));
    }, t(1700));
    // At t(2700)ms: fly off-screen in random direction over t(1000)ms
    setTimeout(() => {
      const target = randomOffscreen(isMobile);
      setZoomTransition(`transform ${t(1000)}ms cubic-bezier(0.7,0,1,0.9)`);
      requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(target)));
    }, t(2700));
    // At t(3700)ms: fully closed
    setTimeout(() => onClose?.(), t(3700));
  }, [onClose, isMobile, zoomStartXf, t]);

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
    // Phase 0 — fly in from offscreen → ZOOM_START over t(1000)ms
    setZoomTransition(`transform ${t(1000)}ms cubic-bezier(0.22,1,0.36,1)`);
    requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(zoomStartXf)));
    // Phase 1 — after fly-in: zoom to full size over t(1000)ms
    timers.push(setTimeout(() => {
      if (closingRef.current) return;
      setZoomTransition(`transform ${t(1000)}ms cubic-bezier(0.33,0,0.2,1)`);
      requestAnimationFrame(() => requestAnimationFrame(() => setZoomTransform(zoomFullXf)));
    }, t(1000)));
    // Phase 2 — after fly(t(1000)) + zoom(t(1000)) + t(200)ms hold = t(2200)ms: expand screen
    timers.push(setTimeout(() => {
      if (closingRef.current) return;
      const inner = contentInnerRef.current;
      const h = inner ? Math.max(inner.scrollHeight + 8, 300) : 1200;
      setScreenH(h);
      setExpanded(true);
      if (isMobile) {
        requestAnimationFrame(() => requestAnimationFrame(() => setMobileClip('inset(0 0 0% 0)')));
      }
    }, t(2200)));
    openTimersRef.current = timers;
    return () => timers.forEach(clearTimeout);
  }, [imagesReady]);

  const heightTransition = closing
    ? 'height 1500ms cubic-bezier(0.7,0,1,0.9)'
    : expanded
      ? 'height 2000ms cubic-bezier(0.33,0,0.2,1)'
      : 'none';
  const clipTransition = closing
    ? `clip-path ${t(1500)}ms cubic-bezier(0.7,0,1,0.9), -webkit-clip-path ${t(1500)}ms cubic-bezier(0.7,0,1,0.9)`
    : `clip-path ${t(2000)}ms cubic-bezier(0.33,0,0.2,1), -webkit-clip-path ${t(2000)}ms cubic-bezier(0.33,0,0.2,1)`;

  const ruleStyle = {
    display: 'flex',
    gap: isMobile ? '8px' : '14px',
    marginBottom: isMobile ? '16px' : '30px',
    fontWeight: 800,
    fontSize: isMobile ? '15px' : '27px',
    lineHeight: isMobile ? 1.5 : 1.8,
    color: '#071000',
    textShadow: '0 1px 2px rgba(0,0,0,0.28), 0 0 5px rgba(0,60,0,0.15)',
  };

  const subStyle = {
    display: 'flex',
    gap: isMobile ? '8px' : '14px',
    marginBottom: isMobile ? '12px' : '18px',
    marginLeft: isMobile ? '20px' : '56px',
    fontWeight: 800,
    fontSize: isMobile ? '15px' : '27px',
    lineHeight: isMobile ? 1.5 : 1.8,
    color: '#071000',
    textShadow: '0 1px 2px rgba(0,0,0,0.28)',
  };

  const numStyle = {
    ...NUM,
    minWidth: isMobile ? '28px' : '42px',
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

      <div className="relative z-10 flex flex-col items-center" style={{ paddingTop: '0px', paddingBottom: '120px', cursor: 'default', transform: isMobile ? `translateY(${POPUP_Y_OFFSET_M}px)` : 'translateY(-60px)' }}>
        <div style={{ width: isMobile ? '100vw' : 'min(3600px, 144vw)', position: 'relative', overflow: 'visible' }}>

          <button
            onClick={(e) => { e.stopPropagation(); triggerClose(); }}
            className="absolute top-4 right-4 z-[100010] w-10 h-10 bg-black/70 text-white rounded-full font-black flex items-center justify-center border-2 border-white hover:bg-red-500 transition-colors"
            aria-label="Close"
          >✕</button>

          {/* ZOOM WRAPPER — starts at random offscreen position, flies to ZOOM_START on open,
              zooms to ZOOM_FULL, then reverses on close (zoom-out then fly off-screen).
              transformOrigin '50% 0%' keeps zoom anchored to top-center of composition. */}
          <div style={{ transform: zoomTransform, transformOrigin: '50% 0%', transition: zoomTransition, overflow: 'visible' }}>

          {/* KOGANE TOP — TOP_X_M/TOP_SCALE_M on mobile, fixed values on desktop */}
          <img src={topSrc} alt="scroll top" onClick={triggerClose} onLoad={handleImageLoad}
            fetchpriority="high" loading="eager"
            style={{
              display: 'block', width: '100%', position: 'relative', zIndex: 4,
              transform: `translateX(${isMobile ? TOP_X_M : -5}px) scale(${isMobile ? TOP_SCALE_M : 0.96})`,
              transformOrigin: 'bottom center',
              marginTop: isMobile ? TOP_MARGIN_TOP_M : 'calc(-8.5vw + 9px)',
              cursor: 'pointer',
            }}
          />

          {/* GREEN SCREEN */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: `-${seam}px`, position: 'relative', zIndex: 2 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: isMobile ? `${GREEN_SCREEN_WIDTH_M * 100}%` : 'calc(100% / 3)',
                ...(isMobile ? {} : { minWidth: '390px' }),
                // Mobile: height is set immediately (no transition) — clip-path handles reveal/retract
                // Desktop: height transition (layout-based, works fine on desktop GPU)
                height: isMobile
                  ? `${screenH}px`
                  : (expanded || closing ? `${screenH}px` : '0px'),
                overflow: 'hidden',
                transition: isMobile ? clipTransition : heightTransition,
                ...(isMobile ? {
                  clipPath: mobileClip,
                  WebkitClipPath: mobileClip,
                  willChange: 'clip-path',
                } : {}),
                position: 'relative',
                background: GLASS_BG,
                boxShadow: isMobile ? GLASS_SHADOW_M : GLASS_SHADOW,
                border: '1.5px solid rgba(80,255,110,0.35)',
                borderRadius: '4px',
                cursor: 'default',
                // kogane-pulse uses filter: brightness/saturate — NOT GPU composited on mobile, skip it
                animation: expanded && !closing
                  ? `kogane-flicker 9s ease-in-out infinite${isMobile ? '' : ', kogane-pulse 5s ease-in-out infinite'}`
                  : 'none',
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
                    <polygon points="17.32,0 34.64,10 34.64,30 17.32,40 0,30 0,10"            fill="none" stroke="rgba(100,255,0,0.09)" strokeWidth="0.7"/>
                    <polygon points="0,30 17.32,40 17.32,60 0,70 -17.32,60 -17.32,40"          fill="none" stroke="rgba(100,255,0,0.09)" strokeWidth="0.7"/>
                    <polygon points="34.64,30 51.96,40 51.96,60 34.64,70 17.32,60 17.32,40"    fill="none" stroke="rgba(100,255,0,0.09)" strokeWidth="0.7"/>
                  </pattern>
                </defs>
                <rect x="0" y="0" width="100%" height="100%" fill="url(#kogane-hex-pat)"/>
              </svg>

              {/* Desktop-only: 3D depth geometry — corner brackets + edge lines */}
              {!isMobile && (
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 14, overflow: 'visible' }} preserveAspectRatio="none">
                  <polyline points="18,18 18,52 28,42" fill="none" stroke="rgba(180,255,100,0.35)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <polyline points="18,18 52,18 42,28" fill="none" stroke="rgba(180,255,100,0.35)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <polyline points="calc(100% - 18px),18 calc(100% - 18px),52 calc(100% - 28px),42" fill="none" stroke="rgba(180,255,100,0.28)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <polyline points="calc(100% - 18px),18 calc(100% - 52px),18 calc(100% - 42px),28" fill="none" stroke="rgba(180,255,100,0.28)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <polyline points="18,calc(100% - 18px) 18,calc(100% - 52px) 28,calc(100% - 42px)" fill="none" stroke="rgba(80,200,40,0.22)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <polyline points="18,calc(100% - 18px) 52,calc(100% - 18px) 42,calc(100% - 28px)" fill="none" stroke="rgba(80,200,40,0.22)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <polyline points="calc(100% - 18px),calc(100% - 18px) calc(100% - 18px),calc(100% - 52px) calc(100% - 28px),calc(100% - 42px)" fill="none" stroke="rgba(80,200,40,0.18)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <polyline points="calc(100% - 18px),calc(100% - 18px) calc(100% - 52px),calc(100% - 18px) calc(100% - 42px),calc(100% - 28px)" fill="none" stroke="rgba(80,200,40,0.18)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
                  <line x1="8" y1="0%" x2="8" y2="100%" stroke="rgba(160,255,80,0.14)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                  <line x1="calc(100% - 8px)" y1="0%" x2="calc(100% - 8px)" y2="100%" stroke="rgba(0,40,0,0.22)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                  <line x1="0%" y1="7" x2="100%" y2="7" stroke="rgba(180,255,120,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                  <line x1="0%" y1="calc(100% - 7px)" x2="100%" y2="calc(100% - 7px)" stroke="rgba(0,30,0,0.20)" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                </svg>
              )}

              {/* Desktop-only: 3D bevel + vignette layers */}
              {!isMobile && <>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '60px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(180deg, rgba(180,255,100,0.14) 0%, transparent 100%)' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(0deg, rgba(0,40,5,0.22) 0%, transparent 100%)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '14px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(90deg, rgba(160,255,80,0.13) 0%, transparent 100%)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '14px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(270deg, rgba(0,30,0,0.18) 0%, transparent 100%)' }} />
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11, background: 'radial-gradient(ellipse at 50% 50%, transparent 42%, rgba(0,0,0,0.22) 100%)' }} />
              </>}

              <div
                ref={contentInnerRef}
                style={{
                  paddingTop: `${seam + 20}px`, paddingBottom: `${seam}px`,
                  paddingLeft: isMobile ? '14px' : '42px',
                  paddingRight: isMobile ? '14px' : '42px',
                  position: 'relative', zIndex: 12,
                  opacity: expanded && !closing ? 1 : 0,
                  transition: closing ? 'opacity 200ms ease' : 'opacity 700ms ease 600ms',
                }}
              >
                <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: isMobile ? '19px' : '33px', marginBottom: isMobile ? '16px' : '30px', color: '#8B0000', textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 1px 0 #000', letterSpacing: '0.04em' }}>
                  CLOUT CULLING GAME RULES
                </h2>

                <div style={{ fontSize: isMobile ? '15px' : '27px', lineHeight: isMobile ? 1.5 : 1.8, color: '#071000' }}>
                  {rules.slice(0, 7).map(([num, text]) => (
                    <div key={num} style={ruleStyle}>
                      <span style={numStyle}>{num}</span>
                      <span>{styleText(text)}</span>
                    </div>
                  ))}

                  {/* Sub-rules A/B/C under VII */}
                  {subRules.map(([lbl, text]) => (
                    <div key={lbl} style={subStyle}>
                      <span style={{ ...numStyle, minWidth: isMobile ? '24px' : '36px' }}>{lbl}</span>
                      <span>{styleText(text)}</span>
                    </div>
                  ))}

                  {rules.slice(7).map(([num, text]) => (
                    <div key={num} style={{ ...ruleStyle, marginBottom: num === 'IX.' ? (isMobile ? '24px' : '45px') : (isMobile ? '16px' : '30px') }}>
                      <span style={numStyle}>{num}</span>
                      <span>{styleText(text)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ textAlign: 'center', paddingBottom: '12px' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowLocked(v => !v); }}
                    style={{ background: 'rgba(0,0,0,0.15)', border: '2px solid rgba(0,0,0,0.25)', borderRadius: '16px', padding: isMobile ? '10px 18px' : '15px 30px', fontWeight: 900, fontSize: isMobile ? '15px' : '22px', color: 'rgba(0,20,0,0.38)', cursor: 'not-allowed', fontFamily: 'inherit', filter: 'grayscale(0.4)' }}
                  >
                    🔒 Add A Rule For Clout Points
                  </button>
                  {showLocked && (
                    <p style={{ marginTop: '12px', fontWeight: 800, fontSize: isMobile ? '14px' : '21px', color: 'rgba(0,20,0,0.5)', textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>Not unlocked yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* KOGANE BOTTOM — initial pos = bottomEndMt + bottomInitDn, expands to bottomEndMt, retracts to exact initial on close */}
          <img src={bottomSrc} alt="scroll bottom" onClick={triggerClose} onLoad={handleImageLoad}
            fetchpriority="high" loading="eager"
            style={{
              display: 'block',
              width: 'auto',
              margin: '0 auto',
              marginTop: `${bottomEndMt + (expanded && !closing ? 0 : bottomInitDn)}px`,
              position: 'relative',
              zIndex: 3,
              cursor: 'pointer',
              transform: `translateX(${bottomX}px) scale(${isMobile ? BOTTOM_SCALE_M : 1.08})`,
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
