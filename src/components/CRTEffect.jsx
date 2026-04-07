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
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 9999 }}>
      
      {/* 1. CALMED NOISE GRAIN
          Lowered intensity and slowed down the flicker rate to reduce the "spinning" feel.
      */}
      <div 
        className="absolute inset-0 opacity-[0.04]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'brightness(105%) contrast(115%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.18s steps(2) infinite'
        }} 
      />

      {/* 2. BALANCED LATTICE MESH
          Both horizontal and vertical are equal presence. 
          Locked to 32px spacing for the cinematic "shadow mask" look.
      */}
      <div className="absolute inset-0 opacity-[0.12]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px),
            linear-gradient(0deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px)
          `,
          backgroundSize: '32px 32px',
        }} />
      </div>

      {/* 3. CHROMA FRINGE 
          Subtle color bleed at the viewport edges.
      */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.04) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.04) 100%)',
      }} />

      {/* 4. DATA WASH LINE */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '10%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.02) 50%, transparent 100%)',
        }}
      />

      {/* Heavy Vignette (Tube Frame) */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.4) 80%, rgba(0,0,0,0.8) 100%)',
      }} />

      <style jsx>{`
        @keyframes vhs-flicker {
          0% { background-position: 0 0; }
          50% { background-position: 1% 1%; }
          100% { background-position: -1% -1%; }
        }
      `}</style>
    </div>
  );
}