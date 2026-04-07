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
      
      {/* THE WARP ENGINE (SVG Filter)
        The 'feDisplacementMap' combined with a 'radialGradient' is the only way 
        to physically bend the grid lines into a sphere.
      */}
      <svg className="absolute w-0 h-0">
        <defs>
          <filter id="sphere-warp" x="-20%" y="-20%" width="140%" height="140%">
            <feImage href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cdefs%3E%3CradialGradient id='g'%3E%3Cstop offset='0%25' stop-color='%23808080'/%3E%3Cstop offset='100%25' stop-color='%23000000'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23g)'/%3E%3C/svg%3E" result="warpMap" />
            <feDisplacementMap in="SourceGraphic" in2="warpMap" scale="60" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* 1. NOISE SIMMER */}
      <div 
        className="absolute inset-0 opacity-[0.08]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'brightness(130%) contrast(150%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.1s steps(2) infinite'
        }} 
      />

      {/* 2. THE WARPED LATTICE & SCANLINE MESH
          This is wrapped in the 'sphere-warp' filter to physically curve the lines.
      */}
      <div className="absolute inset-0" style={{ filter: 'url(#sphere-warp)' }}>
        
        {/* TIGHT SCANLINES */}
        <div className="absolute inset-[-10%] opacity-[0.18]" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, #000 0px, #000 2px, transparent 2px, transparent 4px)',
        }} />

        {/* HIGH-VISIBILITY LATTICE (The Bars)
            - Spaced at 32px
            - Uses a brighter rgba(255,255,255,0.2) to ensure it's tangible on dark red.
        */}
        <div className="absolute inset-[-10%] opacity-[0.15]" style={{
          backgroundImage: `
            linear-gradient(90deg, 
              rgba(255,255,255,0.2) 0px, 
              rgba(255,255,255,0.2) 1px, 
              transparent 1px, 
              rgba(0,0,0,0.5) 2px, 
              transparent 2px
            )
          `,
          backgroundSize: '32px 100%',
        }} />
      </div>

      {/* 3. CHROMA FRINGE (Fixed Lens Effect) */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.06) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.06) 100%)',
      }} />

      {/* Data wash line */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '10%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        }}
      />

      {/* Heavy Vignette (The Housing) */}
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