import { useEffect, useRef, useState } from 'react';

export default function CRTEffect({ active = true }) {
  const washRef = useRef(null);
  const [glitch, setGlitch] = useState(null);

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
      
      {/* 1. RESTORED NOISE SIMMER 
          Bumping intensity so the grain is tangible again.
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

      {/* 2. SPHERICAL SHADOW MASK + PHOSPHOR GLOW
          - Uses 32px spacing for that wide, cinematic look.
          - Combines a dark shadow (for depth) with a faint white line (for visibility).
          - Mask-image creates the "fisheye" warp by fading the grid at the extreme corners.
      */}
      <div className="absolute inset-0 opacity-[0.18]" style={{
        backgroundImage: `
          linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px, rgba(0,0,0,0.5) 2px, transparent 2px),
          linear-gradient(0deg, rgba(255,255,255,0.15) 1px, transparent 1px, rgba(0,0,0,0.5) 2px, transparent 2px)
        `,
        backgroundSize: '32px 32px',
        maskImage: 'radial-gradient(circle, black 30%, transparent 150%)',
        WebkitMaskImage: 'radial-gradient(circle, black 30%, transparent 150%)',
        transform: 'scale(1.15)', // Overscan to prevent edge clipping
      }} />

      {/* 3. WIDE HORIZONTAL SCANLINES
          Re-spaced to 12px to keep the screen from feeling too "busy."
      */}
      <div className="absolute inset-0 opacity-[0.12]" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, #000 0px, #000 2px, transparent 2px, transparent 12px)',
      }} />

      {/* 4. CHROMA FRINGE 
          Subtle color bleed on the horizontal axis.
      */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,50,0.04) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.04) 100%)',
      }} />

      {/* Data wash line */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '12%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
        }}
      />

      {/* Heavy Vignette */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.5) 100%)',
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