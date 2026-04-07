import { useEffect, useRef, useState } from 'react';

// Replicating a physical CRT terminal with tangible lattice, warp, and integrated chroma.
// This design mimics looking into a physical glass tube.
export default function CRTEffect({ active = true }) {
  const washRef = useRef(null);
  const [glitch, setGlitch] = useState(null); // {tx, ty, topPct}

  // Scrolling data wash line
  useEffect(() => {
    if (!active) return;
    let y = -8;
    let frame;
    const tick = () => {
      y = (y + 0.11) % 108;
      if (washRef.current) washRef.current.style.top = `${y}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Random glitch frames (horizontal tears)
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (Math.random() < 0.06) {
        setGlitch({
          tx: (Math.random() - 0.5) * 14,
          ty: (Math.random() - 0.5) * 3,
          topPct: 20 + Math.random() * 55,
        });
        setTimeout(() => setGlitch(null), 55 + Math.random() * 110);
      }
    }, 380);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 20 }}>
      
      {/* 1. Integrated CHROMA STATIC Layer (Depth Layer)
          This sits first, providing an integrated simmer. 
          The contrast/brightness and hue-rotate animation create the depth-of-chroma specs.
      */}
      <div 
        className="absolute inset-0 opacity-[0.14]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'contrast(180%) brightness(130%)',
          mixBlendMode: 'screen',
          // The chroma-shimmer makes the specs "bloom" and change colors slowly
          animation: 'chroma-shimmer 0.2s infinite steps(4)',
          backgroundSize: '300px 300px'
        }} 
      />

      {/* 2. Tangible APERTURE GRILLE Layer (Vertical Lattice) - WARPED for Curve
          We apply a perspective-scale effect to bulge the vertical lines, 
          making them widen at the center, replicating the glass tube physicality.
      */}
      <div className="absolute inset-0 opacity-[0.08]" style={{
        backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0) 50%, rgba(255,255,255,0.18) 50%)',
        backgroundSize: '12px 100%', // Widened for chunkier, palpable lattice lines
        // Physical CRT curvature: bulges the pattern outwards towards the center
        transform: 'scale(1.08) perspective(2000px) rotateX(2deg) rotateY(-1deg)',
      }} />

      {/* 3. PHYSICAL HORIZONTAL SCANLINES (Integrated Grid Layer)
          Widened lines with more prominent gaps, integrating into a palpable mesh with the lattice.
      */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 8px)',
        transform: 'scale(1.04) rotateX(-2deg)', // Matching subtle physical slant
      }} />

      {/* Edge Chromatic Aberration Halo */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,20,60,0.06) 0%, transparent 12%, transparent 88%, rgba(0,210,255,0.06) 100%)',
      }} />

      {/* Data wash line (original fast animation) */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '9%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,255,180,0.018) 35%, rgba(0,255,200,0.048) 50%, rgba(0,255,180,0.018) 65%, transparent 100%)',
          transform: glitch ? `translate(${glitch.tx}px, ${glitch.ty}px)` : 'none',
        }}
      />

      {/* Glitch horizontal tear */}
      {glitch && (
        <div className="absolute left-0 right-0 z-10" style={{
          top: `${glitch.topPct}%`,
          height: '1px',
          background: 'rgba(255,0,80,0.55)',
          filter: 'blur(0.5px)',
          transform: `translateX(${glitch.tx}px)`,
        }} />
      )}

      {/* Heavier, Physical VIGNETTE
          Deepens the physical curve feel by darkening the corners aggressively.
      */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.3) 85%, rgba(0,0,0,0.55) 100%)',
      }} />

      <style jsx global>{`
        /* select relevant classes within EventTile to override and add ellipsis/line clamping */
        .tile-title {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @keyframes chroma-shimmer {
          0% { background-position: 0 0; filter: hue-rotate(0deg) contrast(180%); }
          50% { background-position: 1% 1%; filter: hue-rotate(45deg) contrast(190%); }
          100% { background-position: -1% 1%; filter: hue-rotate(0deg) contrast(180%); }
        }
      `}</style>
    </div>
  );
}