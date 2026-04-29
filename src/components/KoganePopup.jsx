import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const SEAM = 100;
const BOTTOM_INIT_MT = -(SEAM - 20);
// Shift koganebottom: right 60px, up 30px from natural centered position
const BOTTOM_X = 60;
const BOTTOM_Y_EXTRA = 30;

const NUM = {
  color: '#8B0000',
  textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 1px 0 #000',
  fontWeight: 900,
  flexShrink: 0,
  minWidth: '42px',
};

// Bright saturated lime green — all layers have transparency so content shows through
const GLASS_BG = [
  'linear-gradient(160deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.02) 45%, rgba(255,255,255,0.07) 100%)',
  'radial-gradient(ellipse at 28% 18%, rgba(220,255,100,0.12) 0%, transparent 52%)',
  'radial-gradient(ellipse at 72% 82%, rgba(0,80,10,0.16) 0%, transparent 52%)',
  'linear-gradient(180deg, rgba(100,255,0,0.52) 0%, rgba(60,230,0,0.58) 100%)',
  'rgba(8, 40, 0, 0.55)',
].join(', ');

const GLASS_SHADOW = [
  'inset 0 3px 0 rgba(255,255,255,0.40)',
  'inset 0 -3px 0 rgba(0,60,10,0.45)',
  'inset 3px 0 0 rgba(255,255,255,0.25)',
  'inset -3px 0 0 rgba(0,40,10,0.35)',
  'inset 0 0 60px rgba(80,255,0,0.14)',
  '0 8px 40px rgba(80,255,0,0.22)',
  '0 0 0 1.5px rgba(120,255,40,0.35)',
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

  // Stable cache-bust per mount — forces browser to skip cache on every page load (dev mode)
  const cacheBust = useRef(Date.now());
  const base = import.meta.env?.BASE_URL ?? '/';
  const topSrc    = `${base}data/koganetop.png?_=${cacheBust.current}`;
  const bottomSrc = `${base}data/koganebottom.png?_=${cacheBust.current}`;

  const triggerClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setScreenH(0);
    setTimeout(() => onClose?.(), 520);
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

  useEffect(() => {
    const t = setTimeout(() => {
      const inner = contentInnerRef.current;
      const h = inner ? Math.max(inner.scrollHeight + 8, 300) : 1200;
      setScreenH(h);
      setExpanded(true);
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const heightTransition = closing
    ? 'height 500ms cubic-bezier(0.7,0,1,0.9)'
    : expanded
      ? 'height 1100ms cubic-bezier(0.33,0,0.2,1)'
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
      <div className="fixed inset-0 bg-black/60" style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', pointerEvents: 'none' }} />

      <div className="relative z-10 flex flex-col items-center" style={{ paddingTop: `${headerH}px`, paddingBottom: '120px', cursor: 'default' }}>
        <div style={{ width: 'min(3600px, 144vw)', position: 'relative' }}>

          <button
            onClick={(e) => { e.stopPropagation(); triggerClose(); }}
            className="absolute top-4 right-4 z-[100010] w-10 h-10 bg-black/70 text-white rounded-full font-black flex items-center justify-center border-2 border-white hover:bg-red-500 transition-colors"
            aria-label="Close"
          >✕</button>

          {/* KOGANE TOP */}
          <img src={topSrc} alt="scroll top" onClick={triggerClose}
            style={{ display: 'block', width: '100%', position: 'relative', zIndex: 4, transform: 'translateX(20px)', cursor: 'pointer' }}
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
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10, backgroundImage: 'repeating-linear-gradient(0deg,rgba(0,0,0,0.045) 0px,rgba(0,0,0,0.045) 1px,transparent 1px,transparent 8px)', backgroundSize: '100% 8px', animation: 'kogane-scan 0.35s linear infinite' }} />
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9, backgroundImage: 'repeating-linear-gradient(0deg,transparent 0px,transparent 28px,rgba(0,255,80,0.05) 28px,rgba(0,255,80,0.05) 30px)' }} />
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '70px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '70px', pointerEvents: 'none', zIndex: 11, background: 'linear-gradient(0deg, rgba(0,60,10,0.30) 0%, transparent 100%)' }} />
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11, background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0,0,0,0.28) 100%)' }} />

              <div
                ref={contentInnerRef}
                style={{
                  paddingTop: `${SEAM}px`, paddingBottom: `${SEAM}px`,
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

          {/* KOGANE BOTTOM — centered + BOTTOM_X right + BOTTOM_Y_EXTRA up, click to close */}
          <img src={bottomSrc} alt="scroll bottom" onClick={triggerClose}
            style={{
              display: 'block',
              width: 'auto',
              margin: '0 auto',
              marginTop: `${BOTTOM_INIT_MT - BOTTOM_Y_EXTRA}px`,
              position: 'relative',
              zIndex: 3,
              cursor: 'pointer',
              transform: `translateX(${BOTTOM_X}px)`,
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
