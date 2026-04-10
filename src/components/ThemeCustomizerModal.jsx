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
            className="w-11 h-11 rounded-2xl border-3 border-black bg-white shadow-[3px_3px_0px_black] hover:bg-gray-50 transition hover:invert flex items-center justify-center text-lg font-black"
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

  const CURSOR_KEYS = ['cursorType', 'cursorPreset', 'cursorEmoji', 'cursorImageData', 'cursorSize', 'cursorTrail', 'cursorColor', 'cursorEffectColor'];

  function resetCursorSettings() {
    setDraftOverrides((prev) => {
      const next = { ...prev };
      CURSOR_KEYS.forEach((key) => delete next[key]);
      return next;
    });
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
          className="relative w-full max-w-5xl rounded-[2rem] border-4 border-black bg-[#FAFAF8] p-5 md:p-7 shadow-[12px_12px_0px_black] animate-in fade-in zoom-in duration-200"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full border-[2.5px] border-white bg-black text-white text-lg font-black flex items-center justify-center hover:bg-red-500 transition hover:invert"
            aria-label="Close customizer"
          >
            ✕
          </button>

          <div className="mb-6 md:mb-7 pr-10">
            <h2 className="font-black text-xl md:text-3xl leading-none">Customize Your Experience</h2>
            <p className="mt-2 text-xs md:text-sm font-bold text-gray-500">Choose override colors for the non-map UI. Leave a swatch empty to use the default look.</p>
          </div>

          <div className="space-y-4 md:space-y-5 pb-5">
            <div className="rounded-3xl border-3 border-black bg-gradient-to-br from-violet-50 via-fuchsia-50 to-cyan-50 p-4 md:p-5 shadow-[5px_5px_0px_black]">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="font-black text-base md:text-lg leading-tight">Cursor Lab (Web Only)</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetCursorSettings}
                    className="text-[10px] md:text-xs font-black px-2 py-1 rounded-full border-2 border-black bg-white hover:bg-red-50 transition hover:invert"
                    title="Reset all cursor settings"
                  >
                    ↶ Reset Cursor
                  </button>
                  <span className="text-[10px] md:text-xs font-black px-2 py-1 rounded-full bg-black text-white uppercase tracking-wide">Live Preview</span>
                </div>
              </div>
              {!isDesktopCursorCapable ? (
                <p className="mt-2 text-xs font-bold text-gray-500">Custom Cursor is only available on web pointer devices.</p>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2.5">
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
                        className={`px-2 py-2 rounded-xl border-2 text-xs font-black transition hover:invert ${((draftOverrides.cursorType || 'default') === opt.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {(draftOverrides.cursorType || 'default') === 'windows' && (
                    <div className="mt-4">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Windows Classic</p>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {WINDOWS_CURSOR_PRESETS.map((preset) => (
                          <button
                            key={preset.key}
                            type="button"
                            onClick={() => setDraftOverride('cursorPreset', preset.key)}
                            className={`px-2 py-1.5 rounded-lg border-2 text-[11px] font-black transition hover:invert ${((draftOverrides.cursorPreset || 'default') === preset.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(draftOverrides.cursorType || 'default') === 'emoji' && (
                    <div className="mt-4">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Emoji Cursor</p>
                      <EmojiPicker
                        value={draftOverrides.cursorEmoji || '✨'}
                        onChange={(next) => setDraftOverride('cursorEmoji', next || '✨')}
                        compact
                      />
                    </div>
                  )}

                  {(draftOverrides.cursorType || 'default') === 'image' && (
                    <div className="mt-4">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Upload Image Cursor</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleCursorImageUpload}
                        className="block w-full text-xs font-bold"
                      />
                    </div>
                  )}

                  {/* Size, color, effect, and trail — visible for ALL cursor types */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">Cursor Size</p>
                      <span className="text-xs font-black">{Number(draftOverrides.cursorSize || 28)}px</span>
                    </div>
                    <input
                      type="range"
                      min="8"
                      max="180"
                      step="1"
                      value={Number(draftOverrides.cursorSize || 28)}
                      onChange={(e) => setDraftOverride('cursorSize', Number(e.target.value))}
                      className="w-full mt-2"
                    />
                  </div>

                  {(draftOverrides.cursorType || 'default') !== 'emoji' && (draftOverrides.cursorType || 'default') !== 'image' && (
                    <div className="mt-4">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-1">Cursor Color</p>
                      <ColorPicker
                        value={draftOverrides.cursorColor || '#FFFFFF'}
                        onChange={(next) => setDraftOverride('cursorColor', next || '#FFFFFF')}
                      />
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">Effect Color</p>
                      <button
                        type="button"
                        onClick={() => resetDraftKey('cursorEffectColor')}
                        className="px-2 py-1 rounded-md border-2 border-black bg-white text-[10px] font-black hover:bg-gray-100 transition hover:invert"
                      >
                        Default
                      </button>
                    </div>
                    <ColorPicker
                      value={draftOverrides.cursorEffectColor || null}
                      onChange={(next) => setDraftOverride('cursorEffectColor', next || null)}
                    />
                  </div>

                  <div className="mt-4">
                    <p className="text-[11px] font-black uppercase tracking-wide text-gray-500 mb-2">Cursor Trail</p>
                    {(() => {
                      const noneTrail = CURSOR_TRAILS.filter((t) => !t.group);
                      const groups = [...new Set(CURSOR_TRAILS.filter((t) => t.group).map((t) => t.group))];
                      return (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {noneTrail.map((t) => (
                              <button key={t.key} type="button" onClick={() => setDraftOverride('cursorTrail', t.key)} className={`px-2.5 py-1 rounded-lg border-2 text-[11px] font-black transition hover:invert ${((draftOverrides.cursorTrail || 'none') === t.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}>{t.label}</button>
                            ))}
                          </div>
                          {groups.map((group) => (
                            <div key={group}>
                              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{group}</p>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                                {CURSOR_TRAILS.filter((t) => t.group === group).map((t) => (
                                  <button key={t.key} type="button" onClick={() => setDraftOverride('cursorTrail', t.key)} className={`px-2 py-1 rounded-lg border-2 text-[11px] font-black transition hover:invert ${((draftOverrides.cursorTrail || 'none') === t.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}>{t.label}</button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>

            {THEME_FIELDS.map((field) => (
              <ThemeRow
                key={field.key}
                field={field}
                value={draftOverrides[field.key] ?? null}
                onChange={(next) => setDraftOverride(field.key, next)}
                onReset={() => resetDraftKey(field.key)}
              />
            ))}
          </div>

          <div className="sticky bottom-0 pt-3 bg-[#FAFAF8] border-t-2 border-black flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleResetAll}
              className="px-3 py-2 rounded-xl border-3 border-black bg-white text-black text-xs md:text-sm font-black shadow-[3px_3px_0px_black] hover:bg-gray-100 transition hover:invert"
            >
              Reset All
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-2 rounded-xl border-3 border-black bg-white text-black text-xs md:text-sm font-black shadow-[3px_3px_0px_black] hover:bg-gray-100 transition hover:invert"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-3 py-2 rounded-xl border-3 border-black bg-[#7C3AED] text-white text-xs md:text-sm font-black shadow-[3px_3px_0px_black] hover:bg-[#6D28D9] transition hover:invert"
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
