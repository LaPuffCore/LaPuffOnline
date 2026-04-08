import { useEffect, useRef } from 'react';

/**
 * CRTEffect
 * @param {boolean} active - Toggle the effect on/off
 * @param {boolean} limitMobile - Reduces opacity/intensity for mobile UI
 */
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

  /**
   * STACKING STRATEGY:
   * z-index: 1 sits behind your map container (z-index: 2).
   * pointerEvents: 'none' ensures it never blocks clicks.
   */
  const overlayZIndex = 1; 
  const globalOpacity = limitMobile ? 0.35 : 1;

  return (
    <div 
      className="absolute inset-0 pointer-events-none overflow-hidden transition-opacity duration-300" 
      style={{ 
        zIndex: overlayZIndex, 
        opacity: globalOpacity,
        backgroundColor: 'transparent'
      }}
    >
      
      {/* 1. CALMED NOISE GRAIN
          Speed: 0.18s | Intensity: 0.04
      */}
      <div 
        className="absolute inset-0 opacity-[0.04]" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          filter: 'brightness(105%) contrast(115%)',
          mixBlendMode: 'screen',
          animation: 'vhs-flicker 0.18s steps(2) infinite'
        }} 
      />

      {/* 2. BALANCED LATTICE MESH
          32px grid - Equal presence on both axes.
      */}
      <div className="absolute inset-0 opacity-[0.12]">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px),
            linear-gradient(0deg, rgba(255,255,255,0.1) 1px, transparent 1px, rgba(0,0,0,0.4) 2px, transparent 2px)
          `,
          backgroundSize: '32px 32px',
        }} />
      </div>

      {/* 3. CHROMA FRINGE */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(90deg, rgba(255,0,0,0.03) 0%, transparent 15%, transparent 85%, rgba(0,255,255,0.03) 100%)',
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

      {/* 5. TUBE VIGNETTE */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.3) 80%, rgba(0,0,0,0.6) 100%)',
      }} />

      <style jsx>{`
        @keyframes vhs-flicker {
          0% { background-position: 0 0; }
          50% { background-position: 1% 1%; }
          100% { background-position: -1% -1%; }
        }
      `}</style>
    </div>
  );
}