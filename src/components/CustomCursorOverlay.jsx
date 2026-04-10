import { useEffect, useMemo, useState } from 'react';
import { useSiteTheme, WINDOWS_CURSOR_PRESETS } from '../lib/theme';

function supportsCustomCursor() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth >= 768;
}

function trailStyle(trail, index, size) {
  const fade = Math.max(0.12, 1 - index * 0.1);
  const scale = Math.max(0.3, 1 - index * 0.06);
  const base = {
    width: Math.max(6, Math.round(size * 0.34)),
    height: Math.max(6, Math.round(size * 0.34)),
    opacity: fade,
    transform: `translate(-50%, -50%) scale(${scale})`,
  };

  if (trail === 'ghost') {
    return { ...base, border: '1px solid rgba(255,255,255,0.55)', borderRadius: '9999px', background: 'rgba(255,255,255,0.08)' };
  }
  if (trail === 'echo') {
    return { ...base, border: '2px solid rgba(124,58,237,0.6)', borderRadius: '9999px' };
  }
  if (trail === 'glitch') {
    return { ...base, borderRadius: '2px', background: index % 2 ? 'rgba(255,60,60,0.55)' : 'rgba(60,220,255,0.55)' };
  }
  if (trail === 'throb') {
    return { ...base, borderRadius: '9999px', background: 'rgba(255,255,255,0.42)' };
  }
  if (trail === 'chromatic') {
    return { ...base, borderRadius: '9999px', background: index % 3 === 0 ? 'rgba(255,0,90,0.45)' : index % 3 === 1 ? 'rgba(0,255,220,0.45)' : 'rgba(255,190,0,0.45)' };
  }
  if (trail === 'angry') {
    return { ...base, borderRadius: '4px', background: 'rgba(255,45,45,0.68)' };
  }
  if (trail === 'hearts') {
    return { ...base, borderRadius: '0px', background: 'transparent' };
  }
  return base;
}

export default function CustomCursorOverlay() {
  const { resolvedTheme } = useSiteTheme();
  const [active, setActive] = useState(() => supportsCustomCursor());
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [trailPoints, setTrailPoints] = useState([]);

  const isDefault = resolvedTheme.cursorType === 'default';
  const showEmoji = resolvedTheme.cursorType === 'emoji';
  const showImage = resolvedTheme.cursorType === 'image' && !!resolvedTheme.cursorImageData;
  const showWindows = resolvedTheme.cursorType === 'windows';

  const windowsCssCursor = useMemo(() => {
    const preset = WINDOWS_CURSOR_PRESETS.find((p) => p.key === resolvedTheme.cursorPreset);
    return preset?.css || 'default';
  }, [resolvedTheme.cursorPreset]);

  const trailEnabled = active && !isDefault && resolvedTheme.cursorTrail !== 'none';
  const customGlyphEnabled = active && (showEmoji || showImage);

  useEffect(() => {
    function handleResize() {
      setActive(supportsCustomCursor());
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!active) return;

    function onMove(event) {
      const next = { x: event.clientX, y: event.clientY, t: Date.now() };
      setPos(next);
      if (trailEnabled) {
        setTrailPoints((prev) => [next, ...prev].slice(0, 12));
      }
    }

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [active, trailEnabled]);

  useEffect(() => {
    if (!active) {
      document.documentElement.style.cursor = '';
      return;
    }

    if (isDefault) {
      document.documentElement.style.cursor = '';
    } else if (showWindows) {
      document.documentElement.style.cursor = windowsCssCursor;
    } else {
      document.documentElement.style.cursor = 'none';
    }

    return () => {
      document.documentElement.style.cursor = '';
    };
  }, [active, isDefault, showWindows, windowsCssCursor]);

  if (!active || isDefault) return null;

  const glyphSize = Math.max(16, Number(resolvedTheme.cursorSize || 28));

  return (
    <div className="pointer-events-none fixed inset-0 z-[2147483647]">
      {trailEnabled && trailPoints.map((point, idx) => {
        const style = trailStyle(resolvedTheme.cursorTrail, idx, glyphSize);
        if (resolvedTheme.cursorTrail === 'hearts') {
          return (
            <div
              key={`${point.t}-${idx}`}
              style={{
                position: 'fixed',
                left: point.x,
                top: point.y,
                transform: style.transform,
                opacity: style.opacity,
                fontSize: Math.max(10, Math.round(glyphSize * 0.36)),
                color: idx % 2 ? '#ff4d7a' : '#ff99b8',
              }}
            >
              ❤
            </div>
          );
        }

        return (
          <div
            key={`${point.t}-${idx}`}
            style={{
              position: 'fixed',
              left: point.x,
              top: point.y,
              ...style,
            }}
          />
        );
      })}

      {customGlyphEnabled && (
        <div
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, -50%)',
            width: glyphSize,
            height: glyphSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            filter: resolvedTheme.cursorTrail === 'glitch' ? 'drop-shadow(1px 0 #ff3366) drop-shadow(-1px 0 #33e6ff)' : 'none',
          }}
        >
          {showEmoji ? (
            <span style={{ fontSize: glyphSize, lineHeight: 1 }}>{resolvedTheme.cursorEmoji || '✨'}</span>
          ) : (
            <img
              src={resolvedTheme.cursorImageData}
              alt="cursor"
              style={{ width: glyphSize, height: glyphSize, objectFit: 'contain' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
