import { useEffect, useRef } from 'react';

export default function CRTEffect({ active = true, limitMobile = false }) {
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
    <div 
      id="crt-debug-container"
      className="fixed inset-0 pointer-events-none overflow-hidden" 
      style={{ 
        zIndex: 9999, 
        border: '2px solid red'
      }}
    >
      
      {/* 1. NOISE GRAIN */}
      <div 
        className="absolute inset-0 opacity-[0.08]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          mixBlendMode: 'screen',
        }} 
      />

      {/* 2. SCANLINES */}
      <div className="absolute inset-0 opacity-[0.15]" style={{
        backgroundImage: `linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))`,
        backgroundSize: '100% 4px, 3px 100%'
      }} />

      {/* 3. DATA WASH */}
      <div
        ref={washRef}
        className="absolute left-0 right-0"
        style={{
          height: '10%',
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
          zIndex: 10
        }}
      />

      {/* 4. VIGNETTE */}
      <div 
        className="absolute inset-0" 
        style={{
          background: 'radial-gradient(circle at center, transparent 50%, rgba(0,0,0,0.5) 100%)',
          opacity: limitMobile ? 0.4 : 1
        }} 
      />
    </div>
  );
}