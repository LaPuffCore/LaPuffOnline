import { useEffect, useRef, useState } from 'react';

// CRT / hacked terminal visual effect overlay
// Replaces particles — additive on satellite mode too
export default function CRTEffect({ active = true }) {
  const washRef = useRef(null);
  const gridRef = useRef(null); 
  const [glitch, setGlitch] = useState(null); // {tx, ty, topPct}

  // Scrolling data wash (fast) & lattice drift (ultra slow)
  useEffect(() => {
    if (!active) return;
    let y = -8;
    let slowY = 0;
    let frame;
    const tick = () => {
      // Main data wash speed
      y = (y + 0.11) % 108;
      
      // Ultra slow lattice drift
      slowY = (slowY + 0.015) % 100; 

      if (washRef.current) washRef.current.style.top = `${y}%`;
      if (gridRef.current) gridRef.current.style.backgroundPosition = `0px ${slowY}%`;
      
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
      
      {/* 1. RESTORED GHOST STATIC
          Back to the previous intensity to act as a subtle texture.
      */}
      <div 
        className="absolute inset-0 opacity-[0.08]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'contrast(160%) brightness(120%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.12s steps(2) infinite',
          backgroundSize: '250px 250px'
        }} 
      />

      {/* 2. LARGE SLOW-MOVING LATTICE
          Increased size to 16px for better clarity. 
          The movement is now ultra-slow (0.015 increment).
      */}
      <div 
        ref={gridRef}
        className="absolute inset-0 opacity-[0.06]" 
        style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0) 50%, rgba(255,255,255,0.12) 50%),
            repeating-linear-gradient(0deg, transparent, transparent 6px, rgba(255,255,255,0.08) 6px, rgba(255,255,255,0.08) 8px)
          `,
          backgroundSize: '16px 100%, 100% 16px',
        }} 
      />

      {/* 3. STATIC SCANLINES (The Glass) */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 5px)',
      }} />

      {/* Chromatic aberration edges */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,20,60,0.05) 0%, transparent 10%, transparent 90%, rgba(0,210,255,0.05) 100%)',
      }} />

      {/* Data wash line */}
      <div
        ref={washRef}
        className="absolute left-0 right-0"
        style={{
          height: '9%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,255,180,0.015) 35%, rgba(0,255,200,0.04) 50%, rgba(0,255,180,0.015) 65%, transparent 100%)',
          transform: glitch ? `translate(${glitch.tx}px, ${glitch.ty}px)` : 'none',
        }}
      />

      {/* Glitch horizontal tear */}
      {glitch && (
        <div className="absolute left-0 right-0" style={{
          top: `${glitch.topPct}%`,
          height: '1px',
          background: 'rgba(255,0,80,0.4)',
          filter: 'blur(0.5px)',
          transform: `translateX(${glitch.tx}px)`,
        }} />
      )}

      {/* Subtle vignette */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.35) 100%)',
      }} />

      <style jsx>{`
        @keyframes vhs-flicker {
          0% { background-position: 0 0; }
          50% { background-position: 1% 2%; }
          100% { background-position: 0 0; }
        }
      `}</style>
    </div>
  );
}