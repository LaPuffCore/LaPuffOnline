import { useEffect, useRef, useState } from 'react';

// CRT / hacked terminal visual effect overlay
// Replaces particles — additive on satellite mode too
export default function CRTEffect({ active = true }) {
  const washRef = useRef(null);
  const gridRef = useRef(null); // Reference for the moving lattice
  const [glitch, setGlitch] = useState(null); // {tx, ty, topPct}

  // Scrolling data wash & grid texture
  useEffect(() => {
    if (!active) return;
    let y = -8;
    let frame;
    const tick = () => {
      y = (y + 0.11) % 108;
      if (washRef.current) washRef.current.style.top = `${y}%`;
      // Sync the grid/lattice movement to the same rate
      if (gridRef.current) gridRef.current.style.backgroundPosition = `0px ${y}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Random glitch frames
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
      
      {/* 1. TUNED STATIC LAYER
          Increased opacity to 0.12 and contrast to 200% for better definition.
      */}
      <div 
        className="absolute inset-0 opacity-[0.12]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'contrast(200%) brightness(140%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.12s steps(2) infinite',
          backgroundSize: '250px 250px'
        }} 
      />

      {/* 2. SYNCED MOVING GRID (Vertical + Horizontal Cross-Hatching)
          This layer is now manipulated by gridRef to scroll with the scanline.
      */}
      <div 
        ref={gridRef}
        className="absolute inset-0 opacity-[0.07]" 
        style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0) 50%, rgba(255,255,255,0.15) 50%),
            repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(255,255,255,0.1) 4px, rgba(255,255,255,0.1) 6px)
          `,
          backgroundSize: '8px 100%, 100% 12px',
        }} 
      />

      {/* 3. STATIC HORIZONTAL SCANLINES (The "Glass" layer) */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 5px)',
      }} />

      {/* Chromatic aberration edges */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,20,60,0.055) 0%, transparent 7%, transparent 93%, rgba(0,210,255,0.055) 100%)',
      }} />

      {/* Data wash line */}
      <div
        ref={washRef}
        className="absolute left-0 right-0"
        style={{
          height: '9%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,255,180,0.018) 35%, rgba(0,255,200,0.048) 50%, rgba(0,255,180,0.018) 65%, transparent 100%)',
          transform: glitch ? `translate(${glitch.tx}px, ${glitch.ty}px)` : 'none',
        }}
      />

      {/* Glitch horizontal tear */}
      {glitch && (
        <div className="absolute left-0 right-0" style={{
          top: `${glitch.topPct}%`,
          height: '1px',
          background: 'rgba(255,0,80,0.55)',
          filter: 'blur(0.5px)',
          transform: `translateX(${glitch.tx}px)`,
        }} />
      )}

      {/* Subtle vignette */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,0.3) 100%)',
      }} />

      <style jsx>{`
        @keyframes vhs-flicker {
          0% { background-position: 0 0; }
          33% { background-position: 2% 4%; }
          66% { background-position: -1% 2%; }
          100% { background-position: 0 0; }
        }
      `}</style>
    </div>
  );
}