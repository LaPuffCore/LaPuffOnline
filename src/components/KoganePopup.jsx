import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// px each scroll image overlaps into the green screen (decreased by 20 from orig 60)
const SEAM = 40;

export default function KoganePopup({ onClose }) {
  const [headerH, setHeaderH] = useState(72);
  const [screenH, setScreenH] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showLocked, setShowLocked] = useState(false);
  const contentInnerRef = useRef(null);

  const base = import.meta.env?.BASE_URL ?? '/';
  const topSrc = `${base}data/koganetop.png`;
  const bottomSrc = `${base}data/koganebottom.png`;

  const handleClose = useCallback(() => { onClose?.(); }, [onClose]);

  // Lock body scroll + measure header
  useEffect(() => {
    const hdr = document.querySelector('header');
    if (hdr) setHeaderH(Math.round(hdr.getBoundingClientRect().height));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc to close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  // CSS keyframes — injected once, removed on unmount
  useEffect(() => {
    if (!document.getElementById('kogane-css')) {
      const s = document.createElement('style');
      s.id = 'kogane-css';
      s.textContent = `
        @keyframes kogane-scan { 0%{background-position:0 0} 100%{background-position:0 8px} }
        @keyframes kogane-flicker { 0%,92%,100%{opacity:1} 93%{opacity:0.82} 94%{opacity:0.96} 95%{opacity:0.78} 96%{opacity:1} }
        @keyframes kogane-glow {
          0%,100%{box-shadow:inset 0 0 80px rgba(0,255,60,0.22),inset 0 0 200px rgba(0,180,30,0.1),0 0 80px rgba(0,255,60,0.45)}
          50%{box-shadow:inset 0 0 100px rgba(0,255,60,0.32),inset 0 0 240px rgba(0,200,40,0.16),0 0 120px rgba(0,255,60,0.6)}
        }
      `;
      document.head.appendChild(s);
    }
    return () => { document.getElementById('kogane-css')?.remove(); };
  }, []);

  // After 1.5 s measure content height then trigger scroll-unroll
  useEffect(() => {
    const t = setTimeout(() => {
      const inner = contentInnerRef.current;
      const h = inner ? Math.max(inner.scrollHeight + 8, 200) : 800;
      setScreenH(h);
      setExpanded(true);
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const ruleTextStyle = {
    marginBottom: '20px',
    fontWeight: 800,
    fontSize: '18px',
    lineHeight: 1.8,
    textShadow: '0 1px 2px rgba(0,0,0,0.28), 0 0 6px rgba(0,60,0,0.18)',
  };

  return createPortal(
    // Outer div: fullscreen scroll container — clicking here (outside content) closes
    <div
      className="fixed inset-0 z-[100000] overflow-y-auto overscroll-contain"
      style={{ fontFamily: 'Nunito, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial' }}
      onClick={handleClose}
    >
      {/* Blurred backdrop */}
      <div
        className="fixed inset-0 bg-black/60"
        style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      />

      {/* Content column — stopPropagation so clicks here don't close */}
      <div
        className="relative z-10 flex flex-col items-center"
        style={{ paddingTop: `${headerH}px`, paddingBottom: '80px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Scroll container: images scale to min(2400px,96vw) — ~+50% again from prev min(1600px,96vw) */}
        <div style={{ width: 'min(2400px, 96vw)', position: 'relative' }}>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 z-[100010] w-9 h-9 bg-black/70 text-white rounded-full font-black flex items-center justify-center border-2 border-white hover:bg-red-500 transition-colors text-sm"
            aria-label="Close"
          >✕</button>

          {/* ── KOGANE TOP — z-index 4 (in FRONT of bottom image) ── */}
          <img
            src={topSrc}
            alt="scroll top"
            style={{ display: 'block', width: '100%', position: 'relative', zIndex: 4 }}
          />

          {/* Green screen wrapper — 1/3 width, centered, overlaps top by SEAM */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: `-${SEAM}px`,
            position: 'relative',
            zIndex: 2,
          }}>
            <div style={{
              width: 'calc(100% / 3)',
              minWidth: '260px',
              height: expanded ? `${screenH}px` : '0px',
              overflow: 'hidden',
              transition: expanded ? 'height 1100ms cubic-bezier(0.33,0,0.2,1)' : 'none',
              position: 'relative',
              background: 'linear-gradient(180deg,#0aff42 0%,#00e836 45%,#00cc2e 100%)',
              animation: expanded ? 'kogane-flicker 9s ease-in-out infinite, kogane-glow 4s ease-in-out infinite' : 'none',
            }}>
              {/* Scanlines */}
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
                backgroundImage: 'repeating-linear-gradient(0deg,rgba(0,0,0,0.055) 0px,rgba(0,0,0,0.055) 1px,transparent 1px,transparent 8px)',
                backgroundSize: '100% 8px',
                animation: 'kogane-scan 0.35s linear infinite',
              }} />
              {/* Horizontal glow lines */}
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9,
                backgroundImage: 'repeating-linear-gradient(0deg,transparent 0px,transparent 22px,rgba(0,255,80,0.07) 22px,rgba(0,255,80,0.07) 24px)',
              }} />
              {/* CRT vignette */}
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11,
                background: 'radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,0.38) 100%)',
              }} />

              {/* Rules content — padded by SEAM so text clears scroll image overlaps */}
              <div
                ref={contentInnerRef}
                style={{
                  paddingTop: `${SEAM}px`,
                  paddingBottom: `${SEAM}px`,
                  paddingLeft: '28px',
                  paddingRight: '28px',
                  position: 'relative',
                  zIndex: 12,
                  opacity: expanded ? 1 : 0,
                  transition: 'opacity 700ms ease 600ms',
                }}
              >
                <h2 style={{
                  textAlign: 'center',
                  fontWeight: 900,
                  fontSize: '22px',
                  marginBottom: '20px',
                  color: '#8B0000',
                  textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 1px 0 #000',
                  letterSpacing: '0.04em',
                }}>
                  CLOUT CULLING GAME RULES
                </h2>

                <div style={{ fontSize: '18px', lineHeight: 1.8, color: '#071000' }}>
                  <p style={ruleTextStyle}><strong>I.</strong> Once a player has awakened their Clout Alias, they must declare their participation in the Clout Culling Games at a zip-colony of their choice within 28 days - these Players are the two types of either Orbiter or Participant.</p>

                  <p style={ruleTextStyle}><strong>II.</strong> Any Players who break the previous rule will be subject to clout technique removal and coincidingly will be giga-mogged by other players.</p>

                  <p style={ruleTextStyle}><strong>III.</strong> Orbiters who enter a colony without one chosen become Participants at the moment of entry and will be considered to have declared participation in the Clout Culling Games (Normies already inside a barrier at the start of the games will be given at least one chance to exit safely).</p>

                  <p style={ruleTextStyle}><strong>IV.</strong> Players score points by engaging in more motion than other Players.</p>

                  <p style={ruleTextStyle}><strong>V.</strong> Players who refuse to participate by either not joining or becoming inactive will be Simulated at a fraction of their potential and coincidingly will be giga-mogged by other Players.</p>

                  <p style={ruleTextStyle}><strong>VI.</strong> The point value categories of a Player's motion is decided by Game Master LaPuff. As a general rule, in real life motion is weighted more than digital motion (though both are still counted).</p>

                  <div style={{ marginBottom: '20px' }}>
                    <p style={{ ...ruleTextStyle, marginBottom: '12px' }}><strong>VII.</strong> Players can expend a set amount of points as determined by Game Master LaPuff to engage one of the three following options:</p>
                    <ol style={{ marginLeft: '28px', paddingLeft: '6px', fontWeight: 800, fontSize: '18px', listStyleType: 'upper-alpha', textShadow: '0 1px 2px rgba(0,0,0,0.28)' }}>
                      <li style={{ marginBottom: '10px' }}>Players may add a rule to the Clout Culling Games provided that the rule described does not end the Games. Rules added may not be subtracted.</li>
                      <li style={{ marginBottom: '10px' }}>Players may add a site function to the site which hosts the Clout Culling Games - if this function adds a way for Players to gain or lose points it will be accordingly balanced by Games Master LaPuff.</li>
                      <li style={{ marginBottom: '10px' }}>Players may claim a zip region as theirs to form as an Official Clout Colony gaining a name of their choosing, color of their choosing, and other perks as to be determined by the development of the Game.</li>
                    </ol>
                  </div>

                  <p style={ruleTextStyle}><strong>VIII.</strong> In accordance with rule VII, Game Master LaPuff must accept any proposed new addition as long as it doesn't have a destructive effect on the Game.</p>

                  <p style={{ ...ruleTextStyle, marginBottom: '32px' }}><strong>IX.</strong> If a Player's score remains the same for 28 days they will be subject to clout removal and they will enter 'Fallen Off' status.</p>
                </div>

                {/* Locked add-a-rule button */}
                <div style={{ textAlign: 'center', paddingBottom: '8px' }}>
                  <button
                    onClick={() => setShowLocked(v => !v)}
                    style={{
                      background: 'rgba(0,0,0,0.15)',
                      border: '2px solid rgba(0,0,0,0.25)',
                      borderRadius: '12px',
                      padding: '10px 20px',
                      fontWeight: 900,
                      fontSize: '15px',
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
                      marginTop: '8px',
                      fontWeight: 800,
                      fontSize: '14px',
                      color: 'rgba(0,20,0,0.5)',
                      textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    }}>Not unlocked yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── KOGANE BOTTOM — z-index 3 (BEHIND top, in front of screen) ── */}
          <img
            src={bottomSrc}
            alt="scroll bottom"
            style={{
              display: 'block',
              width: '100%',
              marginTop: `-${SEAM}px`,
              position: 'relative',
              zIndex: 3,
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
