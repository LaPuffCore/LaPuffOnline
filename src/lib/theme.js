import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'lapuff_theme_overrides';

export const THEME_FIELDS = [
  { key: 'accentColor', label: 'Accent' },
  { key: 'buttonOutlineColor', label: 'Button Outline' },
  { key: 'buttonFillColor', label: 'Button Fill' },
  { key: 'pageBackgroundColor', label: 'Page Background' },
  { key: 'surfaceBackgroundColor', label: 'Section Fill' },
  { key: 'microIconColor', label: 'Micro Icons' },
  { key: 'tileShadowColor', label: 'Tile Shadow' },
  { key: 'tileAccentOverride', label: 'Tile Accent' },
  { key: 'logoFillColor', label: 'Logo Fill' },
  { key: 'logoShadowColor', label: 'Logo Shadow' },
  { key: 'leaderboardHeaderColor', label: 'Board Header' },
  { key: 'leaderboardHeaderTextColor', label: 'Board Header Text' },
  { key: 'leaderboardBackgroundColor', label: 'Board Background' },
  { key: 'leaderboardTextColor', label: 'Board Text' },
  { key: 'leaderboardFlameColor', label: 'Board Flames' },
  { key: 'calendarBackgroundColor', label: 'Calendar Background' },
  { key: 'calendarDayBackgroundColor', label: 'Calendar Day Fill' },
  { key: 'calendarDayTextColor', label: 'Calendar Day Text' },
];

export const DEFAULT_THEME = {
  accentColor: '#7C3AED',
  buttonOutlineColor: '#000000',
  buttonFillColor: '#FFFFFF',
  pageBackgroundColor: '#FAFAF8',
  surfaceBackgroundColor: '#FFFFFF',
  microIconColor: '#000000',
  tileShadowColor: '#000000',
  tileAccentOverride: null,
  logoFillColor: '#000000',
  logoShadowColor: '#7C3AED',
  leaderboardHeaderColor: '#7C3AED',
  leaderboardHeaderTextColor: '#FFFFFF',
  leaderboardBackgroundColor: '#FFFFFF',
  leaderboardTextColor: '#000000',
  leaderboardFlameColor: '#FF5A00',
  calendarBackgroundColor: '#FAFAF8',
  calendarDayBackgroundColor: '#F3F4F6',
  calendarDayTextColor: '#9CA3AF',
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
  root.style.setProperty('--lp-button-outline', theme.buttonOutlineColor);
  root.style.setProperty('--lp-button-fill', theme.buttonFillColor);
  root.style.setProperty('--lp-page-bg', theme.pageBackgroundColor);
  root.style.setProperty('--lp-surface-bg', theme.surfaceBackgroundColor);
  root.style.setProperty('--lp-micro-icon', theme.microIconColor);
  root.style.setProperty('--lp-tile-shadow', theme.tileShadowColor);
  root.style.setProperty('--lp-logo-fill', theme.logoFillColor);
  root.style.setProperty('--lp-logo-shadow', theme.logoShadowColor);
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
}

export function ThemeProvider({ children }) {
  const [overrides, setOverrides] = useState(() => readStoredOverrides());

  const resolvedTheme = useMemo(
    () => ({ ...DEFAULT_THEME, ...overrides }),
    [overrides]
  );

  useEffect(() => {
    writeStoredOverrides(overrides);
  }, [overrides]);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo(() => ({
    overrides,
    resolvedTheme,
    applyThemeOverrides(nextOverrides) {
      if (!nextOverrides || typeof nextOverrides !== 'object') {
        setOverrides({});
        return;
      }

      const cleaned = {};
      Object.keys(nextOverrides).forEach((key) => {
        const value = nextOverrides[key];
        if (value == null || value === '' || value === DEFAULT_THEME[key]) return;
        cleaned[key] = value;
      });

      setOverrides(cleaned);
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
  }), [overrides, resolvedTheme]);

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useSiteTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useSiteTheme must be used inside ThemeProvider');
  return ctx;
}
