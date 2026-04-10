import { useEffect, useRef } from 'react';
import ColorPicker from './ColorPicker';
import { THEME_FIELDS, useSiteTheme } from '../lib/theme';

function ThemeRow({ field }) {
  const { overrides, setThemeOverride, resetThemeKey } = useSiteTheme();
  const value = overrides[field.key] ?? null;

  return (
    <div className="rounded-2xl border-3 border-black bg-white p-3 md:p-4 shadow-[4px_4px_0px_black]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-sm md:text-base leading-tight">{field.label}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ColorPicker value={value} onChange={(next) => setThemeOverride(field.key, next)} />
          <button
            type="button"
            onClick={() => resetThemeKey(field.key)}
            className="w-11 h-11 rounded-2xl border-3 border-black bg-white shadow-[3px_3px_0px_black] hover:bg-gray-50 transition-colors flex items-center justify-center text-lg font-black"
            aria-label={`Reset ${field.label}`}
            title={`Reset ${field.label}`}
          >
            ↶
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ThemeCustomizerModal({ onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape') onClose();
    }
    function handleClick(event) {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    }

    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto bg-white/50 backdrop-blur-sm p-3 md:p-6">
      <div className="min-h-full flex items-start justify-center">
        <div
          ref={ref}
          className="relative w-full max-w-3xl rounded-[2rem] border-4 border-black bg-[#FAFAF8] p-4 md:p-6 shadow-[12px_12px_0px_black] animate-in fade-in zoom-in duration-200"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full border-[2.5px] border-white bg-black text-white text-lg font-black flex items-center justify-center hover:bg-red-500 transition-colors"
            aria-label="Close customizer"
          >
            ✕
          </button>

          <div className="mb-5 md:mb-6 pr-10">
            <h2 className="font-black text-xl md:text-3xl leading-none">Customize Your Experience</h2>
            <p className="mt-2 text-xs md:text-sm font-bold text-gray-500">Choose override colors for the non-map UI. Leave a swatch empty to use the default look.</p>
          </div>

          <div className="space-y-3 md:space-y-4">
            {THEME_FIELDS.map((field) => (
              <ThemeRow key={field.key} field={field} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
