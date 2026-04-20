import { useState } from 'react';

export default function MapIntro({ onEnter }) {
  const [phase, setPhase] = useState('idle'); // idle | opening | fading
  const [btnHover, setBtnHover] = useState(false);

  function handleEnter() {
    setPhase('opening');
    setTimeout(() => setPhase('fading'), 1200);
    // Use requestAnimationFrame to avoid blocking during heavy map computation
    setTimeout(() => requestAnimationFrame(onEnter), 2000);
  }

  const doorsOpen = phase === 'opening' || phase === 'fading';
  const titleFading = phase === 'fading';

  return (
    <div className="absolute inset-0 z-40 overflow-hidden pointer-events-auto">
      {/* Title — ABOVE the doors, fades out after doors open */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none px-4 text-center"
        style={{ transition: 'opacity 0.8s ease-out', opacity: titleFading ? 0 : 1 }}
      >
        <p className="text-red-500 font-black text-xs tracking-[0.4em] uppercase mb-3 opacity-60">Welcome to</p>
        <h1 className="font-black text-5xl md:text-7xl text-white leading-none tracking-tight"
          style={{ textShadow: '0 0 40px rgba(255,0,0,0.6), 0 0 80px rgba(255,0,0,0.3)' }}>
          THE CLOUT
        </h1>
        <h1 className="font-black text-5xl md:text-7xl text-red-500 leading-none tracking-tight"
          style={{ textShadow: '0 0 40px rgba(255,0,0,0.8)' }}>
          CULLING GAMES
        </h1>
        <p className="text-red-300/60 font-bold text-sm mt-4 tracking-widest uppercase">The New York City Events Map ARG</p>

        {phase === 'idle' && (
          <button
            onClick={handleEnter}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            className="pointer-events-auto mt-12 px-12 py-4 font-black text-xl tracking-widest uppercase border-2 border-red-600 text-red-400"
            style={{
              background: btnHover ? 'rgba(40,0,0,0.9)' : 'rgba(20,0,0,0.8)',
              boxShadow: btnHover
                ? '0 0 40px rgba(255,0,0,0.7), 0 0 80px rgba(255,0,0,0.3), inset 0 0 30px rgba(255,0,0,0.15)'
                : '0 0 20px rgba(200,0,0,0.4), inset 0 0 20px rgba(200,0,0,0.1)',
              letterSpacing: '0.3em',
              transform: btnHover ? 'scale(1.06)' : 'scale(1)',
              color: btnHover ? '#fca5a5' : undefined,
              transition: 'all 0.3s ease',
            }}
          >
            ▶ ENTER
          </button>
        )}
      </div>

      {/* LEFT DOOR */}
      <div
        className="absolute top-0 left-0 h-full z-10"
        style={{
          width: '51%',
          background: 'linear-gradient(135deg, #1a0000 0%, #3a0000 40%, #1a0000 100%)',
          transform: doorsOpen ? 'translateX(-105%)' : 'translateX(0)',
          transition: 'transform 1.2s cubic-bezier(0.7,0,0.3,1)',
          clipPath: 'polygon(0 0, 100% 0, 93% 100%, 0 100%)',
          borderRight: '3px solid #8b0000',
          boxShadow: 'inset -20px 0 60px rgba(0,0,0,0.8), 4px 0 30px rgba(139,0,0,0.5)',
        }}
      >
        {[15, 35, 55, 75, 90].map((pct, i) => (
          <div key={i} className="absolute left-4 w-3 h-3 rounded-full bg-red-900 border border-red-700"
            style={{ top: `${pct}%` }} />
        ))}
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,0,0,0.1) 20px, rgba(255,0,0,0.1) 21px)' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-red-900/30 font-black text-9xl select-none" style={{ transform: 'rotate(-15deg)' }}>◀</div>
        </div>
      </div>

      {/* RIGHT DOOR */}
      <div
        className="absolute top-0 right-0 h-full z-10"
        style={{
          width: '51%',
          background: 'linear-gradient(225deg, #1a0000 0%, #3a0000 40%, #1a0000 100%)',
          transform: doorsOpen ? 'translateX(105%)' : 'translateX(0)',
          transition: 'transform 1.2s cubic-bezier(0.7,0,0.3,1)',
          clipPath: 'polygon(7% 0, 100% 0, 100% 100%, 0 100%)',
          borderLeft: '3px solid #8b0000',
          boxShadow: 'inset 20px 0 60px rgba(0,0,0,0.8), -4px 0 30px rgba(139,0,0,0.5)',
        }}
      >
        {[15, 35, 55, 75, 90].map((pct, i) => (
          <div key={i} className="absolute right-4 w-3 h-3 rounded-full bg-red-900 border border-red-700"
            style={{ top: `${pct}%` }} />
        ))}
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 20px, rgba(255,0,0,0.1) 20px, rgba(255,0,0,0.1) 21px)' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-red-900/30 font-black text-9xl select-none" style={{ transform: 'rotate(-15deg)' }}>▶</div>
        </div>
      </div>

      {/* Dark bg behind doors */}
      <div className="absolute inset-0 z-0" style={{ background: '#0d0000' }} />
    </div>
  );
}