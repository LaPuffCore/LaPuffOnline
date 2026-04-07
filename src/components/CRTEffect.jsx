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
      
      {/* THE LENS DISTORTION ENGINE 
          This replicates the 'Lens Distortion' and 'Curvature' settings 
          seen in professional video software.
      */}
      <svg className="absolute w-0 h-0">
        <defs>
          <filter id="crt-lens-warp" x="-20%" y="-20%" width="140%" height="140%">
            {/* Creates a displacement map based on a spherical gradient */}
            <feImage 
              href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cdefs%3E%3CradialGradient id='g'%3E%3Cstop offset='0%25' stop-color='%23808080'/%3E%3Cstop offset='100%25' stop-color='%23000000'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23g)'/%3E%3C/svg%3E" 
              result="warpMap" 
            />
            <feDisplacementMap 
              in="SourceGraphic" 
              in2="warpMap" 
              scale="50" 
              xChannelSelector="R" 
              yChannelSelector="G" 
            />
          </filter>
        </defs>
      </svg>

      {/* 1. NOISE SIMMER (The "Grain") */}
      <div 
        className="absolute inset-0 opacity-[0.07]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'brightness(120%) contrast(140%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.1s steps(2) infinite'
        }} 
      />

      {/* 2. THE WARPED LATTICE MESH
          This container is processed by the SVG warp filter.
          The lines are set to your 'best version' specs for visibility.
      */}
      <div className="absolute inset-0" style={{ filter: 'url(#crt-lens-warp)' }}>
        <div className="absolute inset-[-10%] opacity-[0.15]" style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px),
            linear-gradient(0deg, #000 0px, #000 2px, transparent 2px, transparent 4px)
          `,
          backgroundSize: '32px 100%, 100% 4px',
          transform: 'scale(1.1)', // Prevents the warp from pulling the edges in
        }} />
      </div>

      {/* 3. CHROMA FRINGE (Lens Prism FX)
          Matches the 'Horizontal/Vertical Prism FX' seen in software.
      */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.05) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.05) 100%)',
      }} />

      {/* 4. DATA WASH LINE */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '10%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
        }}
      />

      {/* Heavy Vignette to define the tube edges */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle, transparent 35%, rgba(0,0,0,0.5) 100%)',
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