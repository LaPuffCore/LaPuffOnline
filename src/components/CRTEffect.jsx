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
    // Locked to the Viewport so the warp doesn't "travel" with the map
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 9999 }}>
      
      {/* THE VIEWPORT LENS ENGINE 
          Locked to screen center (50% 50%) to ensure NYC is always at the "peak" of the bulge.
      */}
      <svg className="absolute w-0 h-0">
        <defs>
          <filter id="viewport-lens-warp" x="-20%" y="-20%" width="140%" height="140%">
            <feImage 
              href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cdefs%3E%3CradialGradient id='g' cx='50%25' cy='50%25' r='50%25'%3E%3Cstop offset='0%25' stop-color='%23808080'/%3E%3Cstop offset='100%25' stop-color='%23000000'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23g)'/%3E%3C/svg%3E" 
              result="warpMap" 
            />
            {/* High scale (80) to force the curvature to be visible at NYC zoom levels */}
            <feDisplacementMap 
              in="SourceGraphic" 
              in2="warpMap" 
              scale="80" 
              xChannelSelector="R" 
              yChannelSelector="G" 
            />
          </filter>
        </defs>
      </svg>

      {/* 1. NOISE SIMMER 
          Dropped slightly to maintain satellite clarity.
      */}
      <div 
        className="absolute inset-0 opacity-[0.05]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'brightness(110%) contrast(130%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.12s steps(2) infinite'
        }} 
      />

      {/* 2. THE SPHERIZED MESH
          Applying the warp only to the grid lines. 
          Both vertical and horizontal are now balanced for "presence."
      */}
      <div className="absolute inset-0" style={{ filter: 'url(#viewport-lens-warp)' }}>
        <div className="absolute inset-[-15%] opacity-[0.12]" style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px),
            linear-gradient(0deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px)
          `,
          backgroundSize: '32px 32px',
          transform: 'scale(1.2)', // Overscan to hide the edges of the warp
        }} />
      </div>

      {/* 3. CHROMA FRINGE */}
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
        background: 'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.4) 75%, rgba(0,0,0,0.9) 100%)',
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