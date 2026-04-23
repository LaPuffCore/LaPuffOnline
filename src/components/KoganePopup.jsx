import { useEffect, useState, useRef } from 'react';

export default function KoganePopup({ onClose }) {
  const [started, setStarted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [topOffset, setTopOffset] = useState(72);
  const contentRef = useRef(null);
  const containerRef = useRef(null);

  // compute BASE_URL-aware asset path (works with Vite base)
  const base = (import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
  const topSrc = `${base}data/koganetop.png`;
  const bottomSrc = `${base}data/koganebottom.png`;

  useEffect(() => {
    // measure header height if present so top image anchors below it
    const hdr = document.querySelector('header');
    const h = hdr ? hdr.getBoundingClientRect().height : 72;
    setTopOffset(Math.round(h));

    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    // Start sequence after 2s
    const t = setTimeout(() => setStarted(true), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!started) return;
    // Give a short delay then expand content to measured height
    const el = contentRef.current;
    if (!el) return;
    // Allow browser to paint the hidden content then measure
    requestAnimationFrame(() => {
      const contentH = el.scrollHeight;
      // set CSS variable for animation target
      if (containerRef.current) {
        containerRef.current.style.setProperty('--kogane-target-h', `${contentH + 60}px`); // 30px top+bottom overlap
        // fade in content visibility and expand height
        el.style.transition = 'height 900ms ease, opacity 700ms ease 200ms';
        el.style.height = '0px';
        el.style.opacity = '0';
        // force reflow
        void el.offsetHeight;
        el.style.height = `${contentH + 60}px`;
        el.style.opacity = '0.9';
        // after animation ends mark expanded
        const done = setTimeout(() => setExpanded(true), 1000);
        return () => clearTimeout(done);
      }
    });
  }, [started]);

  // click outside to close is handled by overlay div below

  return (
    <div className="absolute left-0 top-0 w-full pointer-events-none z-[200000]" style={{ top: 0 }}>
      {/* overlay clickable area to close (no blur) */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} style={{ pointerEvents: 'auto' }} />

      {/* container anchored below topbar */}
      <div ref={containerRef}
        className="mx-auto w-full max-w-3xl pointer-events-none"
        style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: `${topOffset}px`, zIndex: 200001 }}>

        {/* Top half image (anchored) */}
        <img src={topSrc} alt="kogane top"
          onError={(e)=>{ e.currentTarget.src = topSrc; }}
          className="block w-full pointer-events-none"
          style={{ display: 'block' }} />

        {/* expanding screen area between halves */}
        <div ref={contentRef}
          className="mx-auto w-full overflow-hidden pointer-events-auto"
          style={{
            height: '0px',
            background: 'rgba(0,255,100,0.09)',
            borderTop: '1px solid rgba(0,255,100,0.28)',
            borderBottom: '1px solid rgba(0,255,100,0.28)',
            boxShadow: 'inset 0 0 30px rgba(0,255,100,0.06), 0 6px 30px rgba(0,255,100,0.06)',
            padding: '30px',
            opacity: 0,
            transition: 'height 900ms ease, opacity 700ms ease',
            // glitchy pixel effect
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), repeating-linear-gradient(90deg, rgba(0,255,100,0.02) 0 2px, transparent 2px 4px)',
            backgroundBlendMode: 'overlay',
            backgroundSize: '100% 3px, 4px 100%'
          }}>

          <div style={{ color: '#000', maxWidth: '980px', margin: '0 auto', fontFamily: 'Nunito, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial' }}>
            <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '28px', marginBottom: '12px', color: '#8B0000' }}>CLOUT CULLING GAME RULES</h2>

            <div style={{ fontSize: '15px', lineHeight: 1.45 }}>
              <p style={{ marginBottom: '14px', fontWeight: 800 }}>I. Once a player has awakened their Clout Alias, they must declare their participation in the Clout Culling Games at a zip-colony of their choice within 28 days - these Players are the two types of either Orbiter or Participant.</p>

              <p style={{ marginBottom: '14px', fontWeight: 800 }}>II. Any Players who break the previous rule will be subject to clout technique removal and coincidingly will be giga-mogged by other players.</p>

              <p style={{ marginBottom: '14px', fontWeight: 800 }}>III. Orbiters who enter a colony without one chosen become Participants at the moment of entry and will be considered to have declared participation in the Clout Culling Games (Normies already inside a barrier at the start of the games will be given at least one chance to exit safely).</p>

              <p style={{ marginBottom: '14px', fontWeight: 800 }}>IV. Players score points by engaging in more motion than other Players.</p>

              <p style={{ marginBottom: '14px', fontWeight: 800 }}>V. Players who refuse to participate by either not joining or becoming inactive will be Simulated at a fraction of their potential and coincidingly will be giga-mogged by other Players.</p>

              <p style={{ marginBottom: '14px', fontWeight: 800 }}>VI. The point value categories of a Player's motion is decided by Game Master LaPuff. As a general rule, in real life motion is weighted more than digital motion (though both are still counted).</p>

              <div style={{ marginBottom: '8px' }}>
                <p style={{ fontWeight: 800, marginBottom: '6px' }}>VII. Players can expend a set amount of points as determined by Game Master LaPuff to engage one of the three following options:</p>
                <ol style={{ marginLeft: '18px', paddingLeft: '8px', fontWeight: 800, listStyleType: 'upper-alpha' }}>
                  <li style={{ marginBottom: '6px' }}>Players may add a rule to the Clout Culling Games provided that the rule described does not end the Games. Rules added may not be subtracted.</li>
                  <li style={{ marginBottom: '6px' }}>Players may add a site function to the site which hosts the Clout Culling Games - if this function adds a way for Players to gain or lose points it will be accordingly balanced by Games Master LaPuff.</li>
                  <li style={{ marginBottom: '6px' }}>Players may claim a zip region as theirs to form as an Official Clout Colony gaining a name of their choosing, color of their choosing, and other perks as to be determined by the development of the Game.</li>
                </ol>
              </div>

              <p style={{ marginBottom: '14px', fontWeight: 800 }}>VIII. In accordance with rule VII, Game Master LaPuff must accept any proposed new addition as long as it doesn't have a destructive effect on the Game.</p>

              <p style={{ marginBottom: '14px', fontWeight: 800 }}>IX. If a Player's score remains the same for 28 days they will be subject to clout removal and they will enter ‘Fallen Off’ status.</p>
            </div>
          </div>
        </div>

        {/* Bottom half image - overlap top by ~30px via negative margin */}
        <img src={bottomSrc} alt="kogane bottom"
          onError={(e)=>{ e.currentTarget.src = bottomSrc; }}
          className="block w-full pointer-events-none"
          style={{ marginTop: '-30px', display: 'block' }} />

      </div>
    </div>
  );
}
