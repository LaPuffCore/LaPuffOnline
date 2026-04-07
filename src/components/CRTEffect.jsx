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
      
      {/* 1. THE BULGING SHADOW MASK (The Lattice)
          - Border radius and scale create the "tube" bulge.
          - We use a dark grid with large spacing (24px) to create "shadows" not "gunk".
      */}
      <div className="absolute inset-[-10%] opacity-[0.15]" style={{
        backgroundImage: `
          linear-gradient(90deg, rgba(0,0,0,0.8) 1px, transparent 1px),
          linear-gradient(0deg, rgba(0,0,0,0.8) 1px, transparent 1px)
        `,
        backgroundSize: '24px 24px', 
        borderRadius: '50%', // Forces the grid to warp toward the edges
        transform: 'perspective(1000px) scale(1.1) rotateX(2deg)',
        filter: 'blur(0.5px)' 
      }} />

      {/* 2. CHROMA FRINGE (Red/Cyan Offset)
          Only visible at the extreme edges, replicating the lens distortion in your reference.
      */}
      <div className="absolute inset-0" style={{
        boxShadow: 'inset 20px 0 40px rgba(255,0,0,0.1), inset -20px 0 40px rgba(0,255,255,0.1)',
      }} />

      {/* 3. WIDE SCANLINES 
          Spaced out and darker to avoid that "dense" interference.
      */}
      <div className="absolute inset-0 opacity-[0.1]" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, #000, #000 2px, transparent 2px, transparent 12px)',
      }} />

      {/* 4. NEARLY GONE NOISE 
          Static minimized to 0.02.
      */}
      <div 
        className="absolute inset-0 opacity-[0.02]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          mixBlendMode: 'screen',
        }} 
      />

      {/* Data wash line */}
      <div
        ref={washRef}
        className="absolute left-0 right-0 z-10"
        style={{
          height: '9%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.02) 50%, transparent 100%)',
          transform: glitch ? `translate(${glitch.tx}px, ${glitch.ty}px)` : 'none',
        }}
      />

      {/* Glitch horizontal tear */}
      {glitch && (
        <div className="absolute left-0 right-0 z-10" style={{
          top: `${glitch.topPct}%`,
          height: '1px',
          background: 'rgba(255,0,80,0.3)',
          filter: 'blur(0.5px)',
          transform: `translateX(${glitch.tx}px)`,
        }} />
      )}

      {/* Heavy Vignette to force the eye to the center "bulge" */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle, transparent 30%, rgba(0,0,0,0.4) 100%)',
      }} />
    </div>
  );
}