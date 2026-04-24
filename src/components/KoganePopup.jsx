import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function KoganePopup({ onClose }) {
  const [started, setStarted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [topOffset, setTopOffset] = useState(72);
  const contentRef = useRef(null);
  const containerRef = useRef(null);
  const topImgRef = useRef(null);
  const bottomImgRef = useRef(null);

  // compute BASE_URL-aware asset path (works with Vite base)
  const base = (import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
  const topSrc = `${base}data/koganetop.png`;
  const bottomSrc = `${base}data/koganebottom.png`;

  useEffect(() => {
    // measure header height if present so top image anchors below it
    const hdr = document.querySelector('header');
    const h = hdr ? hdr.getBoundingClientRect().height : 72;
    setTopOffset(Math.round(h));

    // no spacer here; overlay will be full-screen and scrollable like EventDetailPopup
    const handleKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // internal close that will collapse content then call parent onClose
  const handleClose = () => {
    const el = contentRef.current;
    if (el) {
      el.style.height = '0px';
      el.style.opacity = '0';
    }
    setTimeout(() => {
      onClose && onClose();
    }, 500);
  };

  useEffect(() => {
    // ensure an inflow anchor exists directly after the header so popup content lives in-page (no inner scrollbar)
    const hdr = document.querySelector('header');
    let inflow = document.getElementById('kogane-inflow');
    if (!inflow) {
      inflow = document.createElement('div');
      inflow.id = 'kogane-inflow';
      if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(inflow, hdr.nextSibling);
      else document.body.insertBefore(inflow, document.body.firstChild);
    }

    // add keyframe for glitch animation if not present
    if (!document.getElementById('kogane-glitch-styles')) {
      const s = document.createElement('style');
      s.id = 'kogane-glitch-styles';
      s.innerHTML = `
      @keyframes koganeShift { 0% { background-position: 0 0; } 100% { background-position: -200px 0; } }
      `;
      document.head.appendChild(s);
    }

    // Start sequence after 2s
    const t = setTimeout(() => setStarted(true), 2000);
    return () => {
      clearTimeout(t);
      // cleanup inflow spacer on unmount
      const inf = document.getElementById('kogane-inflow');
      if (inf && inf.parentNode) {
        // remove the inflow only if it's empty
        if (inf.childElementCount === 0 && !document.getElementById('kogane-page-spacer')) inf.parentNode.removeChild(inf);
      }
    };
  }, []);
  useEffect(() => {
    if (!started) return;
    const el = contentRef.current;
    const bottomImg = bottomImgRef.current;
    const topImg = topImgRef.current;
    if (!el) return;

    const computeAndAnimate = () => {
      // measured content height (text) + ensure 60px padding top/bottom so images overlap
      const textH = el.scrollHeight;
      const contentH = textH + 120; // 60 top + 60 bottom padding

      // bottom image visible height
      let bottomH = 0;
      if (bottomImg) {
        const br = bottomImg.getBoundingClientRect();
        bottomH = br.height || (bottomImg.naturalHeight || 0) * (Math.min(980, window.innerWidth * 0.9) / (bottomImg.naturalWidth || 1));
      }

      // Set content height so the page can grow and be scrolled (no inner scrollbar)
      el.style.transition = 'height 900ms ease, opacity 700ms ease 200ms, margin-top 700ms ease';
      el.style.height = '0px';
      el.style.opacity = '0';
      // shift the screen up 60px so it sits under the top image
      el.style.marginTop = '-60px';
      void el.offsetHeight;
      el.style.height = contentH + 'px';
      el.style.opacity = '0.92';

      // ensure images sit above the screen
      if (topImg) topImg.style.zIndex = 100003;
      if (bottomImg) bottomImg.style.zIndex = 100003;
      el.style.zIndex = 100002; // screen behind images

      // animate bottom image starting position: when not started earlier it was higher by 60px; now bring it to overlap position
      if (bottomImg) {
        bottomImg.style.transition = 'transform 900ms ease';
        bottomImg.style.transform = 'translateY(0)';
      }

      // make page-long spacer to ensure full scrollable area equals top+screen+bottom+400px
      const totalNeeded = Math.round((topImg ? topImg.getBoundingClientRect().height : 0) + contentH + bottomH + 400);
      let pageSpacer = document.getElementById('kogane-page-spacer');
      if (!pageSpacer) {
        pageSpacer = document.createElement('div');
        pageSpacer.id = 'kogane-page-spacer';
        // insert after the inflow anchor container
        const inflow = document.getElementById('kogane-inflow');
        if (inflow && inflow.parentNode) inflow.parentNode.insertBefore(pageSpacer, inflow.nextSibling);
        else document.body.appendChild(pageSpacer);
      }
      pageSpacer.style.height = totalNeeded + 'px';

      const done = setTimeout(() => setExpanded(true), 1000);
      return () => clearTimeout(done);
    };

    if (bottomImg && (bottomImg.complete || bottomImg.naturalHeight)) {
      computeAndAnimate();
    } else if (bottomImg) {
      bottomImg.onload = () => computeAndAnimate();
      setTimeout(() => computeAndAnimate(), 500);
    } else {
      computeAndAnimate();
    }

  }, [started]);

  // Render popup fixed and centered below the topbar; overlay covers entire viewport below header (so header is not blurred)
  const hdr = document.querySelector('header');
  const hdrH = hdr ? hdr.getBoundingClientRect().height : topOffset;
  const overlayStyle = {
    position: 'fixed',
    left: 0,
    right: 0,
    top: hdrH + 'px',
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    zIndex: 100000
  };

  const portalRoot = document.body;
  // Portal into the inflow anchor so popup contents live in the page flow (no inner scrollbar)
  const inflowRoot = document.getElementById('kogane-inflow') || document.body;
  return createPortal(
    <>
      {/* Overlay covering viewport below header (header stays on top) */}
      <div onClick={handleClose} className="fixed left-0 right-0" style={{ top: (document.querySelector('header')?.getBoundingClientRect().height || topOffset) + 'px', bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', zIndex: 100000 }} />

      {/* In-flow container appended to the inflow anchor; this sits in document flow so body scroll includes it */}
      <div ref={containerRef} onClick={(e)=>e.stopPropagation()} style={{ width: 'min(980px, 90vw)', margin: '0 auto', position: 'relative', zIndex: 100001 }}>

        {/* Top half image (anchored) */}
          <img ref={topImgRef} src={topSrc} alt="kogane top"
            onError={(e)=>{ e.currentTarget.src = topSrc; }}
            style={{ display: 'block', width: '100%', zIndex: 100003, position: 'relative' }} />

          {/* glitch layer behind the screen */}
          <div style={{ position: 'relative', width: '100%' }}>
            <div style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '0',
              height: '100%',
              zIndex: 100000,
              pointerEvents: 'none',
              backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.02) 0 1px, transparent 1px 3px), linear-gradient(90deg, rgba(0,255,120,0.03), rgba(0,255,100,0.02))',
              backgroundSize: '100% 4px, 200% 100%',
              animation: 'koganeShift 6s linear infinite'
            }} />

            {/* expanding screen area between halves */}
            <div ref={contentRef}
              style={{
                height: '0px',
                position: 'relative',
                background: 'rgba(120,255,60,0.9)',
                borderRadius: '10px',
                borderTop: '1px solid rgba(0,200,80,0.9)',
                borderBottom: '1px solid rgba(0,200,80,0.9)',
                boxShadow: 'inset 0 0 40px rgba(0,255,100,0.18), 0 12px 50px rgba(0,255,100,0.25)',
                padding: '60px 30px', // 60px padding top/bottom to keep text clear of overlapping images
                opacity: 0,
                transition: 'height 900ms ease, opacity 700ms ease',
                overflow: 'visible',
                zIndex: 100001
              }}>

            <div style={{ position: 'relative', color: '#000', maxWidth: '980px', margin: '0 auto', fontFamily: 'Nunito, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial' }}>
              <h2 style={{ textAlign: 'center', fontWeight: 900, fontSize: '28px', marginBottom: '12px', color: '#8B0000' }}>CLOUT CULLING GAME RULES</h2>

              <div style={{ fontSize: '16px', lineHeight: 1.8 }}>
                <p style={{ marginBottom: '18px', fontWeight: 800 }}>I. Once a player has awakened their Clout Alias, they must declare their participation in the Clout Culling Games at a zip-colony of their choice within 28 days - these Players are the two types of either Orbiter or Participant.</p>

                <p style={{ marginBottom: '18px', fontWeight: 800 }}>II. Any Players who break the previous rule will be subject to clout technique removal and coincidingly will be giga-mogged by other players.</p>

                <p style={{ marginBottom: '18px', fontWeight: 800 }}>III. Orbiters who enter a colony without one chosen become Participants at the moment of entry and will be considered to have declared participation in the Clout Culling Games (Normies already inside a barrier at the start of the games will be given at least one chance to exit safely).</p>

                <p style={{ marginBottom: '18px', fontWeight: 800 }}>IV. Players score points by engaging in more motion than other Players.</p>

                <p style={{ marginBottom: '18px', fontWeight: 800 }}>V. Players who refuse to participate by either not joining or becoming inactive will be Simulated at a fraction of their potential and coincidingly will be giga-mogged by other Players.</p>

                <p style={{ marginBottom: '18px', fontWeight: 800 }}>VI. The point value categories of a Player's motion is decided by Game Master LaPuff. As a general rule, in real life motion is weighted more than digital motion (though both are still counted).</p>

                <div style={{ marginBottom: '12px' }}>
                  <p style={{ fontWeight: 800, marginBottom: '8px' }}>VII. Players can expend a set amount of points as determined by Game Master LaPuff to engage one of the three following options:</p>
                  <ol style={{ marginLeft: '22px', paddingLeft: '8px', fontWeight: 800, listStyleType: 'upper-alpha' }}>
                    <li style={{ marginBottom: '8px' }}>Players may add a rule to the Clout Culling Games provided that the rule described does not end the Games. Rules added may not be subtracted.</li>
                    <li style={{ marginBottom: '8px' }}>Players may add a site function to the site which hosts the Clout Culling Games - if this function adds a way for Players to gain or lose points it will be accordingly balanced by Games Master LaPuff.</li>
                    <li style={{ marginBottom: '8px' }}>Players may claim a zip region as theirs to form as an Official Clout Colony gaining a name of their choosing, color of their choosing, and other perks as to be determined by the development of the Game.</li>
                  </ol>
                </div>

                <p style={{ marginBottom: '18px', fontWeight: 800 }}>VIII. In accordance with rule VII, Game Master LaPuff must accept any proposed new addition as long as it doesn't have a destructive effect on the Game.</p>

                <p style={{ marginBottom: '18px', fontWeight: 800 }}>IX. If a Player's score remains the same for 28 days they will be subject to clout removal and they will enter ‘Fallen Off’ status.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom half image - overlap into the screen area */}
        <img ref={bottomImgRef} src={bottomSrc} alt="kogane bottom"
          onError={(e)=>{ e.currentTarget.src = bottomSrc; }}
          style={{ display: 'block', width: '100%', marginTop: '-60px', zIndex: 100003, position: 'relative', transform: started ? 'translateY(0)' : 'translateY(-60px)', transition: 'transform 700ms ease' }} />

        </div>

      </div>

    </>,
    portalRoot
  );
}
