import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ColorPicker from './ColorPicker';
import EmojiPicker from './EmojiPicker';
import { CURSOR_TRAILS, THEME_FIELDS, useSiteTheme, WINDOWS_CURSOR_PRESETS } from '../lib/theme';

function ThemeRow({ field, value, onChange, onReset }) {

  return (
    <div className="rounded-2xl border-3 border-black bg-white p-3 md:p-4 shadow-[4px_4px_0px_black]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-sm md:text-base leading-tight">{field.label}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ColorPicker value={value} onChange={onChange} />
          <button
            type="button"
            onClick={onReset}
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
  const {
    overrides,
    applyThemeOverrides,
    setPreviewThemeOverrides,
    clearPreviewThemeOverrides,
  } = useSiteTheme();
  const [draftOverrides, setDraftOverrides] = useState(() => ({ ...overrides }));
  const [isDesktopCursorCapable, setIsDesktopCursorCapable] = useState(false);

  function setDraftOverride(key, value) {
    setDraftOverrides((prev) => {
      const next = { ...prev };
      if (value == null || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function resetDraftKey(key) {
    setDraftOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleCancel() {
    clearPreviewThemeOverrides();
    onClose();
  }

  function handleApply() {
    applyThemeOverrides(draftOverrides);
    onClose();
  }

  function handleResetAll() {
    setDraftOverrides({});
  }

  useEffect(() => {
    setPreviewThemeOverrides(draftOverrides);
  }, [draftOverrides, setPreviewThemeOverrides]);

  function handleCursorImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDraftOverride('cursorType', 'image');
        setDraftOverride('cursorImageData', reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

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
      clearPreviewThemeOverrides();
    };
  }, [onClose, clearPreviewThemeOverrides]);

  useEffect(() => {
    function updateCapability() {
      setIsDesktopCursorCapable(window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth >= 768);
    }
    updateCapability();
    window.addEventListener('resize', updateCapability);
    return () => window.removeEventListener('resize', updateCapability);
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="lp-theme-scope fixed inset-0 z-[200000] overflow-y-auto bg-white/50 backdrop-blur-sm p-3 md:p-6">
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

          <div className="space-y-3 md:space-y-4 pb-4">
            {THEME_FIELDS.map((field) => (
              <ThemeRow
                key={field.key}
                field={field}
                value={draftOverrides[field.key] ?? null}
                onChange={(next) => setDraftOverride(field.key, next)}
                onReset={() => resetDraftKey(field.key)}
              />
            ))}

            <div className="rounded-2xl border-3 border-black bg-white p-3 md:p-4 shadow-[4px_4px_0px_black]">
              <p className="font-black text-sm md:text-base leading-tight">Cursor (Web Only)</p>
              {!isDesktopCursorCapable ? (
                <p className="mt-2 text-xs font-bold text-gray-500">Cursor customization is available on desktop pointer devices only.</p>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { key: 'default', label: 'Standard' },
                      { key: 'windows', label: 'Windows' },
                      { key: 'emoji', label: 'Emoji' },
                      { key: 'image', label: 'Image' },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setDraftOverride('cursorType', opt.key)}
                        className={`px-2 py-2 rounded-xl border-2 text-xs font-black transition-colors ${((draftOverrides.cursorType || 'default') === opt.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {(draftOverrides.cursorType || 'default') === 'windows' && (
                    <div className="mt-3">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Windows Classic</p>
                      <div className="flex flex-wrap gap-2">
                        {WINDOWS_CURSOR_PRESETS.map((preset) => (
                          <button
                            key={preset.key}
                            type="button"
                            onClick={() => setDraftOverride('cursorPreset', preset.key)}
                            className={`px-2 py-1 rounded-lg border-2 text-[11px] font-black transition-colors ${((draftOverrides.cursorPreset || 'default') === preset.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(draftOverrides.cursorType || 'default') === 'emoji' && (
                    <div className="mt-3">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Emoji Cursor</p>
                      <EmojiPicker
                        value={draftOverrides.cursorEmoji || '✨'}
                        onChange={(next) => setDraftOverride('cursorEmoji', next || '✨')}
                        compact
                      />
                    </div>
                  )}

                  {(draftOverrides.cursorType || 'default') === 'image' && (
                    <div className="mt-3">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Upload Image Cursor</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleCursorImageUpload}
                        className="block w-full text-xs font-bold"
                      />
                    </div>
                  )}

                  {(draftOverrides.cursorType || 'default') !== 'default' && (
                    <>
                      <div className="mt-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">Cursor Size</p>
                          <span className="text-xs font-black">{Number(draftOverrides.cursorSize || 28)}px</span>
                        </div>
                        <input
                          type="range"
                          min="16"
                          max="72"
                          step="1"
                          value={Number(draftOverrides.cursorSize || 28)}
                          onChange={(e) => setDraftOverride('cursorSize', Number(e.target.value))}
                          className="w-full mt-2"
                        />
                      </div>

                      <div className="mt-4">
                        <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Cursor Trail</p>
                        <div className="flex flex-wrap gap-2">
                          {CURSOR_TRAILS.map((trail) => (
                            <button
                              key={trail.key}
                              type="button"
                              onClick={() => setDraftOverride('cursorTrail', trail.key)}
                              className={`px-2 py-1 rounded-lg border-2 text-[11px] font-black transition-colors ${((draftOverrides.cursorTrail || 'none') === trail.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                            >
                              {trail.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 pt-3 bg-[#FAFAF8] border-t-2 border-black flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleResetAll}
              className="px-3 py-2 rounded-xl border-3 border-black bg-white text-black text-xs md:text-sm font-black shadow-[3px_3px_0px_black] hover:bg-gray-100 transition-colors"
            >
              Reset All
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-2 rounded-xl border-3 border-black bg-white text-black text-xs md:text-sm font-black shadow-[3px_3px_0px_black] hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-3 py-2 rounded-xl border-3 border-black bg-[#7C3AED] text-white text-xs md:text-sm font-black shadow-[3px_3px_0px_black] hover:bg-[#6D28D9] transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
