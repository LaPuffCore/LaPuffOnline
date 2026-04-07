import { useEffect, useRef, useState } from 'react';

// CRT / hacked terminal visual effect overlay
// Replaces particles — additive on satellite mode too
export default function CRTEffect({ active = true }) {
  const washRef = useRef(null);
  const [glitch, setGlitch] = useState(null); // {tx, ty, topPct}

  // Scrolling data wash
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

  // Random glitch frames
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
      {/* Horizontal scanlines */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.055) 3px, rgba(0,0,0,0.055) 4px)',
      }} />

      {/* Chromatic aberration edges */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,20,60,0.055) 0%, transparent 7%, transparent 93%, rgba(0,210,255,0.055) 100%)',
      }} />

      {/* Data wash line */}
      <div
        ref={washRef}
        className="absolute left-0 right-0"
        style={{
          height: '9%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,255,180,0.018) 35%, rgba(0,255,200,0.048) 50%, rgba(0,255,180,0.018) 65%, transparent 100%)',
          transform: glitch ? `translate(${glitch.tx}px, ${glitch.ty}px)` : 'none',
        }}
      />

      {/* Glitch horizontal tear */}
      {glitch && (
        <div className="absolute left-0 right-0" style={{
          top: `${glitch.topPct}%`,
          height: '1px',
          background: 'rgba(255,0,80,0.55)',
          filter: 'blur(0.5px)',
          transform: `translateX(${glitch.tx}px)`,
        }} />
      )}

      {/* Subtle vignette */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,0.3) 100%)',
      }} />
    </div>
  );
}