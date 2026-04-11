import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const PRESET_COLORS = [
  '#FF6B6B', '#FF6B9D', '#FF9100', '#FFD700', '#00C851',
  '#00BCD4', '#6C63FF', '#FF1744', '#E91E63', '#9C27B0',
  '#2196F3', '#00BFA5', '#FF5722', '#795548', '#607D8B',
  '#FFEB3B', '#8BC34A', '#03A9F4', '#FF4081', '#7C4DFF',
];

export default function ColorPicker({ value, onChange, compact = false }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value || '#FF6B6B');
  const [panelStyle, setPanelStyle] = useState(null);
  const wrapperRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (value) setCustom(value);
  }, [value]);

  useEffect(() => {
    function handleClick(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target) && !panelRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClick);
    } else {
      setPanelStyle(null);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useLayoutEffect(() => {
    function updatePosition() {
      if (!open || !wrapperRef.current || !panelRef.current) return;
      const triggerRect = wrapperRef.current.getBoundingClientRect();
      const panelRect = panelRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const left = Math.min(
        Math.max(8, triggerRect.right - panelRect.width),
        viewportWidth - panelRect.width - 8
      );
      const preferredTop = triggerRect.bottom + 8;
      const top = preferredTop + panelRect.height > viewportHeight - 8
        ? Math.max(8, triggerRect.top - panelRect.height - 8)
        : preferredTop;

      setPanelStyle({ left: `${left}px`, top: `${top}px`, visibility: 'visible' });
    }

    updatePosition();
    if (open) {
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
    }

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const swatchStyle = value
    ? { backgroundColor: value }
    : {
        backgroundImage: 'linear-gradient(45deg, #ececec 25%, transparent 25%), linear-gradient(-45deg, #ececec 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ececec 75%), linear-gradient(-45deg, transparent 75%, #ececec 75%)',
        backgroundSize: '14px 14px',
        backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0px',
        backgroundColor: '#fafafa',
      };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`${compact ? 'w-9 h-9' : 'w-11 h-11 md:w-14 md:h-14'} rounded-2xl border-3 border-black shadow-[3px_3px_0px_black] hover:scale-105 transition-transform overflow-hidden`}
        style={swatchStyle}
        aria-label="Choose a color"
      />
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999999] bg-white border-3 border-black rounded-3xl shadow-[5px_5px_0px_black] p-4 w-[min(16rem,calc(100vw-1rem))]"
          style={panelStyle || { top: 8, left: 8, visibility: 'hidden' }}
        >
          <p className="text-xs font-black mb-2 uppercase">Pick a color</p>
          <div className="grid grid-cols-5 gap-2 mb-3">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => { onChange(color); setOpen(false); }}
                className={`w-9 h-9 rounded-xl border-2 hover:scale-110 transition-transform ${value === color ? 'border-black border-3' : 'border-gray-300'}`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              className="w-10 h-10 rounded-lg border-2 border-black cursor-pointer"
            />
            <input
              type="text"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              className="flex-1 border-2 border-black rounded-xl px-2 py-1 text-sm font-mono min-w-0"
              maxLength={7}
            />
            <button
              type="button"
              onClick={() => { onChange(custom); setOpen(false); }}
              className="bg-black text-white text-xs font-black px-3 py-1 rounded-xl"
            >
              OK
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}