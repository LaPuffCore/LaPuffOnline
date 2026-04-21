import { useEffect, useRef } from 'react';

/**
 * CRTEffect — sits at zIndex:1 behind the map canvas (zIndex:2) but in
 * front of the plain #0d0000 background. MapView must set the map canvas
 * background to transparent so the CRT texture bleeds through.
 */
export default function CRTEffect({ active = true, limitMobile = false }) {
  const washRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    let y = -15;
    let frame;
    const speed = limitMobile ? 0.22 : 0.11; // faster on mobile for more visible sweep
    const tick = () => {
      y = (y + speed) % 115;
      if (washRef.current) washRef.current.style.top = `${y}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, limitMobile]);

  if (!active) return null;

  const latticeSize = limitMobile ? '48px 48px' : '32px 32px';
  const scanlineSize = limitMobile ? '100% 5px' : '100% 4px';
  const scanBarHeight = limitMobile ? '12%' : '10%';

  return (
    /* zIndex 1: behind map canvas (zIndex 2), in front of background */
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 1 }}
    >
      {/* 1. NOISE GRAIN — larger tile + higher opacity on mobile for visibility on high-DPI screens */}
      <div
        className="absolute inset-0"
        style={{
          opacity: limitMobile ? 0.13 : 0.07,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          backgroundSize: limitMobile ? '320px 320px' : '250px 250px',
          filter: 'brightness(115%) contrast(130%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.18s steps(2) infinite',
        }}
      />
      {/* 2. LATTICE MESH (Shadow Mask) */}
      <div className="absolute inset-0 opacity-[0.18]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px, rgba(0,0,0,0.5) 2px, transparent 2px),
            linear-gradient(0deg, rgba(255,255,255,0.15) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px)
          `,
          backgroundSize: latticeSize,
        }} />
      </div>
      {/* 3. FINE HORIZONTAL SCANLINES */}
      <div className="absolute inset-0 opacity-[0.1]" style={{
        backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%)',
        backgroundSize: scanlineSize,
      }} />
      {/* 4. CHROMA FRINGE */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.06) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.06) 100%)',
      }} />
      {/* 5. DATA WASH LINE (Animated) — brighter on mobile, proper gradient for visible horizontal bar */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: scanBarHeight,
          background: limitMobile
            ? 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.03) 20%, rgba(255,255,255,0.11) 50%, rgba(255,255,255,0.03) 80%, transparent 100%)'
            : 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        }}
      />
      {/* 6. TUBE VIGNETTE */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.4) 80%, rgba(0,0,0,0.8) 100%)',
          opacity: limitMobile ? 0.45 : 1,
        }}
      />
      <style>{`
        @keyframes vhs-flicker {
          0%   { background-position: 0 0; }
          50%  { background-position: 1.5% 1.5%; }
          100% { background-position: -1.5% -1.5%; }
        }
      `}</style>
    </div>
  );
}