import { useEffect, useRef, useState } from 'react';

export default function CRTEffect({ active = true }) {
  const washRef = useRef(null);

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

  if (!active) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 20 }}>
      
      {/* 1. NOISE SIMMER (Grain) */}
      <div 
        className="absolute inset-0 opacity-[0.07]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'brightness(120%) contrast(140%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.1s steps(2) infinite'
        }} 
      />

      {/* 2. THE UNIFIED SPHERICAL LATTICE 
          Both Horizontal and Vertical are exactly the same size and intensity.
          The 'perspective' and 'rotateX' stack forces the grid to bulge at the viewer.
      */}
      <div className="absolute inset-[-10%] opacity-[0.18]" style={{
        backgroundImage: `
          linear-gradient(90deg, rgba(255,255,255,0.22) 1px, transparent 1px, rgba(0,0,0,0.5) 2px, transparent 2px),
          linear-gradient(0deg, rgba(255,255,255,0.22) 1px, transparent 1px, rgba(0,0,0,0.5) 2px, transparent 2px)
        `,
        backgroundSize: '32px 32px',
        // Creating the physical bulge through 3D distortion
        transform: 'perspective(1000px) rotateX(4deg) rotateY(-1deg) scale(1.15)',
        maskImage: 'radial-gradient(circle at center, black 20%, rgba(0,0,0,0.8) 60%, transparent 95%)',
        WebkitMaskImage: 'radial-gradient(circle at center, black 20%, rgba(0,0,0,0.8) 60%, transparent 95%)',
      }} />

      {/* 3. CHROMA FRINGE 
          Fixed to viewport to maintain the lens feel as you move the map.
      */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.06) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.06) 100%)',
      }} />

      {/* 4. THE MOVING SCANLINE (Data Wash) */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '10%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        }}
      />

      {/* Heavy Physical Vignette */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.4) 75%, rgba(0,0,0,0.8) 100%)',
      }} />

      <style jsx>{`
        @keyframes vhs-flicker {
          0% { background-position: 0 0; }
          50% { background-position: 1% 1%; }
          100% { background-position: -1% 0; }
        }
      `}</style>
    </div>
  );
}