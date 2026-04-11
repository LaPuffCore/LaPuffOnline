import { useEffect, useMemo, useRef, useState } from 'react';
import { useSiteTheme } from '../lib/theme';

const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[data-clickable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const WINDOWS_GLYPHS = {
  default: '➤',
  pointer: '☞',
  crosshair: '⌖',
  text: 'I',
  wait: '⏳',
  help: '?',
  move: '✥',
  cell: '⊕',
  'not-allowed': '⊘',
  grab: '✊',
  'zoom-in': '⊕',
  'zoom-out': '⊖',
  'n-resize': '↕',
  'e-resize': '↔',
  'nwse-resize': '⤡',
  'nesw-resize': '⤢',
  copy: '⎘',
  alias: '↪',
  progress: '◔',
};

const KAWAII_SYMBOLS = ['✿', '☆', '♡', '★', '✦', '◌'];
const STARDUST_SYMBOLS = ['✦', '✧', '⋆', '✩', '★', '·'];
const SNOW_SYMBOLS = ['❄', '❅', '✼', '✻', '✦'];
const SKULL_SYMBOLS = ['☠', '☠', '✦', '⊹', '☠'];
const LIGHTNING_SYMBOLS = ['⚡', '✦', '⚡', '⋆', '⚡'];
const BATS_SYMBOLS = ['🦇', '🦇', '✦', '🦇'];
const CANDY_SYMBOLS = ['★', '✦', '✿', '♦', '✩'];

function supportsCustomCursor() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth >= 768;
}

function withAlpha(hex, alpha = 1) {
  if (!hex) return `rgba(255,255,255,${alpha})`;
  const normalized = hex.replace('#', '');
  if (![3, 6].includes(normalized.length)) return `rgba(255,255,255,${alpha})`;
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;
  const int = Number.parseInt(full, 16);
  const red = (int >> 16) & 255;
  const green = (int >> 8) & 255;
  const blue = int & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function resolveEffectColor(mode, cursorColor, effectColor) {
  if (effectColor) return effectColor;
  const defaults = {
    flames:      '#ff5a00',
    hearts:      '#ff67a3',
    matrix:      '#59ff98',
    chromatic:   '#30e8ff',
    angry:       '#ff2a2a',
    vaporwave:   '#ff4de4',
    'aero-glass':'#67d7ff',
    'retro-net': '#00f6ff',
    slime:       '#4eff8a',
    blood:       '#cc0020',
    kawaii:      '#ff85c2',
    bubblegum:   '#ff85c8',
    candy:       '#ff6bac',
    stardust:    '#ffd700',
    sakura:      '#ffb3d1',
    snow:        '#a8d8ff',
    rainbow:     '#ff6b6b',
    fairy:       '#ffd700',
    confetti:    '#ff4757',
    skull:       '#c8c8e8',
    shadow:      '#6600aa',
    witch:       '#9900cc',
    lightning:   '#ffe040',
    laser:       '#ff2020',
    'neon-blade':'#ff00cc',
    hologram:    '#00f5ff',
    toxic:       '#88ff00',
    spider:      '#c0c0d0',
    cobweb:      '#c0c0d0',
    lava:        '#ff4400',
    glitter:     '#ffd700',
    bats:        '#8800cc',
    bubble:      '#80c8ff',
  };
  return defaults[mode] || cursorColor || '#ffffff';
}

function makeBurst(mode, x, y, color, count = 16) {
  const now = Date.now();
  const symbolFns = {
    hearts:      () => Math.random() > 0.3 ? '❤' : '❥',
    glitch:      () => Math.random() > 0.5 ? '▣' : '▤',
    flames:      () => Math.random() > 0.5 ? '🔥' : '✦',
    angry:       () => Math.random() > 0.5 ? '✹' : '💥',
    matrix:      () => String(Math.floor(Math.random() * 10)),
    sparkstorm:  () => Math.random() > 0.5 ? '✶' : '✷',
    void:        () => Math.random() > 0.5 ? '◉' : '◎',
    vortex:      () => Math.random() > 0.5 ? '⟳' : '⟲',
    plasma:      () => Math.random() > 0.5 ? '⬢' : '⬡',
    'aero-glass':() => Math.random() > 0.5 ? '◌' : '◍',
    vaporwave:   () => Math.random() > 0.5 ? '✦' : '✧',
    'retro-net': () => Math.random() > 0.5 ? '⌁' : '◈',
    kawaii:      () => KAWAII_SYMBOLS[Math.floor(Math.random() * KAWAII_SYMBOLS.length)],
    bubblegum:   () => Math.random() > 0.5 ? '◎' : '○',
    candy:       () => CANDY_SYMBOLS[Math.floor(Math.random() * CANDY_SYMBOLS.length)],
    stardust:    () => STARDUST_SYMBOLS[Math.floor(Math.random() * STARDUST_SYMBOLS.length)],
    sakura:      () => Math.random() > 0.4 ? '🌸' : '✿',
    snow:        () => SNOW_SYMBOLS[Math.floor(Math.random() * SNOW_SYMBOLS.length)],
    rainbow:     () => ['★', '♦', '●', '✦'][Math.floor(Math.random() * 4)],
    fairy:       () => ['✨', '⭐', '✦', '✧'][Math.floor(Math.random() * 4)],
    confetti:    () => ['♦', '●', '■', '▲'][Math.floor(Math.random() * 4)],
    skull:       () => Math.random() > 0.5 ? '☠' : '✦',
    shadow:      () => Math.random() > 0.5 ? '◉' : '●',
    witch:       () => Math.random() > 0.5 ? '★' : '✦',
    slime:       () => Math.random() > 0.5 ? '◎' : '●',
    blood:       () => Math.random() > 0.5 ? '◆' : '●',
    lightning:   () => Math.random() > 0.5 ? '⚡' : '✦',
    laser:       () => Math.random() > 0.5 ? '·' : '•',
    'neon-blade':() => Math.random() > 0.5 ? '◈' : '⬥',
    hologram:    () => Math.random() > 0.5 ? '◈' : '⬡',
    toxic:       () => Math.random() > 0.5 ? '●' : '◎',
    spider:      () => '·',
    cobweb:      () => Math.random() > 0.5 ? '⌁' : '·',
    lava:        () => Math.random() > 0.5 ? '🔥' : '●',
    glitter:     () => ['✦', '✧', '⭐', '★'][Math.floor(Math.random() * 4)],
    bats:        () => BATS_SYMBOLS[Math.floor(Math.random() * BATS_SYMBOLS.length)],
    bubble:      () => Math.random() > 0.5 ? '○' : '◌',
    ghost:       () => Math.random() > 0.5 ? '○' : '◌',
    comet:       () => '·',
  };

  return Array.from({ length: count }, (_, i) => {
    const a = (Math.PI * 2 * i) / count;
    const speed = 1.8 + Math.random() * 3.8;
    const life = 26 + Math.floor(Math.random() * 18);
    const getSymbol = symbolFns[mode];
    const symbol = getSymbol ? getSymbol() : '•';

    let burstColor = color;
    if (mode === 'confetti') {
      const cc = ['#ff4757', '#ffd700', '#2ed573', '#1e90ff', '#ff6b81', '#eccc68', '#ff6348', '#7bed9f'];
      burstColor = cc[Math.floor(Math.random() * cc.length)];
    } else if (mode === 'rainbow') {
      burstColor = `hsl(${Math.floor(Math.random() * 360)}, 90%, 62%)`;
    } else if (mode === 'kawaii') {
      const kc = ['#ffb3de', '#b3d4ff', '#fffe9e', '#b3ffdb', '#e0b3ff'];
      burstColor = kc[Math.floor(Math.random() * kc.length)];
    } else if (mode === 'candy') {
      const dc = ['#ff6bac', '#ffcc00', '#5bdcff', '#a380ff', '#ff8c42'];
      burstColor = dc[Math.floor(Math.random() * dc.length)];
    } else if (mode === 'glitter') {
      const gc = ['#ffd700', '#ff99ff', '#99ffee', '#ffcc00'];
      burstColor = gc[Math.floor(Math.random() * gc.length)];
    }

    return {
      id: `${now}-${i}-${Math.random().toString(16).slice(2)}`,
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life,
      maxLife: life,
      symbol,
      color: burstColor,
      size: 10 + Math.random() * 18,
    };
  });
}

// eslint-disable-next-line complexity
function styleTrail(mode, idx, size, color, point, now) {
  const fade = Math.max(0.08, 1 - idx * 0.08);
  const scale = Math.max(0.26, 1 - idx * 0.06);
  const wiggle = Math.sin((now / 100) + idx) * (size * 0.08);

  if (mode === 'ghost') {
    return {
      width: size * 0.56, height: size * 0.56, borderRadius: '9999px',
      border: `1px solid ${color}99`, background: `${color}22`,
      transform: `translate(calc(-50% + ${wiggle}px), -50%) scale(${scale})`, opacity: fade,
    };
  }
  if (mode === 'echo') {
    return {
      width: size * 0.8, height: size * 0.8, borderRadius: '9999px',
      border: `2px solid ${color}bb`,
      transform: `translate(-50%, -50%) scale(${scale * 1.2})`, opacity: fade,
    };
  }
  if (mode === 'glitch') {
    return {
      width: size * 0.46, height: size * 0.46, borderRadius: '2px',
      background: idx % 2 ? withAlpha(color, 0.72) : withAlpha('#30e8ff', 0.72),
      transform: `translate(calc(-50% + ${idx % 2 ? 6 : -6}px), calc(-50% + ${wiggle}px)) scale(${scale}) skew(${idx * 2}deg)`,
      opacity: fade,
    };
  }
  if (mode === 'flames') {
    return {
      width: size * 0.72, height: size * 0.72, borderRadius: '55% 55% 70% 70%',
      background: `radial-gradient(circle at 50% 68%, ${withAlpha(color, 0.92)} 0%, ${withAlpha(color, 0.18)} 72%)`,
      boxShadow: `0 0 ${10 + idx * 2}px ${withAlpha(color, 0.9)}`,
      transform: `translate(calc(-50% + ${wiggle}px), calc(-50% - ${idx * 2.2}px)) scale(${scale + 0.1})`,
      opacity: fade,
    };
  }
  if (mode === 'throb') {
    return {
      width: size * 0.7, height: size * 0.7, borderRadius: '9999px',
      background: `${color}aa`, boxShadow: `0 0 ${8 + idx * 2}px ${color}`,
      transform: `translate(-50%, -50%) scale(${scale + Math.sin(now / 120 + idx) * 0.12})`,
      opacity: fade,
    };
  }
  if (mode === 'chromatic') {
    const swatch = [withAlpha(color, 0.7), '#13e7ff99', '#ffe80099'][idx % 3];
    return {
      width: size * 0.52, height: size * 0.52, borderRadius: '9999px', background: swatch,
      transform: `translate(calc(-50% + ${(idx % 3 - 1) * 5}px), calc(-50% + ${wiggle}px)) scale(${scale})`,
      opacity: fade,
    };
  }
  if (mode === 'angry') {
    return {
      width: size * 0.58, height: size * 0.58, borderRadius: '4px',
      background: withAlpha(color, 0.72), boxShadow: `0 0 14px ${withAlpha(color, 0.8)}`,
      transform: `translate(-50%, -50%) rotate(${idx * 9}deg) scale(${scale})`, opacity: fade,
    };
  }
  if (mode === 'hearts') {
    return {
      width: size * 0.5, height: size * 0.5, borderRadius: '0px', background: 'transparent',
      transform: `translate(-50%, calc(-50% - ${idx * 1.8}px)) scale(${scale})`,
      opacity: fade, heart: true,
    };
  }
  if (mode === 'comet') {
    return {
      width: size * 0.95, height: Math.max(3, size * 0.16), borderRadius: '999px',
      background: `linear-gradient(90deg, ${color}00 0%, ${color}aa 50%, ${color} 100%)`,
      transform: `translate(-50%, -50%) rotate(${point.angle || 0}deg) scale(${scale})`,
      opacity: fade,
    };
  }
  if (mode === 'plasma') {
    return {
      width: size * 0.66, height: size * 0.66,
      borderRadius: `${30 + idx * 6}% ${70 - idx * 4}% ${60 + idx * 3}% ${40 + idx * 2}%`,
      background: `radial-gradient(circle, ${color}cc 0%, ${color}22 70%)`,
      transform: `translate(calc(-50% + ${wiggle}px), -50%) scale(${scale + 0.12})`, opacity: fade,
    };
  }
  if (mode === 'matrix') {
    return {
      width: size * 0.5, height: size * 0.5, borderRadius: '2px',
      background: withAlpha(color, 0.72),
      transform: `translate(-50%, calc(-50% + ${idx * 1.8}px)) scale(${scale})`,
      opacity: fade, matrix: true,
    };
  }
  if (mode === 'aero-glass') {
    return {
      width: size * 0.74, height: size * 0.74, borderRadius: '9999px',
      border: `1px solid ${withAlpha(color, 0.6)}`,
      background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.85) 0%, ${withAlpha(color, 0.22)} 58%, ${withAlpha(color, 0.08)} 100%)`,
      boxShadow: `0 0 ${8 + idx * 2}px ${withAlpha(color, 0.4)}`,
      transform: `translate(calc(-50% + ${wiggle}px), -50%) scale(${scale + 0.08})`, opacity: fade,
    };
  }
  if (mode === 'vaporwave') {
    return {
      width: size * 0.62, height: size * 0.62, borderRadius: '12px',
      border: `1px solid ${withAlpha(color, 0.7)}`,
      background: `linear-gradient(135deg, ${withAlpha(color, 0.8)} 0%, rgba(0,255,255,0.58) 100%)`,
      boxShadow: `0 0 ${12 + idx * 1.5}px ${withAlpha(color, 0.65)}`,
      transform: `translate(calc(-50% + ${idx % 2 ? 4 : -4}px), calc(-50% + ${wiggle}px)) rotate(${idx * 4}deg) scale(${scale})`,
      opacity: fade,
    };
  }
  if (mode === 'retro-net') {
    return {
      width: size * 0.8, height: size * 0.8, borderRadius: '4px',
      border: `1px dashed ${withAlpha(color, 0.75)}`,
      background: `repeating-linear-gradient(45deg, ${withAlpha(color, 0.2)} 0px, ${withAlpha(color, 0.2)} 3px, transparent 3px, transparent 7px)`,
      boxShadow: `0 0 ${10 + idx * 2}px ${withAlpha(color, 0.45)}`,
      transform: `translate(-50%, -50%) rotate(${idx * 6}deg) scale(${scale})`, opacity: fade,
    };
  }
  if (mode === 'vortex') {
    return {
      width: size * 0.62, height: size * 0.62, borderRadius: '9999px',
      border: `2px dashed ${color}bb`,
      transform: `translate(-50%, -50%) rotate(${now / 5 + idx * 20}deg) scale(${scale})`,
      opacity: fade,
    };
  }
  if (mode === 'sparkstorm') {
    return {
      width: size * 0.4, height: size * 0.4, borderRadius: '9999px',
      background: '#fff5', boxShadow: `0 0 ${10 + idx * 2}px ${color}`,
      transform: `translate(calc(-50% + ${wiggle}px), -50%) scale(${scale})`,
      opacity: fade, spark: true,
    };
  }
  if (mode === 'void') {
    return {
      width: size * 0.75, height: size * 0.75, borderRadius: '9999px',
      background: 'radial-gradient(circle, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.12) 75%)',
      border: `1px solid ${color}55`,
      transform: `translate(-50%, -50%) scale(${scale})`, opacity: fade,
    };
  }

  // ────────────────── NEW TRAILS ──────────────────

  if (mode === 'slime') {
    const t = now / 200 + idx;
    const bR = `${48 + Math.sin(t) * 12}% ${52 - Math.sin(t) * 10}% ${55 + Math.cos(t) * 8}% ${45 - Math.cos(t) * 8}% / ${52 + Math.sin(t * 1.3) * 10}% ${48 - Math.sin(t * 0.9) * 8}% ${50 + Math.cos(t * 1.1) * 9}% ${50 - Math.cos(t * 1.2) * 7}%`;
    return {
      width: size * (0.68 + (idx % 2) * 0.1),
      height: size * (0.6 + (idx % 3) * 0.08),
      borderRadius: bR,
      background: withAlpha(color, 0.82),
      boxShadow: `0 ${5 + idx * 2}px 18px ${withAlpha(color, 0.55)}, inset 0 -${3 + idx}px 10px ${withAlpha(color, 0.25)}, inset 3px -2px 6px rgba(255,255,255,0.28)`,
      transform: `translate(calc(-50% + ${wiggle * 0.4}px), calc(-50% + ${idx * 3.2}px)) scale(${scale + 0.1})`,
      opacity: fade * 0.9,
    };
  }
  if (mode === 'blood') {
    const drH = size * (0.42 + idx * 0.18);
    return {
      width: size * Math.max(0.06, 0.24 - idx * 0.008),
      height: drH,
      borderRadius: '50% 50% 45% 45% / 18% 18% 82% 82%',
      background: `linear-gradient(180deg, ${color} 0%, ${withAlpha(color, 0.7)} 70%, ${withAlpha(color, 0.2)} 100%)`,
      boxShadow: `0 0 6px ${withAlpha(color, 0.7)}`,
      transform: `translate(-50%, calc(-30% + ${idx * 4}px)) scale(${Math.max(0.3, scale + 0.05)})`,
      opacity: fade,
    };
  }
  if (mode === 'kawaii') {
    const kc = ['#ffb3de', '#b3d4ff', '#fffe9e', '#b3ffdb', '#ffcce0', '#e0b3ff', '#b3fff0', '#ffd4b3'];
    const c = kc[idx % kc.length];
    return {
      width: size * 0.44, height: size * 0.44, borderRadius: '9999px',
      background: c, boxShadow: `0 0 10px ${c}bb`,
      transform: `translate(calc(-50% + ${Math.sin(now / 180 + idx) * size * 0.18}px), calc(-50% + ${Math.cos(now / 220 + idx) * size * 0.1}px)) scale(${scale + 0.08})`,
      opacity: fade * 0.85, kawaii: true, kawaiiColor: c,
    };
  }
  if (mode === 'bubblegum') {
    const bc = ['#ff85c8', '#85d4ff', '#ffd585', '#a885ff', '#85ffa8'];
    const c = bc[idx % bc.length];
    return {
      width: size * 0.52, height: size * 0.52, borderRadius: '9999px',
      background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, ${c} 46%, ${withAlpha(c, 0.5)} 100%)`,
      boxShadow: `0 0 12px ${withAlpha(c, 0.65)}`,
      transform: `translate(calc(-50% + ${wiggle * 0.8}px), calc(-50% + ${Math.sin(now / 160 + idx) * size * 0.1}px)) scale(${scale + 0.1})`,
      opacity: fade,
    };
  }
  if (mode === 'candy') {
    const cc = ['#ff6bac', '#ffcc00', '#5bdcff', '#a380ff', '#ff8c42', '#ff4f8b'];
    const c = cc[idx % cc.length];
    return {
      width: size * 0.44, height: size * 0.44, borderRadius: '9999px',
      background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.9) 0%, ${c} 50%, ${withAlpha(c, 0.6)} 100%)`,
      boxShadow: `0 0 10px ${withAlpha(c, 0.7)}`,
      transform: `translate(calc(-50% + ${wiggle}px), -50%) scale(${scale + 0.1})`,
      opacity: fade,
    };
  }
  if (mode === 'stardust') {
    return {
      width: size * 0.36, height: size * 0.36, background: 'transparent',
      transform: `translate(calc(-50% + ${Math.sin(now / 130 + idx * 1.2) * size * 0.3}px), calc(-50% + ${Math.cos(now / 170 + idx * 0.9) * size * 0.2}px)) scale(${scale + 0.05})`,
      opacity: fade, stardust: true, stardustColor: color,
    };
  }
  if (mode === 'sakura') {
    const sc = ['#ffb3d1', '#ffd4e8', '#ff9fc7', '#ffe0ef', '#ffc2da'];
    const c = sc[idx % sc.length];
    return {
      width: size * 0.42, height: size * 0.54,
      borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
      background: `radial-gradient(ellipse at 50% 35%, rgba(255,255,255,0.92) 0%, ${c} 68%)`,
      transform: `translate(calc(-50% + ${wiggle}px), calc(-50% + ${idx * 1.6}px)) rotate(${idx * 30 + now / 25}deg) scale(${scale + 0.07})`,
      opacity: fade,
    };
  }
  if (mode === 'snow') {
    return {
      width: size * 0.48, height: size * 0.48, background: 'transparent',
      transform: `translate(calc(-50% + ${Math.sin(now / 200 + idx * 1.5) * size * 0.22}px), calc(-50% + ${idx * 2}px)) rotate(${idx * 30 + now / 15}deg) scale(${scale + 0.04})`,
      opacity: fade, snow: true, snowColor: color,
    };
  }
  if (mode === 'rainbow') {
    const hue = (idx * 28 + now / 18) % 360;
    return {
      width: size * 0.52, height: size * 0.52, borderRadius: '9999px',
      background: `hsl(${hue}, 92%, 62%)`, boxShadow: `0 0 12px hsl(${hue}, 88%, 60%)`,
      transform: `translate(-50%, -50%) scale(${scale + 0.1})`, opacity: fade,
    };
  }
  if (mode === 'fairy') {
    const fc = ['#ffd700', '#ff85ff', '#85ffef', '#ff85aa', '#ffe9a0'];
    const c = fc[idx % fc.length];
    return {
      width: size * 0.28, height: size * 0.28, borderRadius: '9999px', background: c,
      boxShadow: `0 0 ${16 + idx * 2}px ${c}, 0 0 ${8 + idx}px rgba(255,255,255,0.9)`,
      transform: `translate(calc(-50% + ${Math.sin(now / 100 + idx * 1.6) * size * 0.28}px), calc(-50% + ${Math.cos(now / 130 + idx * 1.2) * size * 0.2}px)) scale(${scale + 0.18})`,
      opacity: fade * 0.88,
    };
  }
  if (mode === 'confetti') {
    const cc = ['#ff4757', '#ffd700', '#2ed573', '#1e90ff', '#ff6b81', '#eccc68', '#ff6348', '#7bed9f'];
    const c = cc[idx % cc.length];
    return {
      width: size * (0.22 + (idx % 3) * 0.08), height: size * 0.14, borderRadius: '2px', background: c,
      transform: `translate(-50%, -50%) rotate(${idx * 41 + now / 35}deg) scale(${scale + 0.05})`,
      opacity: fade,
    };
  }
  if (mode === 'skull') {
    return {
      width: size * 0.5, height: size * 0.5, background: 'transparent',
      transform: `translate(calc(-50% + ${wiggle * 0.3}px), calc(-50% + ${idx * 2}px)) scale(${scale + 0.04})`,
      opacity: fade * 0.88, skull: true, skullColor: color,
    };
  }
  if (mode === 'bats') {
    return {
      width: size * 0.5, height: size * 0.5, background: 'transparent',
      transform: `translate(calc(-50% + ${Math.sin(now / 120 + idx * 0.9) * size * 0.28}px), calc(-50% + ${Math.cos(now / 90 + idx * 1.1) * size * 0.18}px)) scale(${scale + 0.04})`,
      opacity: fade * 0.88, bat: true, batColor: color,
    };
  }
  if (mode === 'shadow') {
    const bs = 0.6 + idx * 0.04;
    return {
      width: size * bs, height: size * bs,
      borderRadius: `${44 + idx * 6}% ${56 - idx * 5}% ${52 + idx * 4}% ${48 - idx * 4}%`,
      background: `radial-gradient(circle, rgba(0,0,0,0.9) 0%, ${withAlpha(color, 0.5)} 48%, transparent 80%)`,
      transform: `translate(calc(-50% + ${wiggle * 0.6}px), -50%) scale(${scale + 0.1})`,
      opacity: fade * 0.88,
    };
  }
  if (mode === 'witch') {
    return {
      width: size * (0.62 + idx * 0.025), height: size * (0.62 + idx * 0.025),
      borderRadius: `${50 + idx * 5}% ${50 - idx * 3}% ${45 + idx * 4}% ${55 - idx * 4}%`,
      background: `radial-gradient(circle, ${withAlpha(color, 0.78)} 0%, ${withAlpha(color, 0.18)} 62%, transparent 100%)`,
      filter: `blur(${Math.min(idx * 0.6, 3)}px)`,
      transform: `translate(calc(-50% + ${wiggle}px), calc(-50% - ${idx * 1.8}px)) scale(${scale + 0.14})`,
      opacity: fade * 0.78,
    };
  }
  if (mode === 'lightning') {
    return {
      width: size * 0.44, height: size * 0.44, background: 'transparent',
      transform: `translate(calc(-50% + ${(idx % 2 ? 6 : -6) + wiggle * 0.8}px), -50%) scale(${scale})`,
      opacity: fade, lightning: true, lightningColor: color,
    };
  }
  if (mode === 'laser') {
    return {
      width: size * 1.15, height: Math.max(2, size * 0.07), borderRadius: '999px',
      background: `linear-gradient(90deg, transparent 0%, ${withAlpha(color, 0.9)} 25%, ${color} 60%, ${withAlpha(color, 0.4)} 100%)`,
      boxShadow: `0 0 ${14 + idx * 2}px ${color}, 0 0 ${6 + idx}px ${withAlpha(color, 0.8)}`,
      transform: `translate(-50%, -50%) rotate(${point.angle || 0}deg) scale(${scale + 0.12})`,
      opacity: fade * 1.15,
    };
  }
  if (mode === 'neon-blade') {
    const nc = [color, '#ff00cc', '#00f5ff', '#aaff00', color];
    const c = nc[idx % nc.length];
    return {
      width: size * 0.88, height: Math.max(3, size * 0.11), borderRadius: '999px',
      background: `linear-gradient(90deg, transparent, ${c}, ${withAlpha(c, 0.3)})`,
      boxShadow: `0 0 ${20 + idx * 3}px ${c}, 0 0 ${9 + idx * 2}px ${withAlpha(c, 0.7)}`,
      transform: `translate(-50%, -50%) rotate(${(point.angle || 0) + idx * 3}deg) scale(${scale + 0.14})`,
      opacity: fade * 1.1,
    };
  }
  if (mode === 'hologram') {
    const hue = (idx * 40 + now / 12) % 360;
    return {
      width: size * 0.7, height: size * 0.7,
      borderRadius: `${idx % 2 ? '4px' : '9999px'}`,
      border: `1px solid hsla(${hue}, 100%, 70%, 0.75)`,
      background: `hsla(${hue}, 100%, 65%, 0.12)`,
      boxShadow: `0 0 ${10 + idx * 2}px hsla(${hue}, 100%, 65%, 0.6)`,
      transform: `translate(-50%, -50%) rotate(${idx * 8}deg) scale(${scale + 0.06})`,
      opacity: fade,
    };
  }
  if (mode === 'toxic') {
    const sz = size * (0.38 + (idx % 3) * 0.14);
    return {
      width: sz, height: sz, borderRadius: '9999px',
      background: `radial-gradient(circle at 33% 28%, rgba(200,255,50,0.92) 0%, ${withAlpha(color, 0.75)} 52%, ${withAlpha(color, 0.2)} 100%)`,
      boxShadow: `0 0 ${12 + idx * 2}px ${withAlpha(color, 0.85)}`,
      transform: `translate(calc(-50% + ${wiggle * 0.7}px), calc(-50% + ${Math.sin(now / 200 + idx * 1.5) * size * 0.14}px)) scale(${scale + 0.06})`,
      opacity: fade,
    };
  }
  if (mode === 'spider' || mode === 'cobweb') {
    return {
      width: size * 1.1, height: Math.max(1, size * 0.04),
      background: `linear-gradient(90deg, transparent, ${withAlpha(color, 0.7)}, ${withAlpha(color, 0.3)}, transparent)`,
      boxShadow: `0 0 3px ${withAlpha(color, 0.5)}`,
      transform: `translate(-50%, -50%) rotate(${point.angle || 0}deg) scale(${scale + 0.3})`,
      opacity: fade * 0.72,
    };
  }
  if (mode === 'lava') {
    const t = now / 180 + idx;
    const bR = `${45 + Math.sin(t) * 14}% ${55 - Math.sin(t) * 12}% ${50 + Math.cos(t) * 10}% ${50 - Math.cos(t) * 9}%`;
    return {
      width: size * (0.6 + (idx % 2) * 0.12), height: size * (0.56 + (idx % 3) * 0.07),
      borderRadius: bR,
      background: `radial-gradient(circle at 50% 60%, ${withAlpha(color, 0.95)} 0%, ${withAlpha('#ff8800', 0.7)} 45%, ${withAlpha('#ff2200', 0.35)} 100%)`,
      boxShadow: `0 0 ${10 + idx * 2}px ${withAlpha(color, 0.8)}, 0 0 ${20 + idx * 3}px ${withAlpha('#ff4400', 0.45)}`,
      transform: `translate(calc(-50% + ${wiggle * 0.5}px), calc(-50% + ${idx * 2.5}px)) scale(${scale + 0.1})`,
      opacity: fade,
    };
  }
  if (mode === 'glitter') {
    const gc = ['#ffd700', '#ff99ff', '#99ffee', '#ffcc00', '#ffffff'];
    const c = gc[idx % gc.length];
    const sz = size * (0.15 + (idx % 3) * 0.1);
    return {
      width: sz, height: sz, borderRadius: '9999px', background: c,
      boxShadow: `0 0 ${8 + idx * 2}px ${c}, 0 0 ${4 + idx}px rgba(255,255,255,0.9)`,
      transform: `translate(calc(-50% + ${Math.sin(now / 90 + idx * 2.1) * size * 0.35}px), calc(-50% + ${Math.cos(now / 120 + idx * 1.7) * size * 0.25}px)) scale(${scale + 0.2})`,
      opacity: fade * 0.9,
    };
  }
  if (mode === 'bubble') {
    const bs = 0.5 + (idx % 3) * 0.12;
    return {
      width: size * bs, height: size * bs, borderRadius: '9999px',
      border: `1px solid ${withAlpha(color, 0.55)}`,
      background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.85) 0%, ${withAlpha(color, 0.12)} 55%, transparent 100%)`,
      boxShadow: `0 0 ${6 + idx}px ${withAlpha(color, 0.3)}`,
      transform: `translate(calc(-50% + ${Math.sin(now / 150 + idx) * size * 0.18}px), calc(-50% + ${Math.cos(now / 200 + idx) * size * 0.12}px)) scale(${scale + 0.08})`,
      opacity: fade,
    };
  }

  return {
    width: size * 0.5, height: size * 0.5, borderRadius: '9999px',
    background: `${color}88`,
    transform: `translate(-50%, -50%) scale(${scale})`, opacity: fade,
  };
}

function WindowsGlyph({ preset, size, color, interactive }) {
  const glyph = WINDOWS_GLYPHS[preset] || WINDOWS_GLYPHS.default;
  return (
    <span
      style={{
        fontSize: Math.max(16, size), lineHeight: 1, color,
        filter: interactive ? 'invert(1)' : 'none',
        textShadow: `0 0 ${Math.max(6, size * 0.3)}px ${color}66`,
        transform: preset === 'wait' ? 'rotate(20deg)' : 'none',
      }}
    >
      {glyph}
    </span>
  );
}

export default function CustomCursorOverlay() {
  const { resolvedTheme } = useSiteTheme();
  const rafRef = useRef(null);

  const [active, setActive] = useState(() => supportsCustomCursor());
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [trailPoints, setTrailPoints] = useState([]);
  const [particles, setParticles] = useState([]);
  const [hoveringInteractive, setHoveringInteractive] = useState(false);
  const [isDown, setIsDown] = useState(false);

  const cursorType = resolvedTheme.cursorType || 'default';
  const isDefault = cursorType === 'default';
  const showEmoji = cursorType === 'emoji';
  const showImage = cursorType === 'image' && !!resolvedTheme.cursorImageData;
  const showWindows = cursorType === 'windows';
  const cursorColor = resolvedTheme.cursorColor || '#FFFFFF';
  const cursorEffectColor = resolvedTheme.cursorEffectColor || null;
  const cursorOutlineEnabled = resolvedTheme.cursorOutlineEnabled ?? true;
  const cursorOutlineColor = resolvedTheme.cursorOutlineColor || '#000000';
  const cursorOutlineWidth = Number(resolvedTheme.cursorOutlineWidth ?? 2);

  const trail = resolvedTheme.cursorTrail || 'none';
  const effectColor = resolveEffectColor(trail, cursorColor, cursorEffectColor);
  const trailEnabled = active && trail !== 'none';
  const customEnabled = active && (!isDefault || trail !== 'none');

  const glyphSize = useMemo(() => Math.max(8, Number(resolvedTheme.cursorSize || 28)), [resolvedTheme.cursorSize]);

  useEffect(() => {
    function handleResize() { setActive(supportsCustomCursor()); }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    function tick() {
      setParticles((prev) => prev
        .map((p) => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.05, life: p.life - 1 }))
        .filter((p) => p.life > 0)
      );
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(() => {
    if (!active) return;

    function onMove(event) {
      const interactive = !!event.target?.closest?.(INTERACTIVE_SELECTOR);
      setHoveringInteractive(interactive);

      const angle = trailPoints.length
        ? (Math.atan2(event.clientY - trailPoints[0].y, event.clientX - trailPoints[0].x) * 180) / Math.PI
        : 0;

      const next = { x: event.clientX, y: event.clientY, t: Date.now(), angle };
      setPos(next);

      if (trailEnabled) {
        setTrailPoints((prev) => [next, ...prev].slice(0, 16));

        const ambientBursts = ['hearts', 'flames', 'vaporwave', 'retro-net', 'aero-glass',
          'kawaii', 'fairy', 'stardust', 'rainbow', 'confetti', 'sakura', 'snow', 'bubblegum',
          'candy', 'glitter', 'bubble', 'hologram'];
        if (ambientBursts.includes(trail) && Math.random() > 0.76) {
          setParticles((prev) => [
            ...prev,
            ...makeBurst(trail, event.clientX, event.clientY, effectColor, trail === 'glitter' ? 3 : 2),
          ].slice(-280));
        }

        const darkBursts = ['blood', 'slime', 'toxic', 'witch', 'lava'];
        if (darkBursts.includes(trail) && Math.random() > 0.82) {
          setParticles((prev) => [
            ...prev,
            ...makeBurst(trail, event.clientX, event.clientY, effectColor, 2),
          ].slice(-240));
        }

        const energyBursts = ['lightning', 'neon-blade', 'laser', 'sparkstorm'];
        if (energyBursts.includes(trail) && Math.random() > 0.78) {
          setParticles((prev) => [
            ...prev,
            ...makeBurst(trail, event.clientX, event.clientY, effectColor, 3),
          ].slice(-260));
        }
      }
    }

    function onDown(event) {
      setIsDown(true);
      if (!trailEnabled) return;
      const burstCount = ['sparkstorm', 'confetti', 'glitter'].includes(trail) ? 32
        : ['rainbow', 'kawaii', 'fairy'].includes(trail) ? 24
        : 20;
      setParticles((prev) => [
        ...prev,
        ...makeBurst(trail, event.clientX, event.clientY, effectColor, burstCount),
      ].slice(-300));
    }

    function onUp() { setIsDown(false); }

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, [active, trailEnabled, trail, effectColor, trailPoints]);

  useEffect(() => {
    if (!active || isDefault) {
      document.documentElement.classList.remove('lp-force-custom-cursor');
      return;
    }
    document.documentElement.classList.add('lp-force-custom-cursor');
    return () => { document.documentElement.classList.remove('lp-force-custom-cursor'); };
  }, [active, isDefault]);

  if (!customEnabled) return null;

  const glyphFilter = hoveringInteractive ? 'invert(1) hue-rotate(180deg)' : 'none';
  const renderNow = Date.now();

  return (
    <div className="pointer-events-none fixed inset-0 z-[2147483647]">
      {trailEnabled && trailPoints.map((point, idx) => {
        const style = styleTrail(trail, idx, glyphSize, effectColor, point, renderNow);

        if (style.heart) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(10, Math.round(glyphSize * 0.46)), color: hoveringInteractive ? '#7fffd4' : effectColor }}>
              ❤
            </div>
          );
        }
        if (style.matrix) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(9, Math.round(glyphSize * 0.38)), color: effectColor, textShadow: `0 0 8px ${withAlpha(effectColor, 0.9)}` }}>
              {idx % 2 === 0 ? '1' : '0'}
            </div>
          );
        }
        if (style.spark) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(10, Math.round(glyphSize * 0.35)), color: cursorColor, textShadow: `0 0 14px ${cursorColor}` }}>
              ✶
            </div>
          );
        }
        if (style.kawaii) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(9, Math.round(glyphSize * 0.4)), color: style.kawaiiColor, textShadow: `0 0 8px ${style.kawaiiColor}` }}>
              {KAWAII_SYMBOLS[idx % KAWAII_SYMBOLS.length]}
            </div>
          );
        }
        if (style.stardust) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(8, Math.round(glyphSize * 0.32)), color: style.stardustColor, textShadow: `0 0 10px ${style.stardustColor}, 0 0 4px rgba(255,255,255,0.9)` }}>
              {STARDUST_SYMBOLS[idx % STARDUST_SYMBOLS.length]}
            </div>
          );
        }
        if (style.snow) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(10, Math.round(glyphSize * 0.44)), color: style.snowColor, textShadow: `0 0 8px ${style.snowColor}, 0 0 4px rgba(255,255,255,0.85)` }}>
              {SNOW_SYMBOLS[idx % SNOW_SYMBOLS.length]}
            </div>
          );
        }
        if (style.skull) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(9, Math.round(glyphSize * 0.42)), color: style.skullColor, textShadow: `0 0 10px ${style.skullColor}` }}>
              {SKULL_SYMBOLS[idx % SKULL_SYMBOLS.length]}
            </div>
          );
        }
        if (style.bat) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(9, Math.round(glyphSize * 0.4)), color: style.batColor, textShadow: `0 0 8px ${style.batColor}` }}>
              {BATS_SYMBOLS[idx % BATS_SYMBOLS.length]}
            </div>
          );
        }
        if (style.lightning) {
          return (
            <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, transform: style.transform, opacity: style.opacity, fontSize: Math.max(10, Math.round(glyphSize * 0.44)), color: style.lightningColor, textShadow: `0 0 12px ${style.lightningColor}, 0 0 6px rgba(255,255,200,0.9)` }}>
              {LIGHTNING_SYMBOLS[idx % LIGHTNING_SYMBOLS.length]}
            </div>
          );
        }

        return (
          <div key={`${point.t}-${idx}`} style={{ position: 'fixed', left: point.x, top: point.y, ...style }} />
        );
      })}

      {particles.map((p) => (
        <div key={p.id} style={{ position: 'fixed', left: p.x, top: p.y, transform: 'translate(-50%, -50%)', color: p.color, opacity: p.life / p.maxLife, fontSize: p.size, textShadow: `0 0 10px ${p.color}` }}>
          {p.symbol}
        </div>
      ))}

      <div
        style={{
          position: 'fixed', left: pos.x, top: pos.y,
          transform: `translate(-50%, -50%) scale(${isDown ? 0.92 : 1})`,
          width: glyphSize, height: glyphSize,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 90ms linear',
          filter: trail === 'vaporwave' ? 'drop-shadow(0 0 10px rgba(255,77,228,0.65)) saturate(1.18)' : 'none',
          outline: cursorOutlineEnabled ? `${cursorOutlineWidth}px solid ${cursorOutlineColor}` : 'none',
          borderRadius: (showEmoji || showWindows || isDefault) ? '2px' : '50%',
        }}
      >
        {/* ── Cursor head overlays ── */}
        {trail === 'flames' && (
          <>
            <div style={{ position: 'absolute', inset: -Math.max(10, glyphSize * 0.45), borderRadius: '9999px', background: `radial-gradient(circle at 50% 70%, ${withAlpha(effectColor, 0.9)} 0%, ${withAlpha(effectColor, 0.15)} 55%, transparent 78%)`, filter: 'blur(6px)', opacity: hoveringInteractive ? 0.95 : 0.82, transform: `translateY(${isDown ? 2 : 0}px)` }} />
            <div style={{ position: 'absolute', left: '50%', top: '56%', transform: 'translate(-50%, -50%)', fontSize: Math.max(12, Math.round(glyphSize * 0.9)), opacity: 0.9, textShadow: `0 0 14px ${withAlpha(effectColor, 0.95)}` }}>🔥</div>
          </>
        )}
        {trail === 'aero-glass' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.34), borderRadius: '9999px', background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.8), ${withAlpha(effectColor, 0.2)} 65%, transparent 100%)`, border: `1px solid ${withAlpha(effectColor, 0.5)}`, boxShadow: `0 0 18px ${withAlpha(effectColor, 0.42)}` }} />
        )}
        {trail === 'retro-net' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.3), borderRadius: '10px', border: `1px dashed ${withAlpha(effectColor, 0.72)}`, background: `repeating-linear-gradient(90deg, transparent 0 5px, ${withAlpha(effectColor, 0.16)} 5px 6px)`, boxShadow: `0 0 12px ${withAlpha(effectColor, 0.45)}` }} />
        )}
        {trail === 'slime' && (
          <>
            <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.44), borderRadius: '62% 48% 55% 45% / 58% 52% 48% 62%', background: `radial-gradient(circle at 38% 32%, rgba(255,255,255,0.45) 0%, ${withAlpha(effectColor, 0.72)} 50%, ${withAlpha(effectColor, 0.9)} 100%)`, boxShadow: `0 ${Math.max(4, glyphSize * 0.2)}px ${Math.max(12, glyphSize * 0.5)}px ${withAlpha(effectColor, 0.6)}, inset 0 -${Math.max(3, glyphSize * 0.12)}px ${Math.max(6, glyphSize * 0.25)}px ${withAlpha(effectColor, 0.28)}`, border: `1px solid ${withAlpha(effectColor, 0.65)}` }} />
            <div style={{ position: 'absolute', bottom: -Math.max(10, glyphSize * 0.5), left: '45%', transform: 'translateX(-50%)', width: Math.max(4, glyphSize * 0.22), height: Math.max(10, glyphSize * 0.52), background: `linear-gradient(180deg, ${withAlpha(effectColor, 0.88)} 0%, ${withAlpha(effectColor, 0.45)} 72%, transparent 100%)`, borderRadius: '0 0 50% 50%' }} />
          </>
        )}
        {trail === 'blood' && (
          <div style={{ position: 'absolute', bottom: -Math.max(12, glyphSize * 0.55), left: '50%', transform: 'translateX(-50%)', width: Math.max(4, glyphSize * 0.18), height: Math.max(14, glyphSize * 0.62), background: `linear-gradient(180deg, ${effectColor} 0%, ${withAlpha(effectColor, 0.6)} 75%, transparent 100%)`, borderRadius: '0 0 50% 50%', boxShadow: `0 0 8px ${withAlpha(effectColor, 0.8)}` }} />
        )}
        {trail === 'lightning' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.32), borderRadius: '9999px', background: `radial-gradient(circle, ${withAlpha(effectColor, 0.22)} 0%, transparent 68%)`, boxShadow: `0 0 ${Math.max(14, glyphSize * 0.55)}px ${withAlpha(effectColor, 0.85)}, 0 0 ${Math.max(7, glyphSize * 0.28)}px ${withAlpha(effectColor, 0.6)}`, border: `1px solid ${withAlpha(effectColor, 0.55)}` }} />
        )}
        {trail === 'neon-blade' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.38), borderRadius: '9999px', background: 'transparent', boxShadow: `0 0 ${Math.max(20, glyphSize * 0.75)}px ${withAlpha(effectColor, 0.9)}, 0 0 ${Math.max(10, glyphSize * 0.4)}px ${withAlpha('#00ffff', 0.65)}, inset 0 0 ${Math.max(6, glyphSize * 0.25)}px ${withAlpha(effectColor, 0.3)}`, border: `1px solid ${withAlpha(effectColor, 0.6)}` }} />
        )}
        {trail === 'hologram' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.3), borderRadius: '4px', border: `1px solid ${withAlpha(effectColor, 0.7)}`, background: `repeating-linear-gradient(0deg, transparent 0px, ${withAlpha(effectColor, 0.06)} 1px, transparent 2px, transparent 4px)`, boxShadow: `0 0 ${Math.max(14, glyphSize * 0.55)}px ${withAlpha(effectColor, 0.7)}` }} />
        )}
        {trail === 'witch' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.38), borderRadius: '54% 46% 52% 48% / 48% 54% 46% 52%', background: `radial-gradient(circle, ${withAlpha(effectColor, 0.2)} 0%, transparent 65%)`, boxShadow: `0 0 ${Math.max(18, glyphSize * 0.7)}px ${withAlpha(effectColor, 0.72)}`, border: `1px dashed ${withAlpha(effectColor, 0.5)}` }} />
        )}
        {trail === 'skull' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.3), borderRadius: '9999px', background: `radial-gradient(circle, ${withAlpha(effectColor, 0.14)} 0%, transparent 65%)`, boxShadow: `0 0 ${Math.max(14, glyphSize * 0.58)}px ${withAlpha(effectColor, 0.65)}`, border: `1px solid ${withAlpha(effectColor, 0.35)}` }} />
        )}
        {trail === 'bats' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.28), borderRadius: '9999px', background: `radial-gradient(circle, ${withAlpha(effectColor, 0.15)} 0%, transparent 65%)`, boxShadow: `0 0 ${Math.max(12, glyphSize * 0.5)}px ${withAlpha(effectColor, 0.6)}` }} />
        )}
        {trail === 'toxic' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.38), borderRadius: '9999px', background: `radial-gradient(circle at 38% 34%, rgba(200,255,50,0.22) 0%, ${withAlpha(effectColor, 0.18)} 55%, transparent 85%)`, boxShadow: `0 0 ${Math.max(18, glyphSize * 0.7)}px ${withAlpha(effectColor, 0.82)}, 0 0 ${Math.max(9, glyphSize * 0.36)}px ${withAlpha('#aaff00', 0.55)}`, border: `1px solid ${withAlpha(effectColor, 0.5)}` }} />
        )}
        {trail === 'lava' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.4), borderRadius: '58% 42% 55% 45% / 48% 52% 55% 45%', background: `radial-gradient(circle at 50% 65%, ${withAlpha(effectColor, 0.88)} 0%, ${withAlpha('#ff4400', 0.45)} 55%, transparent 85%)`, boxShadow: `0 0 ${Math.max(18, glyphSize * 0.72)}px ${withAlpha(effectColor, 0.75)}, 0 0 ${Math.max(8, glyphSize * 0.32)}px ${withAlpha('#ff8800', 0.6)}`, filter: 'blur(1px)' }} />
        )}
        {trail === 'fairy' && (
          <div style={{ position: 'absolute', inset: -Math.max(10, glyphSize * 0.45), borderRadius: '9999px', background: 'transparent', boxShadow: `0 0 ${Math.max(22, glyphSize * 0.85)}px ${withAlpha(effectColor, 0.72)}, 0 0 ${Math.max(11, glyphSize * 0.44)}px rgba(255,255,255,0.65)`, border: `1px solid ${withAlpha(effectColor, 0.45)}` }} />
        )}
        {trail === 'rainbow' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.3), borderRadius: '9999px', background: 'transparent', boxShadow: `0 0 ${Math.max(14, glyphSize * 0.58)}px rgba(255,80,80,0.7), 0 0 ${Math.max(10, glyphSize * 0.4)}px rgba(80,255,80,0.6), 0 0 ${Math.max(8, glyphSize * 0.32)}px rgba(80,80,255,0.6)`, outline: `1px solid rgba(255,160,200,0.5)` }} />
        )}
        {trail === 'kawaii' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.38), borderRadius: '9999px', background: 'transparent', boxShadow: `0 0 ${Math.max(16, glyphSize * 0.65)}px rgba(255,179,222,0.72), 0 0 ${Math.max(8, glyphSize * 0.32)}px rgba(179,212,255,0.6)`, border: `1px dashed rgba(255,179,222,0.6)` }} />
        )}
        {trail === 'snow' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.32), borderRadius: '9999px', background: `radial-gradient(circle, rgba(200,230,255,0.18) 0%, transparent 65%)`, boxShadow: `0 0 ${Math.max(12, glyphSize * 0.5)}px ${withAlpha(effectColor, 0.62)}, 0 0 ${Math.max(6, glyphSize * 0.26)}px rgba(255,255,255,0.75)`, border: `1px solid ${withAlpha(effectColor, 0.5)}` }} />
        )}
        {trail === 'shadow' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.4), borderRadius: '52% 48% 55% 45% / 48% 52% 45% 55%', background: `radial-gradient(circle, rgba(0,0,0,0.55) 0%, ${withAlpha(effectColor, 0.28)} 45%, transparent 75%)`, boxShadow: `0 0 ${Math.max(18, glyphSize * 0.72)}px ${withAlpha(effectColor, 0.68)}` }} />
        )}
        {trail === 'glitter' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.3), borderRadius: '9999px', background: 'transparent', boxShadow: `0 0 ${Math.max(14, glyphSize * 0.56)}px ${withAlpha(effectColor, 0.8)}, 0 0 ${Math.max(7, glyphSize * 0.28)}px rgba(255,255,255,0.7)` }} />
        )}
        {trail === 'bubble' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.32), borderRadius: '9999px', border: `1px solid ${withAlpha(effectColor, 0.55)}`, background: `radial-gradient(circle at 28% 24%, rgba(255,255,255,0.8) 0%, ${withAlpha(effectColor, 0.08)} 55%, transparent 100%)`, boxShadow: `0 0 ${Math.max(8, glyphSize * 0.34)}px ${withAlpha(effectColor, 0.4)}` }} />
        )}
        {trail === 'stardust' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.38), borderRadius: '9999px', background: 'transparent', boxShadow: `0 0 ${Math.max(18, glyphSize * 0.72)}px ${withAlpha(effectColor, 0.75)}, 0 0 ${Math.max(9, glyphSize * 0.36)}px rgba(255,255,200,0.6)` }} />
        )}
        {trail === 'confetti' && (
          <div style={{ position: 'absolute', inset: -Math.max(6, glyphSize * 0.3), borderRadius: '9999px', background: 'transparent', boxShadow: `0 0 ${Math.max(12, glyphSize * 0.5)}px rgba(255,71,87,0.6), 0 0 ${Math.max(8, glyphSize * 0.32)}px rgba(255,215,0,0.55)` }} />
        )}
        {trail === 'sakura' && (
          <div style={{ position: 'absolute', inset: -Math.max(8, glyphSize * 0.38), borderRadius: '9999px', background: `radial-gradient(circle, rgba(255,179,209,0.2) 0%, transparent 65%)`, boxShadow: `0 0 ${Math.max(16, glyphSize * 0.65)}px rgba(255,159,199,0.68)` }} />
        )}

        {showWindows && (
          <WindowsGlyph
            preset={resolvedTheme.cursorPreset || 'default'}
            size={glyphSize}
            color={hoveringInteractive ? '#000000' : cursorColor}
            interactive={hoveringInteractive}
          />
        )}
        {showEmoji && (
          <span style={{ fontSize: glyphSize, lineHeight: 1, filter: glyphFilter, textShadow: `0 0 ${Math.max(8, glyphSize * 0.35)}px ${withAlpha(effectColor, 0.5)}` }}>
            {resolvedTheme.cursorEmoji || '✨'}
          </span>
        )}
        {showImage && (
          <img src={resolvedTheme.cursorImageData} alt="cursor" style={{ width: glyphSize, height: glyphSize, objectFit: 'contain', filter: `${glyphFilter} drop-shadow(0 0 ${Math.max(6, glyphSize * 0.3)}px ${withAlpha(effectColor, 0.5)})` }} />
        )}
      </div>
    </div>
  );
}
