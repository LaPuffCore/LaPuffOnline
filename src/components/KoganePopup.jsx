import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

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

    // create an in-flow anchor right after header so this popup can push page content down universally
    let inflowAnchor = document.getElementById('kogane-inflow');
    if (!inflowAnchor) {
      inflowAnchor = document.createElement('div');
      inflowAnchor.id = 'kogane-inflow';
      // place it right after the header so it affects all views consistently
      if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(inflowAnchor, hdr.nextSibling);
      else document.body.insertBefore(inflowAnchor, document.body.firstChild);
    }

    const handleKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('keydown', handleKey);
      // cleanup inflow anchor when unmounting
      const a = document.getElementById('kogane-inflow');
      if (a && a.parentNode) a.parentNode.removeChild(a);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // internal close that will collapse spacer then call parent onClose
  const handleClose = () => {
    // collapse visible content
    const el = contentRef.current;
    if (el) {
      el.style.height = '0px';
      el.style.opacity = '0';
    }
    // collapse spacer
    const spacer = document.getElementById('kogane-spacer');
    if (spacer) {
      spacer.style.height = '0px';
      // remove after transition
      setTimeout(() => {
        if (spacer && spacer.parentNode) spacer.parentNode.removeChild(spacer);
        onClose && onClose();
      }, 950);
    } else {
      onClose && onClose();
    }
  };

  useEffect(() => {
    // Start sequence after 2s
    const t = setTimeout(() => setStarted(true), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!started) return;
    const el = contentRef.current;
    if (!el) return;

    // Measure after paint and animate the content height; because the container is rendered in-flow (inserted after the header)
    // the page content will be pushed down naturally as the inner content height grows.
    requestAnimationFrame(() => {
      // include 60px padding top+bottom so images overlap by 60px each and text stays clear
      const contentH = el.scrollHeight + 120; // 60px top + 60px bottom

      const inner = el;
      inner.style.transition = 'height 900ms ease, opacity 700ms ease 200ms';
      inner.style.height = '0px';
      inner.style.opacity = '0';
      void inner.offsetHeight;
      inner.style.height = contentH + 'px';
      inner.style.opacity = '0.95';
      const done = setTimeout(() => setExpanded(true), 1000);
      return () => clearTimeout(done);
    });
  }, [started]);

  // click outside to close is handled by overlay div below

  // Render into the inflow anchor (inserted after header) so the popup lives in document flow and pushes content down
  const portalRoot = document.getElementById('kogane-inflow') || document.body;
  return createPortal(
    <div style={{ position: 'relative', width: '100%' }}>
      {/* overlay clickable area to close (no blur) - covers entire viewport but sits under the in-flow container so the images/screens remain visually above */}
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 10 }} />

      {/* container anchored below topbar inside the inflow anchor (in-flow) so it pushes page content down */}
      <div ref={containerRef}
        className="mx-auto w-full max-w-3xl"
        onClick={(e)=>e.stopPropagation()}
        style={{ position: 'relative', left: '50%', transform: 'translateX(-50%)', top: 0, zIndex: 11 }}>

        {/* Top half image (anchored) */}
        <img src={topSrc} alt="kogane top"
          onError={(e)=>{ e.currentTarget.src = topSrc; }}
          className="block w-full"
          style={{ display: 'block', marginBottom: '-30px' }} />

        {/* expanding screen area between halves */}
        <div ref={contentRef}
          className="mx-auto w-full overflow-hidden"
          style={{
            height: '0px',
            background: 'rgba(120,255,60,0.95)',
            borderTop: '1px solid rgba(0,200,80,0.9)',
            borderBottom: '1px solid rgba(0,200,80,0.9)',
            boxShadow: 'inset 0 0 40px rgba(0,255,100,0.18), 0 12px 50px rgba(0,255,100,0.25)',
            padding: '60px 30px', // 60px padding top/bottom to keep text clear of overlapping images
            opacity: 0,
            transition: 'height 900ms ease, opacity 700ms ease',
            // glitchy pixel effect
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), repeating-linear-gradient(90deg, rgba(0,255,100,0.04) 0 2px, transparent 2px 4px)',
            backgroundBlendMode: 'overlay',
            backgroundSize: '100% 2px, 4px 100%'
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
          className="block w-full"
          style={{ marginTop: '-30px', display: 'block' }} />

      </div>
    </div>,
    portalRoot
  );
}
