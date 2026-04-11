import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'lapuff_theme_overrides';

const TEXT_CLARITY_NOTE = "Note: making these either brighter or darker than your other theme colors is the best way to preserve clarity";

export const THEME_FIELDS = [
  { key: 'accentColor', label: 'Selection Accent' },

  { key: '_sec_text', type: 'sectionLabel', label: 'Text Colors' },
  { key: 'titleTextColor', label: 'Title Text', note: TEXT_CLARITY_NOTE },
  { key: 'subtextColor', label: 'Subtext Color', note: TEXT_CLARITY_NOTE },
  { key: 'bodyTextColor', label: 'Body Text', note: TEXT_CLARITY_NOTE },

  { key: '_sec_buttons', type: 'sectionLabel', label: 'Buttons' },
  { key: 'buttonOutlineColor', label: 'Button Outline' },
  { key: 'buttonFillColor', label: 'Button Fill' },
  { key: 'buttonTextColor', label: 'Button Text', note: TEXT_CLARITY_NOTE },
  { key: 'buttonShadowColor', label: 'Button Shadow' },

  { key: '_sec_surfaces', type: 'sectionLabel', label: 'Surfaces & Backgrounds' },
  { key: 'pageBackgroundColor', label: 'Page Background' },
  { key: 'surfaceBackgroundColor', label: 'Section Fill' },
  { key: 'topBarFillColor', label: 'Top Bar Fill' },
  { key: 'topBarOutlineColor', label: 'Top Bar Outline' },

  { key: '_sec_icons', type: 'sectionLabel', label: 'Icons & Tiles' },
  { key: 'microIconColor', label: 'Micro Icons' },
  { key: 'tileShadowColor', label: 'Tile Shadow' },
  { key: 'tileAccentOverride', label: 'Tile Accent Override', subtitle: "Note: this will turn off other users' selected event tile colors" },
  { key: 'logoFillColor', label: 'Logo Fill' },
  { key: 'logoShadowColor', label: 'Logo Shadow' },

  { key: '_sec_emoji', type: 'sectionLabel', label: 'Emoji' },
  { key: 'emojiStainColor', label: 'Emoji Stain Override', subtitle: 'Note: this is an experimental override to stain the colors of all emojis' },

  { key: '_sec_search', type: 'sectionLabel', label: 'Search Bar' },
  { key: 'searchBarFillColor', label: 'Search Bar Fill' },
  { key: 'searchBarOutlineColor', label: 'Search Bar Outline' },
  { key: 'searchBarShadowColor', label: 'Search Bar Shadow' },
  { key: 'searchBarTextColor', label: 'Search Bar Text', note: TEXT_CLARITY_NOTE },

  { key: '_sec_leaderboard', type: 'sectionLabel', label: 'Leaderboard' },
  { key: 'leaderboardHeaderColor', label: 'Leaderboard Header' },
  { key: 'leaderboardHeaderTextColor', label: 'Leaderboard Header Text', note: TEXT_CLARITY_NOTE },
  { key: 'leaderboardBackgroundColor', label: 'Leaderboard Background' },
  { key: 'leaderboardTextColor', label: 'Leaderboard Text', note: TEXT_CLARITY_NOTE },
  { key: 'leaderboardFlameColor', label: 'Leaderboard Flames', subtitle: 'Reach top 50 to see this effect' },

  { key: '_sec_calendar', type: 'sectionLabel', label: 'Calendar' },
  { key: 'calendarBackgroundColor', label: 'Calendar Background' },
  { key: 'calendarDayBackgroundColor', label: 'Calendar Day Fill' },
  { key: 'calendarDayTextColor', label: 'Calendar Day Text', note: TEXT_CLARITY_NOTE },
];

export const WINDOWS_CURSOR_PRESETS = [
  { key: 'default', label: 'Arrow', css: 'default' },
  { key: 'pointer', label: 'Hand', css: 'pointer' },
  { key: 'crosshair', label: 'Crosshair', css: 'crosshair' },
  { key: 'text', label: 'I-Beam', css: 'text' },
  { key: 'wait', label: 'Wait', css: 'wait' },
  { key: 'help', label: 'Help', css: 'help' },
  { key: 'move', label: 'Move', css: 'move' },
  { key: 'cell', label: 'Cell', css: 'cell' },
  { key: 'not-allowed', label: 'Nope', css: 'not-allowed' },
  { key: 'grab', label: 'Grab', css: 'grab' },
  { key: 'zoom-in', label: 'Zoom In', css: 'zoom-in' },
  { key: 'zoom-out', label: 'Zoom Out', css: 'zoom-out' },
  { key: 'n-resize', label: 'N Resize', css: 'n-resize' },
  { key: 'e-resize', label: 'E Resize', css: 'e-resize' },
  { key: 'nwse-resize', label: 'NWSE', css: 'nwse-resize' },
  { key: 'nesw-resize', label: 'NESW', css: 'nesw-resize' },
  { key: 'copy', label: 'Copy', css: 'copy' },
  { key: 'alias', label: 'Alias', css: 'alias' },
  { key: 'progress', label: 'Progress', css: 'progress' },
];

export const CURSOR_TRAILS = [
  { key: 'none', label: 'None', group: '' },

  // ✨ Magical / Fantasy
  { key: 'fairy', label: '🧚 Fairy Dust', group: 'Magical' },
  { key: 'stardust', label: '⭐ Stardust', group: 'Magical' },
  { key: 'sparkstorm', label: '✦ Sparkstorm', group: 'Magical' },
  { key: 'rainbow', label: '🌈 Rainbow', group: 'Magical' },
  { key: 'sakura', label: '🌸 Sakura', group: 'Magical' },
  { key: 'snow', label: '❄️ Snowfall', group: 'Magical' },
  { key: 'witch', label: '🔮 Witch Smoke', group: 'Magical' },

  // 💕 Cute / Pop
  { key: 'hearts', label: '❤️ Love Hearts', group: 'Cute' },
  { key: 'kawaii', label: '✿ Kawaii', group: 'Cute' },
  { key: 'bubblegum', label: '🫧 Bubblegum', group: 'Cute' },
  { key: 'confetti', label: '🎊 Confetti', group: 'Cute' },
  { key: 'candy', label: '🍬 Candy', group: 'Cute' },

  // 🔥 Action / Power
  { key: 'flames', label: '🔥 Flames', group: 'Action' },
  { key: 'angry', label: '💥 Angry', group: 'Action' },
  { key: 'lightning', label: '⚡ Lightning', group: 'Action' },
  { key: 'laser', label: '🔴 Laser', group: 'Action' },
  { key: 'comet', label: '☄️ Comet', group: 'Action' },

  // 🤖 Sci-Fi / Tech
  { key: 'chromatic', label: '🔬 Chromatic', group: 'Sci-Fi' },
  { key: 'glitch', label: '👾 Glitch', group: 'Sci-Fi' },
  { key: 'matrix', label: '💚 Matrix', group: 'Sci-Fi' },
  { key: 'neon-blade', label: '🗡️ Neon Blade', group: 'Sci-Fi' },
  { key: 'plasma', label: '⚛️ Plasma', group: 'Sci-Fi' },
  { key: 'retro-net', label: '🕸 Retro Net', group: 'Sci-Fi' },
  { key: 'hologram', label: '📡 Hologram', group: 'Sci-Fi' },

  // 🌊 Ambient / Chill
  { key: 'ghost', label: '👻 Ghost', group: 'Ambient' },
  { key: 'echo', label: '○ Echo', group: 'Ambient' },
  { key: 'throb', label: '💜 Throb', group: 'Ambient' },
  { key: 'aero-glass', label: '🪟 Aero Glass', group: 'Ambient' },
  { key: 'vaporwave', label: '🌅 Vaporwave', group: 'Ambient' },
  { key: 'bubble', label: '◎ Bubbles', group: 'Ambient' },

  // 🖤 Goth / Dark
  { key: 'void', label: '⚫ Void', group: 'Goth' },
  { key: 'shadow', label: '🖤 Shadow', group: 'Goth' },
  { key: 'skull', label: '💀 Skull', group: 'Goth' },
  { key: 'blood', label: '🩸 Blood Drip', group: 'Goth' },
  { key: 'bats', label: '🦇 Bats', group: 'Goth' },
  { key: 'cobweb', label: '🕷️ Cobweb', group: 'Goth' },

  // 🧪 Weird / Nature / Horror
  { key: 'slime', label: '🟢 Slime', group: 'Weird' },
  { key: 'toxic', label: '☢️ Toxic Ooze', group: 'Weird' },
  { key: 'vortex', label: '🌀 Vortex', group: 'Weird' },
  { key: 'spider', label: '🕸️ Spider Silk', group: 'Weird' },
  { key: 'lava', label: '🌋 Lava', group: 'Weird' },
  { key: 'glitter', label: '💎 Glitter', group: 'Weird' },
];

export const DEFAULT_THEME = {
  accentColor: '#7C3AED',
  titleTextColor: '#000000',
  subtextColor: '#6B7280',
  bodyTextColor: '#374151',
  buttonOutlineColor: '#000000',
  buttonFillColor: '#FFFFFF',
  buttonTextColor: '#000000',
  buttonShadowColor: '#000000',
  pageBackgroundColor: '#FAFAF8',
  surfaceBackgroundColor: '#FFFFFF',
  topBarFillColor: '#FFFFFF',
  topBarOutlineColor: '#000000',
  microIconColor: '#000000',
  tileShadowColor: '#000000',
  tileAccentOverride: null,
  logoFillColor: '#000000',
  logoShadowColor: '#7C3AED',
  emojiStainColor: null,
  searchBarFillColor: '#FFFFFF',
  searchBarOutlineColor: '#000000',
  searchBarShadowColor: '#000000',
  searchBarTextColor: '#111827',
  leaderboardHeaderColor: '#7C3AED',
  leaderboardHeaderTextColor: '#FFFFFF',
  leaderboardBackgroundColor: '#FFFFFF',
  leaderboardTextColor: '#000000',
  leaderboardFlameColor: '#FF5A00',
  calendarBackgroundColor: '#FAFAF8',
  calendarDayBackgroundColor: '#F3F4F6',
  calendarDayTextColor: '#9CA3AF',
  cursorType: 'default',
  cursorPreset: 'default',
  cursorEmoji: '✨',
  cursorImageData: null,
  cursorSize: 28,
  cursorTrail: 'none',
  cursorColor: '#FFFFFF',
  cursorEffectColor: null,
  cursorOutlineEnabled: true,
  cursorOutlineColor: '#000000',
  cursorOutlineWidth: 1,
};

const ThemeContext = createContext(null);

function readStoredOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredOverrides(overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function hexToRgba(hex, alpha = 1) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  const normalized = hex.replace('#', '');
  if (![3, 6].includes(normalized.length)) return `rgba(0,0,0,${alpha})`;
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;
  const int = Number.parseInt(full, 16);
  const red = (int >> 16) & 255;
  const green = (int >> 8) & 255;
  const blue = int & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function getTileAccentColor(eventColor, resolvedTheme) {
  return resolvedTheme.tileAccentOverride || eventColor || resolvedTheme.accentColor;
}

function applyThemeToDocument(theme) {
  const root = document.documentElement;
  root.style.setProperty('--lp-accent', theme.accentColor);
  root.style.setProperty('--lp-accent-soft', hexToRgba(theme.accentColor, 0.14));
  root.style.setProperty('--lp-accent-softer', hexToRgba(theme.accentColor, 0.08));
  root.style.setProperty('--lp-title-text', theme.titleTextColor);
  root.style.setProperty('--lp-subtext', theme.subtextColor);
  root.style.setProperty('--lp-body-text', theme.bodyTextColor || '#374151');
  root.style.setProperty('--lp-button-outline', theme.buttonOutlineColor);
  root.style.setProperty('--lp-button-fill', theme.buttonFillColor);
  root.style.setProperty('--lp-button-text', theme.buttonTextColor || '#000000');
  root.style.setProperty('--lp-button-shadow', theme.buttonShadowColor || '#000000');
  root.style.setProperty('--lp-page-bg', theme.pageBackgroundColor);
  root.style.setProperty('--lp-surface-bg', theme.surfaceBackgroundColor);
  root.style.setProperty('--lp-topbar-fill', theme.topBarFillColor);
  root.style.setProperty('--lp-topbar-outline', theme.topBarOutlineColor);
  root.style.setProperty('--lp-micro-icon', theme.microIconColor);
  root.style.setProperty('--lp-tile-shadow', theme.tileShadowColor);
  root.style.setProperty('--lp-logo-fill', theme.logoFillColor);
  root.style.setProperty('--lp-logo-shadow', theme.logoShadowColor);
  root.style.setProperty('--lp-search-fill', theme.searchBarFillColor || '#FFFFFF');
  root.style.setProperty('--lp-search-outline', theme.searchBarOutlineColor || '#000000');
  root.style.setProperty('--lp-search-shadow', theme.searchBarShadowColor || '#000000');
  root.style.setProperty('--lp-search-text', theme.searchBarTextColor || '#111827');
  root.style.setProperty('--lp-leaderboard-header', theme.leaderboardHeaderColor);
  root.style.setProperty('--lp-leaderboard-header-text', theme.leaderboardHeaderTextColor);
  root.style.setProperty('--lp-leaderboard-bg', theme.leaderboardBackgroundColor);
  root.style.setProperty('--lp-leaderboard-text', theme.leaderboardTextColor);
  root.style.setProperty('--lp-leaderboard-flames', theme.leaderboardFlameColor);
  root.style.setProperty('--lp-leaderboard-flames-soft', hexToRgba(theme.leaderboardFlameColor, 0.38));
  root.style.setProperty('--lp-leaderboard-flames-mid', hexToRgba(theme.leaderboardFlameColor, 0.24));
  root.style.setProperty('--lp-leaderboard-flames-light', hexToRgba(theme.leaderboardFlameColor, 0.14));
  root.style.setProperty('--lp-calendar-bg', theme.calendarBackgroundColor);
  root.style.setProperty('--lp-calendar-day-bg', theme.calendarDayBackgroundColor);
  root.style.setProperty('--lp-calendar-day-text', theme.calendarDayTextColor);
  // Emoji stain: set/remove CSS var and html class
  if (theme.emojiStainColor) {
    root.style.setProperty('--lp-emoji-stain', theme.emojiStainColor);
    root.classList.add('lp-emoji-stain-active');
  } else {
    root.style.removeProperty('--lp-emoji-stain');
    root.classList.remove('lp-emoji-stain-active');
  }
}

export function ThemeProvider({ children }) {
  const [overrides, setOverrides] = useState(() => readStoredOverrides());
  const [previewOverrides, setPreviewOverrides] = useState(null);

  const resolvedTheme = useMemo(
    () => ({ ...DEFAULT_THEME, ...(previewOverrides ?? overrides) }),
    [overrides, previewOverrides]
  );

  useEffect(() => {
    writeStoredOverrides(overrides);
  }, [overrides]);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo(() => ({
    overrides,
    previewOverrides,
    resolvedTheme,
    applyThemeOverrides(nextOverrides) {
      if (!nextOverrides || typeof nextOverrides !== 'object') {
        setOverrides({});
        setPreviewOverrides(null);
        return;
      }

      const cleaned = {};
      Object.keys(nextOverrides).forEach((key) => {
        const value = nextOverrides[key];
        if (value == null || value === '' || value === DEFAULT_THEME[key]) return;
        cleaned[key] = value;
      });

      setOverrides(cleaned);
      setPreviewOverrides(null);
    },
    setPreviewThemeOverrides(nextOverrides) {
      if (!nextOverrides || typeof nextOverrides !== 'object') {
        setPreviewOverrides({});
        return;
      }

      const cleaned = {};
      Object.keys(nextOverrides).forEach((key) => {
        const value = nextOverrides[key];
        if (value == null || value === '' || value === DEFAULT_THEME[key]) return;
        cleaned[key] = value;
      });

      setPreviewOverrides(cleaned);
    },
    clearPreviewThemeOverrides() {
      setPreviewOverrides(null);
    },
    setThemeOverride(key, value) {
      setOverrides((prev) => {
        const next = { ...prev };
        if (value == null || value === '' || value === DEFAULT_THEME[key]) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    },
    resetThemeKey(key) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    resetAllTheme() {
      setOverrides({});
    },
  }), [overrides, previewOverrides, resolvedTheme]);

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useSiteTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useSiteTheme must be used inside ThemeProvider');
  return ctx;
}
