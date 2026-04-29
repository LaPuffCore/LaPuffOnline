import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// SEAM: how far images overlap the green screen (top and bottom). +10 extra each side.
const SEAM = 100;

const NUM = {
  color: '#8B0000',
  textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 1px 0 #000',
  fontWeight: 900,
  flexShrink: 0,
};

const GLASS_BG = [
  'linear-gradient(160deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 45%, rgba(255,255,255,0.11) 100%)',
  'radial-gradient(ellipse at 28% 18%, rgba(255,255,255,0.14) 0%, transparent 52%)',
  'radial-gradient(ellipse at 72% 82%, rgba(0,55,12,0.32) 0%, transparent 52%)',
  'linear-gradient(180deg, rgba(0,210,65,0.72) 0%, rgba(0,155,40,0.82) 100%)',
  '#0a2a10',
].join(', ');

const GLASS_SHADOW = [
  'inset 0 3px 0 rgba(255,255,255,0.55)',
  'inset 0 -3px 0 rgba(0,60,10,0.65)',
  'inset 3px 0 0 rgba(255,255,255,0.35)',
  'inset -3px 0 0 rgba(0,40,10,0.55)',
  'inset 0 0 60px rgba(0,120,30,0.20)',
  '0 8px 40px rgba(0,200,60,0.28)',
  '0 0 0 1.5px rgba(80,255,110,0.4)',
].join(', ');

export default function KoganePopup({ onClose }) {
  const [headerH, setHeaderH] = useState(72);
  const [screenH, setScreenH] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showLocked, setShowLocked] = useState(false);
  const contentInnerRef = useRef(null);
  const closingRef = useRef(false);

  const base = import.meta.env?.BASE_URL ?? '/';
  const topSrc = `${base}data/koganetop.png`;
  const bottomSrc = `${base}data/koganebottom.png`;

  // triggerClose: reverse scroll animation then call onClose
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
    const handler = (e) => { if (e.key === 'Escape') triggerClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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

  // Height transition: fast (500ms ease-in) when closing, slow (1100ms) when opening
  const heightTransition = closing
    ? 'height 500ms cubic-bezier(0.7,0,1,0.9)'
    : expanded
      ? 'height 1100ms cubic-bezier(0.33,0,0.2,1)'
      : 'none';

  const ruleTextStyle = {
    display: 'flex',
    gap: '14px',
    marginBottom: '30px',
    fontWeight: 800,
    fontSize: '27px',
    lineHeight: 1.8,
    color: '#071000',
    textShadow: '0 1px 2px rgba(0,0,0,0.28), 0 0 5px rgba(0,60,0,0.15)',
  };

  return createPortal(
    // Outer wrapper: clicking anywhere here (outside green screen) closes popup
    <div
      className="fixed inset-0 z-[100000]"
      style={{
        overflowY: 'auto',
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
        fontFamily: 'Nunito, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
        cursor: 'pointer',
      }}
      onClick={triggerClose}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60"
        style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', pointerEvents: 'none' }}
      />

      {/* Scroll content column — does NOT stopPropagation so outer click still works */}
      <div
        className="relative z-10 flex flex-col items-center"
        style={{ paddingTop: `${headerH}px`, paddingBottom: '120px', cursor: 'default' }}
      >
        {/* Scroll assembly: min(3600px, 144vw), overflow clipped by outer */}
        <div style={{ width: 'min(3600px, 144vw)', position: 'relative' }}>

          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); triggerClose(); }}
            className="absolute top-4 right-4 z-[100010] w-10 h-10 bg-black/70 text-white rounded-full font-black flex items-center justify-center border-2 border-white hover:bg-red-500 transition-colors"
            aria-label="Close"
          >✕</button>

          {/* ── KOGANE TOP — z:4 (front), shifted 20px right, closes on click ── */}
          <img
            src={topSrc}
            alt="scroll top"
            onClick={triggerClose}
            style={{
              display: 'block',
              width: '100%',
              position: 'relative',
              zIndex: 4,
              transform: 'translateX(20px)',
              cursor: 'pointer',
            }}
          />

          {/* ── GREEN GLASS SCREEN — 1/3 width centered, overlaps top/bottom by SEAM ── */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: `-${SEAM}px`, position: 'relative', zIndex: 2 }}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'calc(100% / 3)',
                minWidth: '390px',
                height: expanded || closing ? `${screenH}px` : '0px',
                overflow: 'hidden',
                transition: heightTransition,
                position: 'relative',
                background: GLASS_BG,
                boxShadow: GLASS_SHADOW,
                border: '1.5px solid rgba(80,255,110,0.4)',
                borderRadius: '4px',
                cursor: 'default',
                animation: expanded && !closing
                  ? 'kogane-flicker 9s ease-in-out infinite, kogane-pulse 5s ease-in-out infinite'
                  : 'none',
              }}
            >
              {/* Scanlines */}
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
                backgroundImage: 'repeating-linear-gradient(0deg,rgba(0,0,0,0.045) 0px,rgba(0,0,0,0.045) 1px,transparent 1px,transparent 8px)',
                backgroundSize: '100% 8px',
                animation: 'kogane-scan 0.35s linear infinite',
              }} />
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9,
                backgroundImage: 'repeating-linear-gradient(0deg,transparent 0px,transparent 28px,rgba(0,255,80,0.05) 28px,rgba(0,255,80,0.05) 30px)',
              }} />
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '70px',
                pointerEvents: 'none', zIndex: 11,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, transparent 100%)',
              }} />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: '70px',
                pointerEvents: 'none', zIndex: 11,
                background: 'linear-gradient(0deg, rgba(0,60,10,0.35) 0%, transparent 100%)',
              }} />
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11,
                background: 'radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0,0,0,0.30) 100%)',
              }} />

              {/* Rules content — padded by SEAM so text clears scroll image overlaps */}
              <div
                ref={contentInnerRef}
                style={{
                  paddingTop: `${SEAM}px`,
                  paddingBottom: `${SEAM}px`,
                  paddingLeft: '42px',
                  paddingRight: '42px',
                  position: 'relative',
                  zIndex: 12,
                  opacity: expanded && !closing ? 1 : 0,
                  transition: closing ? 'opacity 200ms ease' : 'opacity 700ms ease 600ms',
                }}
              >
                <h2 style={{
                  textAlign: 'center',
                  fontWeight: 900,
                  fontSize: '33px',
                  marginBottom: '30px',
                  color: '#8B0000',
                  textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 1px 0 #000',
                  letterSpacing: '0.04em',
                }}>
                  CLOUT CULLING GAME RULES
                </h2>

                <div style={{ fontSize: '27px', lineHeight: 1.8, color: '#071000' }}>

                  <div style={ruleTextStyle}>
                    <span style={NUM}>I.</span>
                    <span>Once a player has awakened their Clout Alias, they must declare their participation in the Clout Culling Games at a zip-colony of their choice within 28 days - these Players are the two types of either Orbiter or Participant.</span>
                  </div>

                  <div style={ruleTextStyle}>
                    <span style={NUM}>II.</span>
                    <span>Any Players who break the previous rule will be subject to clout technique removal and coincidingly will be giga-mogged by other players.</span>
                  </div>

                  <div style={ruleTextStyle}>
                    <span style={NUM}>III.</span>
                    <span>Orbiters who enter a colony without one chosen become Participants at the moment of entry and will be considered to have declared participation in the Clout Culling Games (Normies already inside a barrier at the start of the games will be given at least one chance to exit safely).</span>
                  </div>

                  <div style={ruleTextStyle}>
                    <span style={NUM}>IV.</span>
                    <span>Players score points by engaging in more motion than other Players.</span>
                  </div>

                  <div style={ruleTextStyle}>
                    <span style={NUM}>V.</span>
                    <span>Players who refuse to participate by either not joining or becoming inactive will be Simulated at a fraction of their potential and coincidingly will be giga-mogged by other Players.</span>
                  </div>

                  <div style={ruleTextStyle}>
                    <span style={NUM}>VI.</span>
                    <span>The point value categories of a Player's motion is decided by Game Master LaPuff. As a general rule, in real life motion is weighted more than digital motion (though both are still counted).</span>
                  </div>

                  <div style={{ marginBottom: '30px' }}>
                    <div style={{ ...ruleTextStyle, marginBottom: '18px' }}>
                      <span style={NUM}>VII.</span>
                      <span>Players can expend a set amount of points as determined by Game Master LaPuff to engage one of the three following options:</span>
                    </div>
                    {[
                      ['A.', 'Players may add a rule to the Clout Culling Games provided that the rule described does not end the Games. Rules added may not be subtracted.'],
                      ['B.', 'Players may add a site function to the site which hosts the Clout Culling Games - if this function adds a way for Players to gain or lose points it will be accordingly balanced by Games Master LaPuff.'],
                      ['C.', 'Players may claim a zip region as theirs to form as an Official Clout Colony gaining a name of their choosing, color of their choosing, and other perks as to be determined by the development of the Game.'],
                    ].map(([lbl, txt]) => (
                      <div key={lbl} style={{ display: 'flex', gap: '14px', marginBottom: '15px', fontWeight: 800, fontSize: '27px', lineHeight: 1.8, textShadow: '0 1px 2px rgba(0,0,0,0.28)' }}>
                        <span style={{ ...NUM, minWidth: '36px' }}>{lbl}</span>
                        <span style={{ color: '#071000' }}>{txt}</span>
                      </div>
                    ))}
                  </div>

                  <div style={ruleTextStyle}>
                    <span style={NUM}>VIII.</span>
                    <span>In accordance with rule VII, Game Master LaPuff must accept any proposed new addition as long as it doesn't have a destructive effect on the Game.</span>
                  </div>

                  <div style={{ ...ruleTextStyle, marginBottom: '45px' }}>
                    <span style={NUM}>IX.</span>
                    <span>If a Player's score remains the same for 28 days they will be subject to clout removal and they will enter 'Fallen Off' status.</span>
                  </div>
                </div>

                {/* Locked add-a-rule button */}
                <div style={{ textAlign: 'center', paddingBottom: '12px' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowLocked(v => !v); }}
                    style={{
                      background: 'rgba(0,0,0,0.15)',
                      border: '2px solid rgba(0,0,0,0.25)',
                      borderRadius: '16px',
                      padding: '15px 30px',
                      fontWeight: 900,
                      fontSize: '22px',
                      color: 'rgba(0,20,0,0.38)',
                      cursor: 'not-allowed',
                      fontFamily: 'inherit',
                      filter: 'grayscale(0.4)',
                    }}
                  >
                    🔒 Add A Rule For Clout Points
                  </button>
                  {showLocked && (
                    <p style={{
                      marginTop: '12px',
                      fontWeight: 800,
                      fontSize: '21px',
                      color: 'rgba(0,20,0,0.5)',
                      textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    }}>Not unlocked yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── KOGANE BOTTOM — z:3, 120% wide centered, closes on click ── */}
          <img
            src={bottomSrc}
            alt="scroll bottom"
            onClick={triggerClose}
            style={{
              display: 'block',
              width: '120%',
              marginLeft: '-10%',
              marginTop: `-${SEAM}px`,
              position: 'relative',
              zIndex: 3,
              cursor: 'pointer',
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
