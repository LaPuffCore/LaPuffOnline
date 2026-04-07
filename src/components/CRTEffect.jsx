import { useEffect, useRef, useState } from 'react';

// CRT Universal Viewport Warp
// Restored the clean gridlines with added physical spherical distortion
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
      
      {/* 1. NOISE SIMMER 
          Tangible digital grain - restored to your preferred level.
      */}
      <div 
        className="absolute inset-0 opacity-[0.07]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'brightness(120%) contrast(140%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.1s steps(2) infinite'
        }} 
      />

      {/* TUBE GEOMETRY WRAPPER
          This wraps the lines and applies the "Bulge". 
          By using perspective and scale, the lines 'curve' toward the corners.
      */}
      <div className="absolute inset-[-5%] overflow-hidden" style={{
        transform: 'perspective(800px) rotateX(0deg) scale(1.05)',
        maskImage: 'radial-gradient(circle at center, black 30%, rgba(0,0,0,0.9) 70%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(circle at center, black 30%, rgba(0,0,0,0.9) 70%, transparent 100%)',
      }}>
        
        {/* 2. RESTORED HORIZONTAL SCANLINES
            Tight, dark lines across the whole screen.
        */}
        <div className="absolute inset-0 opacity-[0.15]" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, #000 0px, #000 2px, transparent 2px, transparent 4px)',
        }} />

        {/* 3. THE SPHERICAL SHADOW MASK (Lattice)
            - Reverted to your 32px spacing.
            - The scale(1.1) inside the perspective wrapper creates the physical 'Bending' effect.
        */}
        <div className="absolute inset-0 opacity-[0.12]" style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px)
          `,
          backgroundSize: '32px 100%',
          // This specific transform creates the "bending" of the linear-gradient
          transform: 'scale(1.15) translateY(-1%)', 
        }} />
      </div>

      {/* 4. CHROMA ABERRATION FRINGE 
          Universal viewport-level red/cyan bleed.
      */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.05) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.05) 100%)',
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

      {/* Heavy Vignette - Key for the "Shadow" look you liked in zones */}
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