import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ColorPicker from './ColorPicker';
import EmojiPicker from './EmojiPicker';
import { CURSOR_TRAILS, THEME_FIELDS, useSiteTheme, WINDOWS_CURSOR_PRESETS } from '../lib/theme';

function ThemeRow({ field, value, onChange, onReset }) {
  return (
    <div className="group rounded-2xl border-3 border-black bg-white p-3 md:p-4 shadow-[4px_4px_0px_black]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="theme-row-label font-black text-sm md:text-base leading-tight text-black transition-none">
            {field.label}
          </p>
          {field.subtitle && (
            <p className="text-[10px] font-bold text-amber-600 mt-0.5 leading-tight">{field.subtitle}</p>
          )}
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
    resolvedTheme,
    applyThemeOverrides,
    setPreviewThemeOverrides,
    clearPreviewThemeOverrides,
  } = useSiteTheme();
  const [draftOverrides, setDraftOverrides] = useState(() => ({ ...overrides }));

  // Compute if section fill is dark to decide hover label color
  function hexLuminance(hex) {
    const h = hex?.replace('#', '') || 'ffffff';
    const r = parseInt(h.slice(0,2), 16) / 255;
    const g = parseInt(h.slice(2,4), 16) / 255;
    const b = parseInt(h.slice(4,6), 16) / 255;
    const toL = (c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * toL(r) + 0.7152 * toL(g) + 0.0722 * toL(b);
  }
  const sectionColor = draftOverrides.surfaceBackgroundColor ?? resolvedTheme?.surfaceBackgroundColor ?? '#FFFFFF';
  const isDarkSection = hexLuminance(sectionColor) < 0.35;
  const [isDesktopCursorCapable, setIsDesktopCursorCapable] = useState(false);
  const [cursorExpanded, setCursorExpanded] = useState(false);
  // All trail groups start collapsed
  const allGroups = [...new Set(CURSOR_TRAILS.filter((t) => t.group).map((t) => t.group))];
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set(allGroups));

  function toggleGroup(group) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

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

  const CURSOR_KEYS = ['cursorType', 'cursorPreset', 'cursorEmoji', 'cursorImageData', 'cursorSize', 'cursorTrail', 'cursorColor', 'cursorEffectColor', 'cursorOutlineEnabled', 'cursorOutlineColor', 'cursorOutlineWidth'];

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
      if (event.target.closest('[data-theme-modal-portal]')) return;
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

  const cursorType = draftOverrides.cursorType || 'default';
  const noneTrail = CURSOR_TRAILS.filter((t) => !t.group);
  const trailGroups = allGroups;

  return createPortal(
    <div className={`lp-theme-scope fixed inset-0 z-[200000] flex items-center justify-center bg-white/50 backdrop-blur-sm p-3 md:p-6${isDarkSection ? ' lp-dark-section' : ''}`}>
      <div
        ref={ref}
        className="relative w-full max-w-5xl rounded-[2rem] border-4 border-black bg-[#FAFAF8] shadow-[12px_12px_0px_black] animate-in fade-in zoom-in duration-200 flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 2rem)' }}
      >
        {/* ── Fixed header ── */}
        <div className="flex-shrink-0 px-5 md:px-7 pt-5 md:pt-7 pb-4">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full border-[2.5px] border-white bg-black text-white text-lg font-black flex items-center justify-center hover:bg-red-500 transition hover:invert"
            aria-label="Close customizer"
          >
            ✕
          </button>
          <h2 className="font-black text-xl md:text-3xl leading-none pr-10">Customize Your Experience</h2>
          <p className="mt-2 text-xs md:text-sm font-bold text-gray-500">Choose override colors for the non-map UI. Leave a swatch empty to use the default look.</p>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto px-5 md:px-7 pb-2">
          <div className="space-y-4 md:space-y-5">

            {/* ── Cursor Lab ── */}
            <div className="rounded-3xl border-3 border-black bg-gradient-to-br from-violet-50 via-fuchsia-50 to-cyan-50 shadow-[5px_5px_0px_black] overflow-hidden">
              <button
                type="button"
                onClick={() => setCursorExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-4 md:px-5 py-3 md:py-4 hover:bg-white/30 transition-colors"
              >
                <span className="font-black text-base md:text-lg leading-tight text-left">Cursor Lab (Web Only)</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {cursorExpanded && (
                    <span className="hidden md:inline lp-no-title text-[10px] md:text-xs font-black px-2 py-1 rounded-full bg-black text-white uppercase tracking-wide" style={{ color: '#fff' }}>Live Preview</span>
                  )}
                  <span className={`text-lg font-black transition-transform duration-200 ${cursorExpanded ? 'rotate-180' : ''}`}>⌄</span>
                </div>
              </button>

              {cursorExpanded && (
                <div className="px-4 md:px-5 pb-4 md:pb-5 pt-0 border-t-2 border-black/10">
                  <div className="hidden md:flex justify-end mb-3 pt-3">
                    <button
                      type="button"
                      onClick={resetCursorSettings}
                      className="text-[10px] md:text-xs font-black px-2 py-1 rounded-full border-2 border-black bg-white hover:bg-red-50 transition hover:invert"
                    >
                      ↶ Reset Cursor
                    </button>
                  </div>

                  {!isDesktopCursorCapable ? (
                    <p className="text-xs font-bold text-gray-700">Custom Cursor is only available on web pointer devices.</p>
                  ) : (
                    <>
                      {/* Cursor type selector */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                            className={`px-2 py-2 rounded-xl border-2 text-xs font-black transition-colors ${cursorType === opt.key ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {cursorType === 'windows' && (
                        <div className="mt-3">
                          <p className="text-[11px] font-black uppercase tracking-wide text-gray-700 mb-1.5">Windows Classic</p>
                          <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
                            {WINDOWS_CURSOR_PRESETS.map((preset) => (
                              <button
                                key={preset.key}
                                type="button"
                                onClick={() => setDraftOverride('cursorPreset', preset.key)}
                                className={`px-2 py-1.5 rounded-lg border-2 text-[11px] font-black transition-colors ${((draftOverrides.cursorPreset || 'default') === preset.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {cursorType === 'emoji' && (
                        <div className="mt-3">
                          <p className="text-[11px] font-black uppercase tracking-wide text-gray-700 mb-1">Emoji Cursor</p>
                          <EmojiPicker
                            value={draftOverrides.cursorEmoji || '✨'}
                            onChange={(next) => setDraftOverride('cursorEmoji', next || '✨')}
                            compact
                          />
                        </div>
                      )}

                      {cursorType === 'image' && (
                        <div className="mt-3">
                          <p className="text-[11px] font-black uppercase tracking-wide text-gray-700 mb-1">Upload Image Cursor</p>
                          <input type="file" accept="image/*" onChange={handleCursorImageUpload} className="block w-full text-xs font-bold" />
                        </div>
                      )}

                      {/* Size — hidden for standard/default cursor only */}
                      {cursorType !== 'default' && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-black uppercase tracking-wide text-gray-700">Cursor Size</p>
                          <span className="text-xs font-black">{Number(draftOverrides.cursorSize || 28)}px</span>
                        </div>
                        <input
                          type="range" min="8" max="180" step="1"
                          value={Number(draftOverrides.cursorSize || 28)}
                          onChange={(e) => setDraftOverride('cursorSize', Number(e.target.value))}
                          className="w-full mt-1.5"
                        />
                      </div>
                      )}

                      {/* Cursor Color, Effect Color, Outline — compact single row */}
                      <div className="mt-3">
                        <div className="flex items-end gap-2 flex-wrap">
                          {/* Cursor Color */}
                          {cursorType !== 'emoji' && cursorType !== 'image' && (
                            <div className="flex flex-col items-center gap-1">
                              <p className="text-[9px] font-black uppercase tracking-wide text-gray-700">Cursor</p>
                              <ColorPicker compact value={draftOverrides.cursorColor || '#FFFFFF'} onChange={(next) => setDraftOverride('cursorColor', next || '#FFFFFF')} />
                            </div>
                          )}
                          {/* Effect Color */}
                          <div className="flex flex-col items-center gap-1">
                            <p className="text-[9px] font-black uppercase tracking-wide text-gray-700">Effect</p>
                            <ColorPicker compact value={draftOverrides.cursorEffectColor || null} onChange={(next) => setDraftOverride('cursorEffectColor', next || null)} />
                          </div>
                          {/* Outline toggle + Outline color */}
                          <div className="flex flex-col items-center gap-1">
                            <p className="text-[9px] font-black uppercase tracking-wide text-gray-700">Outline</p>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setDraftOverride('cursorOutlineEnabled', !(draftOverrides.cursorOutlineEnabled ?? true))}
                                className={`w-9 h-9 rounded-xl border-2 text-[10px] font-black transition-colors ${(draftOverrides.cursorOutlineEnabled ?? true) ? 'bg-black text-white border-black' : 'bg-white text-gray-400 border-gray-300'}`}
                                title="Toggle cursor outline"
                              >
                                {(draftOverrides.cursorOutlineEnabled ?? true) ? 'ON' : 'OFF'}
                              </button>
                              {(draftOverrides.cursorOutlineEnabled ?? true) && (
                                <ColorPicker compact value={draftOverrides.cursorOutlineColor || '#000000'} onChange={(next) => setDraftOverride('cursorOutlineColor', next || '#000000')} />
                              )}
                            </div>
                          </div>
                          {/* Outline width */}
                          {(draftOverrides.cursorOutlineEnabled ?? true) && (
                            <div className="flex flex-col gap-1 flex-1 min-w-[80px]">
                              <div className="flex items-center justify-between">
                                <p className="text-[9px] font-black uppercase tracking-wide text-gray-700">Width</p>
                                <span className="text-[9px] font-black">
                                  {Number(draftOverrides.cursorOutlineWidth ?? 1) <= 1 ? 'Small' : Number(draftOverrides.cursorOutlineWidth ?? 1) <= 2 ? 'Medium' : 'Big'}
                                </span>
                              </div>
                              <input
                                type="range" min="1" max="3" step="1"
                                value={Number(draftOverrides.cursorOutlineWidth ?? 1)}
                                onChange={(e) => setDraftOverride('cursorOutlineWidth', Number(e.target.value))}
                                className="w-full"
                              />
                              <div className="flex justify-between text-[8px] text-gray-500 font-bold -mt-0.5">
                                <span>S</span><span>M</span><span>B</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Cursor Trail — collapsible groups */}
                      <div className="mt-3">
                        <p className="text-[11px] font-black uppercase tracking-wide text-gray-700 mb-1.5">Cursor Trail</p>
                        <div className="space-y-1.5">
                          {/* None button */}
                          <div className="flex flex-wrap gap-1.5">
                            {noneTrail.map((t) => (
                              <button key={t.key} type="button" onClick={() => setDraftOverride('cursorTrail', t.key)}
                                className={`px-3 py-1 rounded-lg border-2 text-[11px] font-black transition-colors ${((draftOverrides.cursorTrail || 'none') === t.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                              >{t.label}</button>
                            ))}
                          </div>
                          {/* Collapsible groups */}
                          {trailGroups.map((group) => {
                            const isOpen = !collapsedGroups.has(group);
                            return (
                              <div key={group} className="rounded-xl border border-black/10 bg-white/60 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group)}
                                  className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-white/80 transition-colors"
                                >
                                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">{group}</span>
                                  <span className={`text-gray-600 text-xs font-black transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}>⌄</span>
                                </button>
                                {isOpen && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 px-2.5 pb-2">
                                    {CURSOR_TRAILS.filter((t) => t.group === group).map((t) => (
                                      <button key={t.key} type="button" onClick={() => setDraftOverride('cursorTrail', t.key)}
                                        className={`px-2 py-1 rounded-lg border-2 text-[11px] font-black transition-colors ${((draftOverrides.cursorTrail || 'none') === t.key) ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-black hover:bg-violet-50'}`}
                                      >{t.label}</button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Theme color rows ── */}
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
        </div>

        {/* ── Fixed footer ── */}
        <div className="flex-shrink-0 px-5 md:px-7 py-3 bg-[#FAFAF8] border-t-2 border-black rounded-b-[2rem] flex items-center justify-end gap-2">
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
    </div>,
    document.body
  );
}
