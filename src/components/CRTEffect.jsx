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
      
      {/* SVG FILTER DEFINITION: This is the "Engine" for the warp.
        It uses a radial gradient to displace the grid lines outwards from the center.
      */}
      <svg className="absolute w-0 h-0">
        <defs>
          <filter id="crt-warp">
            <feTurbulence type="fractalNoise" baseFrequency="0.01" numOctaves="1" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="20" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          
          {/* THE SPHERICAL LENS MASK */}
          <mask id="tube-mask">
            <radialGradient id="grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" />
              <stop offset="80%" stopColor="white" />
              <stop offset="100%" stopColor="black" />
            </radialGradient>
            <rect width="100%" height="100%" fill="url(#grad)" />
          </mask>
        </defs>
      </svg>

      {/* 1. THE WARPED LATTICE + SCANLINE MESH 
          This layer actually bends. The 'scale' inside the transform 
          plus the SVG filter creates the physical bulge.
      */}
      <div className="absolute inset-[-5%] opacity-[0.2]" style={{
        backgroundImage: `
          linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px),
          repeating-linear-gradient(0deg, #000 0px, #000 2px, transparent 2px, transparent 4px)
        `,
        backgroundSize: '32px 100%, 100% 4px',
        filter: 'url(#crt-warp)',
        mask: 'url(#tube-mask)',
        WebkitMask: 'url(#tube-mask)',
        transform: 'scale(1.1)', // Prevents edge cut-off from the warp
      }} />

      {/* 2. NOISE SIMMER (Tangible presence) */}
      <div 
        className="absolute inset-0 opacity-[0.06]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.12s steps(2) infinite'
        }} 
      />

      {/* 3. CHROMA FRINGE 
          Fixed to the viewport to maintain lens distortion feel regardless of map zoom.
      */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.06) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.06) 100%)',
        mixBlendMode: 'screen'
      }} />

      {/* Data wash line */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '10%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
        }}
      />

      {/* Heavy Vignette (The Tube Housing) */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.4) 80%, rgba(0,0,0,0.7) 100%)',
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