// @ts-nocheck
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSiteTheme } from '../lib/theme';
import { containsProfanity } from '../lib/profanityFilter';
import { isUserInZipCode } from '../lib/locationService';
import {
  fetchGeoPostFeed, submitGeoPost, uploadGeoPostImage,
  addPostReaction, removePostReaction, fetchReactionsForPosts,
  fetchCommentsForPost, submitPostComment, fetchCommentReactions,
  upsertCommentReaction, removeCommentReaction, fetchProfileForGeoPost,
  syncSampleGeoPostsToSupabase, syncSampleGeoCommentsToSupabase,
} from '../lib/supabase';
import { uploadToOracleCloud, isOciConfigured } from '../lib/oracleStorage';
import { NYC_ZIP_FEATURES } from '../lib/nycZipGeoJSON';
import { ALL_COOL_FONTS, convertFont, toPlainText } from '../lib/unicodeFonts';
import { isLocalParticipant } from '../lib/pointsSystem';
import { SAMPLE_MODE } from '../lib/sampleConfig';
import EmojiPicker from './EmojiPicker';

// ── constants ─────────────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 500 * 1024;
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const BOROUGH_ZIPS = BOROUGHS.reduce((acc, b) => {
  acc[b] = NYC_ZIP_FEATURES.filter(z => z.borough === b).sort((a, x) => a.zip.localeCompare(x.zip));
  return acc;
}, {});
const PAGE_SIZE = 40;
const TIME_OPTIONS = [
  { key: 'all', label: 'All Time' },
  { key: '1d',  label: '1 Day' },
  { key: '7d',  label: '7 Days' },
  { key: '1mo', label: '1 Month' },
  { key: '3mo', label: '3 Months' },
  { key: '6mo', label: '6 Months' },
];
const PRESET_COLORS = [
  '#000000','#ffffff','#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e',
];

function stripHtmlTags(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Walks up the DOM to find the nearest element with overflow-y: auto|scroll.
// Falls back to window if none found (standard page scroll).
function findScrollParent(el) {
  let node = el?.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return window;
}

function normalizeHexColor(value, fallback = '#ffffff') {
  if (!value) return fallback;
  const v = String(value).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const h = v.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  return fallback;
}

function luminanceFromHex(value) {
  const hex = normalizeHexColor(value, '#ffffff').slice(1);
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastTextColor(bgColor) {
  return luminanceFromHex(bgColor) > 0.5 ? '#000000' : '#ffffff';
}

function getPostVisualTheme(post, resolvedTheme) {
  const fill = normalizeHexColor(post?.post_fill || resolvedTheme?.surfaceBackgroundColor || '#ffffff', '#ffffff');
  const outline = normalizeHexColor(post?.post_outline || '#000000', '#000000');
  const shadow = normalizeHexColor(post?.post_shadow || '#000000', '#000000');
  const text = contrastTextColor(fill);
  const chipFill = text;
  const chipText = contrastTextColor(chipFill);
  return { fill, outline, shadow, text, chipFill, chipText };
}

function normalizeSearchText(value = '') {
  return toPlainText(stripHtmlTags(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearColor(hex, target, tolerance = 55) {
  const h1 = normalizeHexColor(hex, '#000000').slice(1);
  const h2 = normalizeHexColor(target, '#000000').slice(1);
  const r1 = parseInt(h1.slice(0, 2), 16);
  const g1 = parseInt(h1.slice(2, 4), 16);
  const b1 = parseInt(h1.slice(4, 6), 16);
  const r2 = parseInt(h2.slice(0, 2), 16);
  const g2 = parseInt(h2.slice(2, 4), 16);
  const b2 = parseInt(h2.slice(4, 6), 16);
  const dist = Math.sqrt(((r1 - r2) ** 2) + ((g1 - g2) ** 2) + ((b1 - b2) ** 2));
  return dist <= tolerance;
}

function getZipHeatSnapshot() {
  try {
    const raw = localStorage.getItem('lapuff_zip_heat');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function heatTagColor(value) {
  const v = Number(value || 0);
  if (v >= 0.8) return '#fecaca';
  if (v >= 0.55) return '#fed7aa';
  if (v >= 0.3) return '#fef08a';
  if (v >= 0.12) return '#bbf7d0';
  return '#a5f3fc';
}

function buildBoroughHeatMap(zipHeat) {
  const out = {};
  BOROUGHS.forEach((borough) => {
    const zips = BOROUGH_ZIPS[borough] || [];
    const vals = zips
      .map((z) => Number(zipHeat?.[z.zip]))
      .filter((n) => Number.isFinite(n));
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    out[borough] = avg;
  });
  return out;
}

function getBoroughForZip(zip) {
  if (!zip) return null;
  const match = NYC_ZIP_FEATURES.find((feature) => feature.zip === zip);
  return match?.borough || null;
}

function makeStableSampleUuid(index, variant = '8') {
  const n = Number(index || 0).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-${variant}000-${n}`;
}

function isAnonymousAuthor(entity) {
  const username = String(entity?.username || '').trim().toLowerCase();
  if (username === 'anonymous') return true;
  if (entity?.user_id) return false;
  // Unsigned rows often come through with null user_id + empty username.
  return username.length === 0;
}

const SAMPLE_ZIP_CHOICES = [
  { borough: 'Manhattan', zip: '10002' },
  { borough: 'Manhattan', zip: '10027' },
  { borough: 'Brooklyn', zip: '11211' },
  { borough: 'Brooklyn', zip: '11201' },
  { borough: 'Queens', zip: '11101' },
  { borough: 'Queens', zip: '11354' },
  { borough: 'Bronx', zip: '10453' },
  { borough: 'Bronx', zip: '10463' },
  { borough: 'Staten Island', zip: '10301' },
  { borough: 'Staten Island', zip: '10314' },
];

const SAMPLE_FILL_COLORS = [
  '#ffffff', '#111827', '#fef3c7', '#ecfeff', '#dcfce7', '#fee2e2', '#ede9fe', '#fce7f3', '#e0f2fe', '#ecfccb',
  '#0f172a', '#3f3f46', '#451a03', '#052e16', '#083344', '#4c1d95', '#831843', '#faf5ff', '#f8fafc', '#fff7ed',
];
const SAMPLE_OUTLINE_COLORS = [
  '#111827', '#dc2626', '#f97316', '#eab308', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#0f766e',
];
const SAMPLE_SHADOW_COLORS = [
  '#000000', '#1f2937', '#7f1d1d', '#78350f', '#166534', '#155e75', '#1d4ed8', '#6d28d9', '#9d174d', '#334155',
];

function buildSamplePosts() {
  const now = Date.now();
  const scopes = ['digital', 'nyc', 'borough', 'zip'];
  const posts = [];

  for (let i = 0; i < 50; i += 1) {
    const idx = i + 1;
    const scope = scopes[i % scopes.length];
    const place = SAMPLE_ZIP_CHOICES[i % SAMPLE_ZIP_CHOICES.length];
    const statusMode = i % 3; // 0=participant, 1=orbiter, 2=anonymous

    const isParticipant = statusMode === 0;
    const isAnonymous = statusMode === 2;
    const userId = null;
    const username = isAnonymous ? 'anonymous' : `sample_user_${idx}`;

    const fill = SAMPLE_FILL_COLORS[i % SAMPLE_FILL_COLORS.length];
    const outline = SAMPLE_OUTLINE_COLORS[i % SAMPLE_OUTLINE_COLORS.length];
    const shadow = SAMPLE_SHADOW_COLORS[i % SAMPLE_SHADOW_COLORS.length];

    const borough = scope === 'borough' || scope === 'zip' ? place.borough : null;
    const zip = scope === 'zip' ? place.zip : null;

    let imageUrl = null;
    if (i % 4 !== 0) {
      if (i % 3 === 0) imageUrl = `https://picsum.photos/seed/lapuff-v-${idx}/640/960`; // vertical
      else if (i % 3 === 1) imageUrl = `https://picsum.photos/seed/lapuff-h-${idx}/960/540`; // horizontal
      else imageUrl = `https://picsum.photos/seed/lapuff-s-${idx}/700/700`; // square
    }

    // Yesterday -> ~5 months ago (about 150 days)
    const daysAgo = 1 + (i * 3);
    const createdAt = new Date(now - daysAgo * 86400000 - (i % 6) * 3600000).toISOString();

    posts.push({
      id: makeStableSampleUuid(idx, '8'),
      user_id: userId,
      username,
      is_participant: isParticipant,
      scope,
      borough,
      zip_code: zip,
      image_url: imageUrl,
      content: {
        html: `<b>Sample GeoPost #${idx}</b><br/>Testing ${scope.toUpperCase()} scope in ${borough || 'NYC-wide'} ${zip ? `(${zip})` : ''} with mixed media + style colors.`,
        textColor: contrastTextColor(fill),
      },
      post_fill: fill,
      post_outline: outline,
      post_shadow: shadow,
      total_reactions: (idx * 7) % 53,
      created_at: createdAt,
      post_approved: true,
    });
  }

  return posts;
}

const SAMPLE_POSTS = buildSamplePosts();
const SAMPLE_POST_IDS = new Set(SAMPLE_POSTS.map((post) => post.id));
const SAMPLE_POSTS_BY_ID = new Map(SAMPLE_POSTS.map((post) => [post.id, post]));

function buildSampleComments(samplePosts) {
  const base = [];
  const p = samplePosts.map((entry) => entry.id);
  const commentSeeds = [
    { postId: p[0], main: 3, replies: [2, 5, 1] },
    { postId: p[1], main: 2, replies: [0, 4] },
    { postId: p[2], main: 1, replies: [6] },
    { postId: p[3], main: 4, replies: [1, 0, 2, 3] },
    { postId: p[4], main: 2, replies: [3, 0] },
    { postId: p[5], main: 1, replies: [2] },
    { postId: p[6], main: 3, replies: [0, 0, 4] },
    { postId: p[7], main: 2, replies: [1, 5] },
  ];
  let counter = 1;
  commentSeeds.forEach((seed, seedIdx) => {
    for (let i = 0; i < seed.main; i += 1) {
      const id = makeStableSampleUuid(counter++, '9');
      const mode = (seedIdx + i) % 3;
      const isAnonymous = mode === 2;
      const isParticipant = mode === 0;
      const place = SAMPLE_ZIP_CHOICES[(seedIdx + i) % SAMPLE_ZIP_CHOICES.length];
      base.push({
        id,
        post_id: seed.postId,
        parent_id: null,
        user_id: null,
        username: isAnonymous ? 'anonymous' : `commenter_${counter}`,
        content: `Sample comment ${i + 1} on ${seed.postId} with ${isParticipant ? 'participant' : isAnonymous ? 'anonymous' : 'orbiter'} context.`,
        is_participant: isParticipant,
        borough: isAnonymous ? null : place.borough,
        zip_code: isAnonymous ? null : (i % 2 === 0 ? place.zip : null),
        created_at: new Date(Date.now() - (seedIdx + i + 2) * 3600000).toISOString(),
      });
      const replyCount = seed.replies[i] || 0;
      for (let r = 0; r < replyCount; r += 1) {
        const rid = makeStableSampleUuid(counter++, 'a');
        const replyAnon = (r + i) % 4 === 3;
        base.push({
          id: rid,
          post_id: seed.postId,
          parent_id: id,
          user_id: null,
          username: replyAnon ? 'anonymous' : `replier_${counter}`,
          content: `Reply ${r + 1} in the subthread for ${id}.`,
          is_participant: (r % 2) === 0,
          borough: replyAnon ? null : place.borough,
          zip_code: replyAnon ? null : (r % 2 === 0 ? place.zip : null),
          created_at: new Date(Date.now() - (seedIdx + i + r + 3) * 1800000).toISOString(),
        });
      }
    }
  });
  return base;
}

function buildSampleCommentReactions(comments) {
  const emojis = ['😀', '🔥', '😮', '😭', '🤝', '💯'];
  const reactions = [];
  comments.forEach((comment, idx) => {
    const count = idx % 3;
    for (let i = 0; i <= count; i += 1) {
      reactions.push({
        comment_id: comment.id,
        emoji: emojis[(idx + i) % emojis.length],
        user_id: i === count && idx % 4 === 0 ? null : `sample-reactor-${idx}-${i}`,
        profiles: i === count && idx % 4 === 0 ? null : { username: `reactor_${idx}_${i}` },
      });
    }
  });
  return reactions;
}

const SAMPLE_COMMENTS = buildSampleComments(SAMPLE_POSTS);
const SAMPLE_COMMENT_REACTIONS = buildSampleCommentReactions(SAMPLE_COMMENTS);

// Anonymous reaction dedup via localStorage (prevents refresh-spam without accounts)
const ANON_REACTIONS_KEY = 'lapuff_geo_anon_reactions';
const ANON_COMMENT_REACTIONS_KEY = 'lapuff_geo_anon_comment_reactions';
function getAnonSet() {
  try { return new Set(JSON.parse(localStorage.getItem(ANON_REACTIONS_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveAnonSet(s) { localStorage.setItem(ANON_REACTIONS_KEY, JSON.stringify([...s])); }
function getAnonCommentSet() {
  try { return new Set(JSON.parse(localStorage.getItem(ANON_COMMENT_REACTIONS_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveAnonCommentSet(s) { localStorage.setItem(ANON_COMMENT_REACTIONS_KEY, JSON.stringify([...s])); }

// ── PortalPopup ───────────────────────────────────────────────────────────────
// Renders children via createPortal, positioned near a trigger button.
// Appears above the button if there's not enough space below.
function PortalPopup({ btnRef, open, onClose, children, alignRight = false, minWidth = 160 }) {
  const popupRef = useRef(null);
  const [style, setStyle] = useState({ position: 'fixed', zIndex: 999999, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open || !btnRef?.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popH = popupRef.current?.offsetHeight || 280;
    const popW = popupRef.current?.offsetWidth || minWidth;
    const showAbove = window.innerHeight - rect.bottom < popH + 8;
    let left = alignRight ? rect.right - popW : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    setStyle({
      position: 'fixed',
      zIndex: 999999,
      visibility: 'visible',
      left,
      ...(showAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, [open, alignRight, minWidth]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef?.current?.contains(e.target)) return;
      if (popupRef.current?.contains(e.target)) return;
      onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(<div ref={popupRef} style={style}>{children}</div>, document.body);
}

// ── HexColorPicker ─────────────────────────────────────────────────────────────
// Includes native OS color wheel (input type=color) + preset grid + hex input.
function HexColorPicker({ value, onChange, onClose }) {
  const [hex, setHex] = useState((value || '#000000').replace('#', ''));
  const isValid = (h) => /^[0-9a-fA-F]{6}$/.test(h);
  const fullHex = isValid(hex) ? '#' + hex : '#000000';
  return (
    <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] p-2 w-[200px]">
      {/* Native OS color wheel — click the swatch to open browser color picker */}
      <div className="relative mb-2 rounded-lg overflow-hidden border-2 border-black h-9 cursor-pointer">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
          style={{ background: fullHex }}>
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-black/40 text-white">🎨 Color Wheel</span>
        </div>
        <input type="color" value={fullHex}
          onChange={e => { const v = e.target.value.replace('#', ''); setHex(v); onChange(e.target.value); }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
      {/* Preset swatches */}
      <div className="grid grid-cols-6 gap-1 mb-2">
        {PRESET_COLORS.map(c => (
          <button key={c} onMouseDown={e => e.preventDefault()}
            onClick={() => { const v = c.replace('#',''); setHex(v); onChange(c); onClose(); }}
            className="w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform"
            style={{ background: c, outline: (fullHex === c) ? '2px solid #7C3AED' : 'none' }} />
        ))}
      </div>
      {/* Hex text input */}
      <div className="flex items-center gap-1">
        <span className="font-black text-[10px]">#</span>
        <input value={hex} maxLength={6}
          onChange={e => { const v = e.target.value; setHex(v); if (isValid(v)) onChange('#' + v); }}
          className="flex-1 border-2 border-black rounded px-1 text-[11px] font-mono w-0"
          style={{ background: isValid(hex) ? '#' + hex : '#fff', color: isValid(hex) && parseInt(hex, 16) < 0x808080 ? '#fff' : '#000' }} />
        <button onMouseDown={e => e.preventDefault()}
          onClick={() => { if (isValid(hex)) { onChange('#' + hex); onClose(); } }}
          className="px-1.5 py-0.5 bg-black text-white rounded text-[10px] font-black">OK</button>
      </div>
    </div>
  );
}

// ── LocationSelector ──────────────────────────────────────────────────────────
// Tree: Digital | NYC → Borough▼ → Zip▼ (max 2 elements visible at once)
function LocationSelector({ scope, setScope, borough, setBorough, zip, setZip, accentColor }) {
  const [boroughOpen, setBoroughOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  const boroughBtnRef = useRef(null);
  const zipBtnRef = useRef(null);
  const zipList = BOROUGH_ZIPS[borough] || [];

  const pill = (emoji, label, onClick) => (
    <button onMouseDown={e => e.preventDefault()} onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 rounded-full border-2 border-black text-[11px] font-black shadow-[2px_2px_0px_black] transition-all hover:opacity-80"
      style={{ background: accentColor, color: '#fff', borderColor: accentColor }}>
      {emoji && <span>{emoji}</span>}
      <span>{label}</span>
      <span className="ml-0.5 opacity-70 text-sm leading-none">×</span>
    </button>
  );

  const ghostBtn = (ref, label, onClick) => (
    <button ref={ref} onMouseDown={e => e.preventDefault()} onClick={onClick}
      className="px-2.5 py-1 rounded-full border-2 border-dashed border-gray-400 text-[11px] font-black text-gray-400 italic bg-white hover:border-gray-600 hover:text-gray-600 transition-all shadow-[1px_1px_0px_#ccc]">
      {label} ▾
    </button>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-black text-gray-700">
        <strong>You</strong> can post at the zip, borough, or city level
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-black text-gray-500">Posting to:</span>

        {/* DIGITAL scope — hidden when nyc/borough/zip */}
        {scope === 'digital' && (
          <>
            <button onMouseDown={e => e.preventDefault()} onClick={() => {}}
              className="px-2.5 py-1 rounded-full border-2 border-black text-[11px] font-black shadow-[2px_2px_0px_black]"
              style={{ background: accentColor, color: '#fff' }}>
              💻 Digital
            </button>
            <button onMouseDown={e => e.preventDefault()} onClick={() => { setScope('nyc'); setBorough('Manhattan'); setZip(''); }}
              className="px-2.5 py-1 rounded-full border-2 border-black text-[11px] font-black bg-white hover:opacity-80 transition-all shadow-[2px_2px_0px_black]">
              🗽 NYC
            </button>
          </>
        )}

        {/* NYC scope — show NYC pill + Borough ghost */}
        {scope === 'nyc' && (
          <>
            {pill('🗽', 'NYC', () => { setScope('digital'); setBorough('Manhattan'); setZip(''); })}
            <div className="relative">
              {ghostBtn(boroughBtnRef, 'Borough', () => setBoroughOpen(v => !v))}
              <PortalPopup btnRef={boroughBtnRef} open={boroughOpen} onClose={() => setBoroughOpen(false)} minWidth={150}>
                <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                  {BOROUGHS.map(b => (
                    <button key={b} onMouseDown={e => e.preventDefault()}
                      onClick={() => { setBorough(b); setScope('borough'); setZip(''); setBoroughOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 whitespace-nowrap">
                      {b}
                    </button>
                  ))}
                </div>
              </PortalPopup>
            </div>
          </>
        )}

        {/* BOROUGH scope — show borough pill + Zip ghost */}
        {scope === 'borough' && (
          <>
            {pill('🏙', borough, () => { setScope('nyc'); setZip(''); })}
            <div className="relative">
              {ghostBtn(zipBtnRef, 'Zip Region', () => setZipOpen(v => !v))}
              <PortalPopup btnRef={zipBtnRef} open={zipOpen} onClose={() => setZipOpen(false)} minWidth={190}>
                <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden" style={{ maxHeight: 200, overflowY: 'auto', width: 220 }}>
                  {zipList.map(z => (
                    <button key={z.zip} onMouseDown={e => e.preventDefault()}
                      onClick={() => { setZip(z.zip); setScope('zip'); setZipOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 whitespace-nowrap">
                      {z.zip} <span className="font-normal text-gray-400">{z.name}</span>
                    </button>
                  ))}
                </div>
              </PortalPopup>
            </div>
          </>
        )}

        {/* ZIP scope — just the zip pill */}
        {scope === 'zip' && (
          pill('📍', zip, () => { setScope('borough'); setZip(''); })
        )}
      </div>
    </div>
  );
}

// ── Align icons ───────────────────────────────────────────────────────────────
const AlignLeftIcon   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="10" height="2" rx="1"/><rect x="1" y="12" width="12" height="2" rx="1"/></svg>;
const AlignCenterIcon = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="1"/><rect x="3" y="7" width="10" height="2" rx="1"/><rect x="2" y="12" width="12" height="2" rx="1"/></svg>;
const AlignRightIcon  = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="1"/><rect x="5" y="7" width="10" height="2" rx="1"/><rect x="3" y="12" width="12" height="2" rx="1"/></svg>;

// ── PostDetailPopup ───────────────────────────────────────────────────────────
function PostDetailPopup({ post, postReactions, onReact, onOpenReactors, accentColor, onSelectTag, onClose, comments, onSubmitComment, session }) {
  const { resolvedTheme } = useSiteTheme();
  const bgColor = resolvedTheme?.pageBgColor || '#FAFAF8';
  const surfaceBg = resolvedTheme?.surfaceBgColor || '#FFFFFF';
  const bodyTextColor = resolvedTheme?.bodyTextColor || '#000000';

  const theme = getPostVisualTheme(post, resolvedTheme);
  const fillBg = theme.fill || surfaceBg;
  const fillLuminance = luminanceFromHex(fillBg) || 0;
  const chromeBg = fillLuminance < 0.35 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
  const chromeText = fillLuminance < 0.35 ? '#fff' : bodyTextColor;
  const chromeBorder = fillLuminance < 0.35 ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)';

  const [imgLoaded, setImgLoaded] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentsExpanded, setCommentsExpanded] = useState(true);

  const parsedContent = useMemo(() => {
    try { return typeof post.content === 'string' ? JSON.parse(post.content) : (post.content || {}); } catch { return {}; }
  }, [post.content]);
  const postHtml = parsedContent.html || '';
  const postTextColor = normalizeHexColor(parsedContent.textColor || '', bodyTextColor);
  const postIsAnonymous = !post.user_id;
  const statusStyle = post.is_participant
    ? { background: '#00cc66', color: '#fff' }
    : postIsAnonymous
    ? { background: '#333', color: '#fff' }
    : { background: '#ff4444', color: '#fff' };

  const dateStr = post.created_at
    ? new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const timeStr = post.created_at
    ? new Date(post.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  const reactions = postReactions || [];
  const reactionMap = {};
  reactions.forEach(r => { reactionMap[r.emoji_text] = (reactionMap[r.emoji_text] || 0) + 1; });
  const topEmojis = Object.entries(reactionMap).sort((a,b) => b[1]-a[1]);

  const [imgRatio, setImgRatio] = useState(1);
  const isNarrowImage = post.image_url && imgRatio < (9/16);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const locationLabel = (() => {
    if (post.zip_code) return `📍 ${post.zip_code}${post.borough ? ' · ' + post.borough : ''}`;
    if (post.borough) return `🏙 ${post.borough}`;
    if (post.scope === 'nyc') return '🗽 NYC';
    return '💻 Digital';
  })();

  return createPortal(
    <div
      className="fixed inset-0 z-[100010] flex items-start justify-center"
      style={{ overflowY: 'auto', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative my-8 mx-4 rounded-2xl border-3 border-black shadow-[8px_8px_0px_black] flex flex-col overflow-hidden"
        style={{ background: surfaceBg, width: '100%', maxWidth: 600, minWidth: 0, transform: 'translateZ(0)', isolation: 'isolate' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-black text-lg hover:scale-110 transition-transform"
        >×</button>

        {post.image_url && (
          <div
            className="relative w-full overflow-hidden rounded-t-2xl bg-black/5"
            style={{
              isolation: 'isolate',
              transform: 'translateZ(0)',
              ...(isNarrowImage
                ? { aspectRatio: '9/16', maxHeight: 480 }
                : { maxHeight: 520 }),
            }}
          >
            <img
              src={post.image_url}
              alt="post"
              className={`w-full object-contain transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
              style={{ display: 'block' }}
              onLoad={(e) => {
                try { setImgRatio(e.target.naturalWidth / e.target.naturalHeight); } catch {}
                setImgLoaded(true);
              }}
            />
            {!imgLoaded && <div className="absolute inset-0 animate-pulse bg-black/5" />}
          </div>
        )}

        <div className="p-4 flex flex-col gap-3" style={{ backgroundColor: fillBg }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-sm" style={{ color: chromeText }}>
              {postIsAnonymous ? '🎭 Anonymous' : post.username || 'Orbiter'}
            </span>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={statusStyle}>
              ● {post.is_participant ? 'PARTICIPANT' : postIsAnonymous ? 'ANON' : 'ORBITER'}
            </span>
            <span className="text-xs ml-auto opacity-60" style={{ color: chromeText }}>{dateStr} · {timeStr}</span>
          </div>

          <div
            className="break-words [&>*]:m-0 [&>*]:p-0 text-sm"
            style={{ color: postTextColor, lineHeight: 1.6, wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: postHtml }}
          />

          <div className="flex items-center gap-1.5 flex-wrap">
            {topEmojis.map(([emoji, count]) => (
              <button key={emoji} onMouseDown={e => e.preventDefault()} onClick={() => onReact(post.id, emoji)}
                className="flex items-center gap-0.5 px-2 py-0.5 rounded-full border-2 text-sm font-black hover:scale-105 transition-transform"
                style={{ background: chromeBg, color: chromeText, borderColor: chromeBorder }}>
                {emoji}<span className="text-xs">{count}</span>
              </button>
            ))}
            <button onMouseDown={e => e.preventDefault()} onClick={() => onOpenReactors(post.id)}
              className="px-2 py-0.5 rounded-full border-2 text-[10px] font-black"
              style={{ background: chromeBg, color: chromeText, borderColor: chromeBorder }}>+</button>
            {topEmojis.length > 0 && (
              <button onMouseDown={e => e.preventDefault()} onClick={() => onOpenReactors(post.id)}
                className="px-2 py-0.5 rounded-full border-2 text-[10px] font-black"
                style={{ background: chromeBg, color: chromeText, borderColor: chromeBorder }}>…</button>
            )}
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onSelectTag && onSelectTag({ scope: post.scope, borough: post.borough, zip_code: post.zip_code }); onClose(); }}
              className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-black border hover:opacity-80"
              style={{ background: chromeBg, color: chromeText, borderColor: chromeBorder }}
            >
              {locationLabel}
            </button>
          </div>

          <div className="pt-3" style={{ borderTop: `2px solid ${chromeBorder}` }}>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => setCommentsExpanded(v => !v)}
              className="text-xs font-black mb-2 hover:underline"
              style={{ color: chromeText }}
            >
              💬 Comments {commentsExpanded ? '▲' : '▼'}
            </button>
            {commentsExpanded && (
              <div className="flex flex-col gap-2">
                {(comments || []).map(c => (
                  <div key={c.id} className="rounded-xl p-2" style={{ background: chromeBg, border: `1px solid ${chromeBorder}` }}>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[10px] font-black" style={{ color: chromeText }}>{c.username || 'Orbiter'}</span>
                      <span className="text-[9px] opacity-50 ml-auto" style={{ color: chromeText }}>{c.created_at ? new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''}</span>
                    </div>
                    <div className="text-xs" style={{ color: chromeText }}>{c.text || c.content}</div>
                  </div>
                ))}
                {(comments || []).length === 0 && (
                  <p className="text-xs opacity-50 text-center py-2" style={{ color: chromeText }}>No comments yet</p>
                )}
                <div className="flex gap-2 mt-1">
                  <input
                    value={commentDraft}
                    onChange={e => setCommentDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && commentDraft.trim()) { onSubmitComment(post.id, commentDraft.trim()); setCommentDraft(''); } }}
                    placeholder="Add a comment..."
                    className="flex-1 px-3 py-1.5 border-2 rounded-lg text-xs font-black"
                    style={{ borderColor: chromeBorder, background: chromeBg, color: chromeText }}
                  />
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { if (commentDraft.trim()) { onSubmitComment(post.id, commentDraft.trim()); setCommentDraft(''); } }}
                    className="px-3 py-1.5 border-2 border-black rounded-lg text-xs font-black"
                    style={{ background: accentColor, color: '#fff' }}
                  >Post</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── GeoPostMosaic ─────────────────────────────────────────────────────────────
function GeoPostMosaic({ posts, accentColor, opacity = 0.42 }) {
  const COLS = 16;
  const ROWS = 6;
  const TOTAL = COLS * ROWS; // 96

  const imagePosts = useMemo(() => {
    const imgs = posts.filter(p => p.image_url).slice(0, TOTAL);
    return imgs;
  }, [posts, TOTAL]);

  const tiles = useMemo(() => {
    const result = [];
    for (let i = 0; i < TOTAL; i++) {
      result.push(imagePosts[i] || null);
    }
    return result;
  }, [imagePosts, TOTAL]);

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 0, borderRadius: 'inherit' }}
      aria-hidden="true"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          width: '100%',
          height: '100%',
          opacity: opacity,
          imageRendering: 'pixelated',
        }}
      >
        {tiles.map((post, idx) => (
          <div key={idx} style={{ overflow: 'hidden', aspectRatio: '1 / 1', width: '100%' }}>
            {post ? (
              <img
                src={post.image_url}
                alt=""
                loading="lazy"
                width={56}
                height={56}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  imageRendering: 'pixelated',
                }}
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                background: '#1a6bbf',
                border: '0.5px solid rgba(0,0,0,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
              }}>🌍</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PostCard ──────────────────────────────────────────────────────────────────
function PostCard({ post, postReactions, onReact, onOpenReactors, accentColor, onSelectTag, zipHeatMap, boroughHeatMap, textScale = 1, imageScale = 1, imagePriority = false, isDesktopMasonry = false, gridUnitHeight = 0, commentCount = 0, commentsOpen = false, onToggleComments, commentsChildren, onOpenPopup }) {
  const { resolvedTheme } = useSiteTheme();
  const theme = getPostVisualTheme(post, resolvedTheme);
  const date = new Date(post.created_at);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const emojiCounts = {};
  (postReactions || []).forEach((r) => { emojiCounts[r.emoji_text] = (emojiCounts[r.emoji_text] || 0) + 1; });
  const topEmojis = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const [qepAnchorRect, setQepAnchorRect] = useState(null);
  const qepBtnRef = useRef(null);
  const [imgRatio, setImgRatio] = useState(1);
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [isTextOverflowing, setIsTextOverflowing] = useState(false);
  const textBlockRef = useRef(null);
  // content can be a JSONB object or, rarely, a double-encoded JSON string
  const parsedContent = (() => {
    const c = post.content;
    if (c && typeof c === 'object') return c;
    try { return JSON.parse(c); } catch { return {}; }
  })();
  const postHtml = parsedContent.html || (typeof post.content === 'string' ? post.content : '') || '';
  const postTextColor = normalizeHexColor(parsedContent.textColor || '', theme.text);
  const postIsAnonymous = isAnonymousAuthor(post);

  const fillIsNearRedOrGreen = isNearColor(theme.fill, '#ef4444') || isNearColor(theme.fill, '#22c55e');

  const statusStyle = post.is_participant
    ? { background: '#22c55e', color: '#fff', border: fillIsNearRedOrGreen ? '1px solid #000' : '1px solid transparent' }
    : postIsAnonymous
      ? { background: '#374151', color: '#f3f4f6', border: '1px solid transparent' }
      : { background: '#ef4444', color: '#fff', border: fillIsNearRedOrGreen ? '1px solid #000' : '1px solid transparent' };

  const boroughTagBg = post.borough ? heatTagColor(boroughHeatMap?.[post.borough] || 0) : '#f3f4f6';
  const zipTagBg = post.zip_code ? heatTagColor(zipHeatMap?.[post.zip_code] || 0) : '#f3f4f6';
  const boroughTagText = contrastTextColor(boroughTagBg);
  const zipTagText = contrastTextColor(zipTagBg);

  const outlineButtonStyle = {
    borderColor: theme.text,
    backgroundColor: theme.fill,
    color: theme.text,
  };
  const frameRatio = (16 / 9) / Math.max(0.5, Number(imageScale || 1));
  const isNonStandardFrame = Math.abs(imgRatio - frameRatio) > 0.08;
  const scale = Math.max(0.6, Math.min(2, Number(textScale || 1)));
  // Unitless line-height scales with font-size — webkit-line-clamp alone controls how many lines show
  const textLineHeight = 1.5;
  const textFontSizeRem = 0.875 * scale;           // 14px base * scale (for UI chrome only)
  const hasImage = Boolean(post.image_url);
  const shape = hasImage
    ? (imgRatio < 0.85 ? 'portrait' : imgRatio > 1.25 ? 'landscape' : 'square')
    : 'square';
  const isTallTile = hasImage && shape === 'portrait';
  const isLongTile = hasImage && shape === 'landscape';
  const columnSpan = isLongTile ? 4 : 2;

  // Advanced gridding with bisected half-rows
  const plainTextLength = postHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
  const CHARS_PER_STD_LINE_2COL = 35;
  const CHARS_PER_STD_LINE_4COL = 70;
  const estLinesAt2col = Math.ceil(plainTextLength / CHARS_PER_STD_LINE_2COL);
  const estLinesAt4col = Math.ceil(plainTextLength / CHARS_PER_STD_LINE_4COL);

  let finalColSpan = columnSpan;
  let finalRowSpan = isTallTile ? 4 : 2;

  if (!hasImage) {
    if (estLinesAt2col <= 5) {
      finalRowSpan = 1;
    } else if (estLinesAt2col > 20) {
      finalColSpan = 4;
      finalRowSpan = 2;
    } else {
      finalRowSpan = 2;
    }
  } else if (isTallTile) {
    finalRowSpan = 4;
  } else if (isLongTile) {
    if (estLinesAt4col > 3) {
      finalRowSpan = 3;
    } else {
      finalRowSpan = 2;
    }
  } else {
    if (estLinesAt2col > 3) {
      finalRowSpan = 3;
    } else {
      finalRowSpan = 2;
    }
  }

  const rowSpan = finalRowSpan + (commentsOpen && isDesktopMasonry ? 2 : 0);
  const maxTextLines = isTallTile ? 9 : (finalRowSpan === 3) ? 4 : hasImage ? 3 : (finalRowSpan === 1 ? 3 : 9);
  // Fixed pixel budget: 16px (browser normal font) × 1.5 line-height × maxTextLines × slider scale
  const maxBudgetPx = Math.floor(16 * scale * textLineHeight) * maxTextLines;
  const tileGridStyle = {
    gridColumn: `span ${finalColSpan}`,
    gridRow: `span ${rowSpan}`,
  };

  useEffect(() => {
    if (!imgModalOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setImgModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imgModalOpen]);

  useEffect(() => {
    const el = textBlockRef.current;
    if (!el) return undefined;

    const applySnap = () => {
      // 1. Measure full content height
      el.style.maxHeight = 'none';
      const fullH = el.scrollHeight;

      if (fullH <= maxBudgetPx) {
        // Content fits — let overflow:hidden do the rest, nothing to clip
        el.style.maxHeight = `${maxBudgetPx}px`;
        setIsTextOverflowing(false);
        return;
      }

      // 2. Content overflows — walk text nodes via Range to find the lowest
      //    line-bottom that is fully within the budget. This handles any mix
      //    of font sizes (size 1-6) without half-line clips.
      const elRect = el.getBoundingClientRect();
      const range = document.createRange();
      let lastCompleteLine = 0;

      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            const lineBottom = r.bottom - elRect.top;
            if (lineBottom <= maxBudgetPx + 0.5) {
              lastCompleteLine = Math.max(lastCompleteLine, Math.ceil(lineBottom));
            }
          }
        }
        node.childNodes?.forEach(walk);
      };

      el.style.maxHeight = 'none'; // keep none so rects are accurate
      walk(el);

      const snapped = lastCompleteLine > 0 ? lastCompleteLine : maxBudgetPx;
      el.style.maxHeight = `${snapped}px`;
      setIsTextOverflowing(true);
    };

    applySnap();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', applySnap);
      return () => window.removeEventListener('resize', applySnap);
    }
    const ro = new ResizeObserver(applySnap);
    ro.observe(el);
    return () => ro.disconnect();
  }, [postHtml, maxBudgetPx, isDesktopMasonry, commentsOpen]);

  return (
    <div
      className="rounded-2xl border-3 overflow-hidden"
      style={{
        background: theme.fill,
        borderColor: theme.outline,
        boxShadow: `4px 4px 0px ${theme.shadow}`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 2000ms cubic-bezier(0.16, 1, 0.3, 1)',
        ...tileGridStyle,
      }}
    >
      {post.image_url && (
        // flex: 1 — image grows elastically to fill all remaining tile space the footer doesn't claim.
        // No maxHeight so the image truly fills: tall tiles use 2 rows (~840px), short use 1 row (~420px).
        <div
          className="relative w-full overflow-hidden bg-black/5"
          style={isDesktopMasonry
            ? { flex: 1, minHeight: 80, position: 'relative', cursor: onOpenPopup ? 'pointer' : 'default' }
            : { height: 0, paddingBottom: shape === 'portrait' ? '110%' : shape === 'landscape' ? '48%' : '72%', cursor: onOpenPopup ? 'pointer' : 'default' }
          }
          onClick={() => onOpenPopup && onOpenPopup(post)}
        >
          <img
            src={post.image_url}
            alt="post"
            className={`absolute inset-0 block w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading={imagePriority ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={(e) => {
              try { setImgRatio(e.target.naturalWidth / e.target.naturalHeight); } catch {}
              setImgLoaded(true);
            }}
            onClick={() => {}}
          />
          {!imgLoaded && <div className="absolute inset-0 animate-pulse bg-black/5" />}
        </div>
      )}

      {/* footer: flex-1 on no-image tiles so reactions can pin to bottom; flex-shrink-0 when image is present */}
      <div className="p-3" style={{ background: theme.fill, flex: hasImage ? '0 0 auto' : '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div className="flex items-center gap-1 mb-1 overflow-hidden" style={{ flexWrap: 'nowrap', minWidth: 0, flexShrink: 0 }}>
          {postIsAnonymous ? (
            <span className="font-black text-xs flex items-center gap-1 flex-shrink" style={{ color: theme.text, fontSize: `${12 * scale}px`, minWidth: 0, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'currentColor', flexShrink: 0 }}>
                <rect x="2" y="9" width="16" height="2.5" rx="1.25" fill="currentColor" />
                <rect x="5" y="3" width="10" height="7" rx="1.5" fill="currentColor" />
                <circle cx="9.5" cy="15" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
              Anonymous
            </span>
          ) : (
            <span className="font-black text-xs" style={{ color: theme.text, fontSize: `${12 * scale}px`, minWidth: 0, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{post.username || 'Orbiter'}</span>
          )}

          <span
            onClick={() => onSelectTag && onSelectTag({ status: postIsAnonymous ? 'anonymous' : post.is_participant ? 'participant' : 'orbiter' })}
            className="text-[9px] font-black px-1.5 py-0.5 rounded-full cursor-pointer"
            style={{ ...statusStyle, fontSize: `${9 * scale}px`, flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            ● {post.is_participant ? (finalColSpan <= 2 ? 'PAR' : 'PARTICIPANT') : postIsAnonymous ? 'ANON' : (finalColSpan <= 2 ? 'ORB' : 'ORBITER')}
          </span>

          <span className="text-[9px] ml-auto" style={{ color: theme.text, fontSize: `${9 * scale}px`, flexShrink: 0, whiteSpace: 'nowrap' }}>{dateStr} · {timeStr}</span>
        </div>

        <div
          ref={textBlockRef}
          className="mb-2 break-words [&>*]:m-0 [&>*]:p-0"
          style={{
            color: postTextColor,
            fontSize: `${textFontSizeRem}rem`,
            lineHeight: textLineHeight,
            overflow: 'hidden',
            // Initial maxHeight set as budget; snap useEffect refines it to last complete line
            maxHeight: `${maxBudgetPx}px`,
            wordBreak: 'break-word',
            flex: '0 0 auto',
            minHeight: 0,
            cursor: onOpenPopup ? 'pointer' : 'default',
          }}
          onClick={() => onOpenPopup && onOpenPopup(post)}
          dangerouslySetInnerHTML={{ __html: postHtml }}
        />

        {isTextOverflowing && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="self-start text-[11px] font-black underline decoration-2"
            style={{ color: theme.text, marginTop: 2 }}
          >
            Show more
          </button>
        )}

        {/* spacer pushes reaction/tag row to bottom of the tile */}
        <div style={{ flex: 1, minHeight: 4 }} />

        <div className="flex items-center gap-1 flex-wrap" style={{ flexShrink: 0 }}>
          {topEmojis.map(([emoji, count]) => (
            <button
              key={emoji}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onReact(post.id, emoji)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-full border-2 text-xs font-black hover:scale-105 transition-transform"
              style={post.post_fill ? { ...outlineButtonStyle, fontSize: `${11 * scale}px` } : { borderColor: '#000', backgroundColor: '#f3f4f6', color: '#000', fontSize: `${11 * scale}px` }}
            >
              {emoji}<span className="text-[10px]">{count}</span>
            </button>
          ))}

          <button
            ref={qepBtnRef}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (qepAnchorRect) { setQepAnchorRect(null); return; }
              const rect = qepBtnRef.current.getBoundingClientRect();
              setQepAnchorRect({ top: rect.top, left: rect.left, bottom: rect.bottom });
            }}
            className="px-2 py-0.5 rounded-full border-2 text-xs font-black hover:scale-105 transition-transform"
            style={post.post_fill ? { ...outlineButtonStyle, fontSize: `${11 * scale}px` } : { borderColor: '#000', backgroundColor: '#f3f4f6', color: '#000', fontSize: `${11 * scale}px` }}
          >
            +
          </button>

          {(postReactions?.length > 0) && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onOpenReactors(post.id)}
              className="px-2 py-0.5 rounded-full border-2 text-[10px] font-black hover:scale-105 transition-transform"
              style={post.post_fill ? { ...outlineButtonStyle, fontSize: `${10 * scale}px` } : { borderColor: '#000', backgroundColor: '#f3f4f6', color: '#000', fontSize: `${10 * scale}px` }}
            >
              …
            </button>
          )}

          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onToggleComments && onToggleComments(post.id)}
            className="px-2 py-0.5 rounded-full border-2 text-[10px] font-black hover:scale-105 transition-transform"
            style={post.post_fill ? { ...outlineButtonStyle, fontSize: `${10 * scale}px` } : { borderColor: '#000', backgroundColor: '#f3f4f6', color: '#000', fontSize: `${10 * scale}px` }}
          >
            💬 {commentCount}
          </button>

          <div className="ml-auto flex items-center gap-1">
            {post.scope === 'zip' && post.borough && (
              <span
                onClick={() => onSelectTag && onSelectTag({ ...post, scope: 'borough' })}
                className="text-[9px] font-black px-1.5 py-0.5 rounded-full cursor-pointer"
                style={{ background: boroughTagBg, color: boroughTagText, border: `1px solid ${boroughTagText}`, fontSize: `${9 * scale}px` }}
              >
                🏙 {post.borough}
              </span>
            )}

            <span
              onClick={() => onSelectTag && onSelectTag(post)}
              className="text-[9px] font-black px-1.5 py-0.5 rounded-full cursor-pointer"
              style={post.scope === 'zip' && post.zip_code
                ? { background: zipTagBg, color: zipTagText, border: `1px solid ${zipTagText}`, fontSize: `${9 * scale}px` }
                : post.borough
                  ? { background: boroughTagBg, color: boroughTagText, border: `1px solid ${boroughTagText}`, fontSize: `${9 * scale}px` }
                  : { background: '#f3f4f6', border: '1px solid #d1d5db', color: '#4b5563', fontSize: `${9 * scale}px` }}
            >
              {post.scope === 'zip' && post.zip_code
                ? `📍 ${post.zip_code}`
                : post.borough
                  ? `🏙 ${post.borough}`
                  : post.scope === 'nyc'
                    ? '🗽 NYC'
                    : '💻 Digital'}
            </span>
          </div>
        </div>

        {commentsOpen && (
          <div className="mt-2 max-h-72 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg" style={{ scrollbarWidth: 'thin' }}>
            {commentsChildren}
          </div>
        )}

        {qepAnchorRect && createPortal(
          <>
            <div className="fixed inset-0 z-[99990]" onClick={() => setQepAnchorRect(null)} />
            <div
              className="fixed z-[99991]"
              style={qepAnchorRect.top > window.innerHeight * 0.5
                ? {
                    bottom: window.innerHeight - qepAnchorRect.top + 4,
                    left: Math.max(4, qepAnchorRect.left - 80),
                  }
                : {
                    top: qepAnchorRect.bottom + 4,
                    left: Math.max(4, qepAnchorRect.left - 80),
                  }
              }
              onMouseDown={e => e.stopPropagation()}
            >
              <EmojiPicker
                embedded={true}
                compact={true}
                value=""
                onChange={(e) => { if (e) { onReact(post.id, e); setQepAnchorRect(null); } }}
              />
            </div>
          </>,
          document.body
        )}
      </div>

      {imgModalOpen && (
        <div className="fixed inset-x-0 top-[72px] bottom-0 z-[100000] overflow-y-auto">
          <div className="absolute inset-0 bg-black/60" onClick={() => setImgModalOpen(false)} />
          <div className="relative mx-auto w-full max-w-5xl border-3 rounded-2xl bg-white mt-3 mb-6" style={{ borderColor: theme.outline }}>
            <img src={post.image_url} alt="full" className="w-full h-auto object-contain" />
            <button onClick={() => setImgModalOpen(false)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white border-2 border-black">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentSection({
  post,
  comments,
  reactionsByComment,
  onSubmitComment,
  onSubmitReply,
  onToggleReaction,
  onOpenReactors,
  zipHeatMap,
  boroughHeatMap,
}) {
  const [draft, setDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyOpen, setReplyOpen] = useState({});
  const [visibleReplies, setVisibleReplies] = useState({});
  const [emojiOpen, setEmojiOpen] = useState(null);

  const mains = comments.filter((c) => !c.parent_id);
  const repliesFor = (commentId) => comments.filter((c) => c.parent_id === commentId);

  const renderReactionBar = (comment) => {
    const list = reactionsByComment[comment.id] || [];
    const counts = {};
    list.forEach((entry) => { counts[entry.emoji] = (counts[entry.emoji] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2);
    return (
      <div className="flex items-center gap-1 flex-wrap mt-2">
        {top.map(([emoji, count]) => (
          <button key={emoji} onMouseDown={(e) => e.preventDefault()} onClick={() => onToggleReaction(comment.id, emoji)} className="px-2 py-0.5 rounded-full border border-black text-[10px] font-black bg-white">
            {emoji} <span className="text-[9px]">{count}</span>
          </button>
        ))}
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => setEmojiOpen((prev) => prev === comment.id ? null : comment.id)} className="px-2 py-0.5 rounded-full border border-black text-[10px] font-black bg-white">+</button>
        {list.length > 0 && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => onOpenReactors(comment.id)} className="px-2 py-0.5 rounded-full border border-black text-[10px] font-black bg-white">…</button>
        )}
        {emojiOpen === comment.id && (
          <div className="mt-1 w-full">
            <EmojiPicker embedded={true} compact={true} value="" onChange={(emoji) => { if (emoji) { onToggleReaction(comment.id, emoji); setEmojiOpen(null); } }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-3 rounded-xl border-2 border-black/10 bg-white/60 p-3">
      <div className="flex gap-2 mb-3" style={{ minWidth: 0 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment..."
          className="flex-1 min-w-0 border-2 border-black rounded px-2 py-1.5 text-xs font-semibold"
        />
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => { if (draft.trim()) { onSubmitComment(post.id, draft.trim()); setDraft(''); } }} className="flex-shrink-0 px-2 py-1.5 rounded-lg border-2 border-black text-xs font-black bg-white">Post</button>
      </div>

      <div className="space-y-3">
        {mains.length === 0 && <p className="text-xs font-semibold text-gray-400">No comments yet.</p>}
        {mains.map((comment) => {
          const subReplies = repliesFor(comment.id);
          const limit = visibleReplies[comment.id] || 3;
          const shownReplies = subReplies.slice(0, limit);
          const isAnon = isAnonymousAuthor(comment);
          return (
            <div key={comment.id} className="rounded-xl border border-black/10 bg-white p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 flex-wrap mb-1">
                    <span className="text-xs font-black">{comment.username || 'anonymous'}</span>
                    {!isAnon && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={comment.is_participant ? { background: '#22c55e', color: '#fff' } : { background: '#ef4444', color: '#fff' }}>
                        {comment.is_participant ? 'PARTICIPANT' : 'ORBITER'}
                      </span>
                    )}
                    {!isAnon && comment.borough && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: heatTagColor(boroughHeatMap?.[comment.borough] || 0), color: contrastTextColor(heatTagColor(boroughHeatMap?.[comment.borough] || 0)) }}>
                        🏙 {comment.borough}
                      </span>
                    )}
                    {!isAnon && comment.zip_code && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: heatTagColor(zipHeatMap?.[comment.zip_code] || 0), color: contrastTextColor(heatTagColor(zipHeatMap?.[comment.zip_code] || 0)) }}>
                        📍 {comment.zip_code}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-gray-400 font-semibold">{new Date(comment.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-xs leading-relaxed break-words">{comment.content}</p>
                  {renderReactionBar(comment)}
                  <div className="mt-2">
                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => setReplyOpen((prev) => ({ ...prev, [comment.id]: !prev[comment.id] }))} className="text-[10px] font-black text-gray-500 hover:text-black">Reply</button>
                  </div>
                  {replyOpen[comment.id] && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={replyDrafts[comment.id] || ''}
                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                        placeholder="Add a reply..."
                        className="flex-1 border border-black rounded px-2 py-1.5 text-[11px] font-semibold"
                      />
                      <button onMouseDown={(e) => e.preventDefault()} onClick={() => {
                        const value = (replyDrafts[comment.id] || '').trim();
                        if (!value) return;
                        onSubmitReply(post.id, comment.id, value);
                        setReplyDrafts((prev) => ({ ...prev, [comment.id]: '' }));
                        setReplyOpen((prev) => ({ ...prev, [comment.id]: false }));
                      }} className="px-2.5 py-1.5 rounded border border-black text-[10px] font-black bg-white">Send</button>
                    </div>
                  )}
                  {shownReplies.length > 0 && (
                    <div className="mt-3 pl-3 border-l-2 border-gray-200 space-y-2">
                      {shownReplies.map((reply) => (
                        <div key={reply.id} className="rounded-lg bg-gray-50 px-2.5 py-2 border border-gray-200">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[11px] font-black">{reply.username || 'anonymous'}</span>
                            <span className="ml-auto text-[9px] text-gray-400 font-semibold">{new Date(reply.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                          </div>
                          <p className="text-[11px] leading-relaxed break-words">{reply.content}</p>
                          {renderReactionBar(reply)}
                        </div>
                      ))}
                      {subReplies.length > 3 && subReplies.length > limit && (
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => setVisibleReplies((prev) => ({ ...prev, [comment.id]: limit + 4 }))} className="text-[10px] font-black text-gray-500 hover:text-black">Show More</button>
                      )}
                      {subReplies.length > 3 && subReplies.length <= limit && (
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => setVisibleReplies((prev) => ({ ...prev, [comment.id]: 3 }))} className="text-[10px] font-black text-gray-500 hover:text-black">Show Less</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ReactionListModal ─────────────────────────────────────────────────────────
function ReactionListModal({ isOpen = false, title = 'Reactions', list = [], emojiField = 'emoji_text', onClose }) {
  if (!isOpen) return null;
  const named = list.filter(r => r.user_id != null);
  const anon  = list.filter(r => r.user_id == null);

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white border-3 border-black rounded-2xl shadow-[6px_6px_0px_black] p-4 w-full max-w-xs">
        <button onClick={onClose} className="absolute top-2 right-3 font-black text-lg">✕</button>
        <h3 className="font-black mb-3">{title}</h3>
        {list.length === 0 && <p className="text-sm text-gray-400">No reactions yet</p>}
        <div className="max-h-60 overflow-y-auto space-y-1">
          {named.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-lg">{r[emojiField]}</span>
              <span className="font-semibold">{r.profiles?.username || r.username || 'User'}</span>
              {r._pending && (
                <span className="text-[9px] font-black px-1 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                  ORBITER
                </span>
              )}
            </div>
          ))}
          {named.length > 0 && anon.length > 0 && (
            <div className="flex items-center gap-2 py-1.5">
              <div className="flex-1 border-t border-dashed border-gray-200" />
              <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">anonymous</span>
              <div className="flex-1 border-t border-dashed border-gray-200" />
            </div>
          )}
          {anon.map((r, i) => (
            <div key={`anon-${i}`} className="flex items-center gap-2 text-sm opacity-60">
              <span className="text-lg">{r[emojiField]}</span>
              <span className="font-semibold text-gray-500 italic">Anonymous</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── image compression ─────────────────────────────────────────────────────────
async function compressGeoImage(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 1280;
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        else       { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = 0.82;
      const tryQ = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= MAX_IMAGE_BYTES || q <= 0.3) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          else { q = Math.max(0.3, q - 0.12); tryQ(); }
        }, 'image/jpeg', q);
      };
      tryQ();
    };
    img.src = url;
  });
}

// ── InlineDropdown (for filter bar — not portaled, fine outside overflow:hidden) ─
function InlineDropdown({ open, onClose, children, alignRight = false, className = '', triggerRef = null }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => {
      if (triggerRef?.current?.contains(e.target)) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [open, onClose, triggerRef]);
  if (!open) return null;
  return (
    <div ref={ref}
      className={`absolute top-full mt-1 z-[9999] bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-y-auto min-w-[120px] max-h-[280px] ${alignRight ? 'right-0' : 'left-0'} ${className}`}>
      {children}
    </div>
  );
}

// Local time filter helper (mirrors supabase.getTimeFilterSince)
function getTimeFilterSince(tf) {
  if (!tf || tf === 'all') return null;
  const now = new Date();
  const map = { '1d': 1, '7d': 7, '1mo': 30, '3mo': 90, '6mo': 180 };
  const days = map[tf];
  if (!days) return null;
  const since = new Date(now.getTime() - days * 86400000);
  return since.toISOString();
}

function applyFeedFilters(posts, {
  locTab,
  filterBorough,
  filterZip,
  timeFilter,
  statusFilter,
  sortByTop,
}) {
  let out = [...(posts || [])];

  if (locTab === 'borough' && filterBorough) {
    out = out.filter((p) => {
      if (p.borough !== filterBorough) return false;
      const scope = p.scope || null;
      return scope === 'borough' || scope === 'zip' || scope == null;
    });
  } else if (locTab === 'zip' && filterZip) {
    out = out.filter((p) => p.zip_code === filterZip);
  }

  const since = getTimeFilterSince(timeFilter);
  if (since) {
    const sinceMs = new Date(since).getTime();
    out = out.filter((p) => new Date(p.created_at).getTime() >= sinceMs);
  }

  if (statusFilter === 'participant') out = out.filter((p) => !!p.is_participant);
  else if (statusFilter === 'orbiter') out = out.filter((p) => !p.is_participant && !isAnonymousAuthor(p));
  else if (statusFilter === 'anonymous') out = out.filter((p) => isAnonymousAuthor(p));

  if (sortByTop) {
    out.sort((a, b) => {
      const byReactions = (Number(b.total_reactions || 0) - Number(a.total_reactions || 0));
      if (byReactions !== 0) return byReactions;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  } else {
    out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  return out;
}

// ── GeoPostView ───────────────────────────────────────────────────────────────
export default function GeoPostView({ session }) {
  const { resolvedTheme } = useSiteTheme();
  const accentColor = resolvedTheme?.accentColor || '#7C3AED';
  const surfaceBg   = resolvedTheme?.surfaceBackgroundColor || '#fff';

  // ── filter state ─────────────────────────────────────────────────────────────
  const [locTab,          setLocTab]          = useState('all');
  const [filterBorough,   setFilterBorough]   = useState('');
  const [filterZipBoro,   setFilterZipBoro]   = useState('Manhattan');
  const [filterZip,       setFilterZip]       = useState('');
  const [timeFilter,      setTimeFilter]      = useState('all');
  const [statusFilter,    setStatusFilter]    = useState('all');
  const [sortByTop,       setSortByTop]       = useState(false);
  const [openDropdown,    setOpenDropdown]    = useState(null);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [feedTextScale,   setFeedTextScale]   = useState(1);
  const [feedImageScale,  setFeedImageScale]  = useState(1);
  const [scalePopupPos,   setScalePopupPos]   = useState(null);
  const [mobileScaleOpen, setMobileScaleOpen] = useState(false);

  // ── feed state ────────────────────────────────────────────────────────────────
  const [posts,       setPosts]       = useState([]);
  const [visibleCount,setVisibleCount]= useState(PAGE_SIZE);
  const [loading,     setLoading]     = useState(false);
  const [reactions,   setReactions]   = useState({});
  const [reactorsModal,setReactorsModal]=useState(null);
  const [zipHeatMap,  setZipHeatMap]  = useState({});
  const [commentsByPost, setCommentsByPost] = useState({});
  const [commentReactionsByComment, setCommentReactionsByComment] = useState({});
  const [openCommentsByPost, setOpenCommentsByPost] = useState({});
  const [commentReactorsModal, setCommentReactorsModal] = useState(null);
  const [openPostPopup, setOpenPostPopup] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [desktopPanelRow, setDesktopPanelRow] = useState(1);
  const [desktopUnitHeight, setDesktopUnitHeight] = useState(420);
  // Filter panel mode: 'panel' = scrolling side tile, 'topbar' = horizontal bar under geo-feed separator
  const [filterPanelMode, setFilterPanelMode] = useState(() => {
    try { return localStorage.getItem('lapuff_filter_panel_mode') || 'panel'; } catch { return 'panel'; }
  });
  const [filterPanelPinned, setFilterPanelPinned] = useState(false); // resets on refresh
  const [mosaicPeek, setMosaicPeek] = useState(false); // hold-to-peek mosaic
  // Feed layout: 'tiles' = bento masonry, 'list' = simple sidebar + stacked feed (from b10941b)
  const [feedLayout, setFeedLayout] = useState(() => {
    try { return localStorage.getItem('lapuff_feed_layout') || 'tiles'; } catch { return 'tiles'; }
  });
  const [listScaleOpen, setListScaleOpen] = useState(false);
  const createPostAreaRef = useRef(null);
  const [fabOpacity, setFabOpacity] = useState(0);
  const [fabVisible, setFabVisible] = useState(false);
  const [quickPostOpen, setQuickPostOpen] = useState(false);
  const miniEditorRef = useRef(null);

  // ── editor scope ──────────────────────────────────────────────────────────────
  const [editorScope,   setEditorScope]   = useState('digital');
  const [editorBorough, setEditorBorough] = useState('Manhattan');
  const [editorZip,     setEditorZip]     = useState('');

  // ── editor / image ────────────────────────────────────────────────────────────
  const editorRef    = useRef(null);
  const fileInputRef = useRef(null);
  const topAnchorRef = useRef(null);
  const desktopGridRef = useRef(null);
  const desktopFilterRef = useRef(null);
  const filterPanelInnerRef = useRef(null);
  const panelRowRef = useRef(1);
  const tileAnimatingRef = useRef(false);
  const lastAppliedRowRef = useRef(1);
  const bottomLockRef = useRef(false);
  const canShowMoreRef = useRef(false);
  const canShowLessRef = useRef(false);
  const rowStepRef = useRef(432);
  const scrollSettleTimerRef = useRef(null);
  const scaleButtonRef = useRef(null);
  // Cached distance from scroll-container top to grid top — computed once on mount / resize,
  // NOT on every scroll event. Recalculating on scroll is wrong because the grid reflowing
  // (when panel row changes) alters getBoundingClientRect().top, creating a feedback loop.
  const gridOffsetCacheRef = useRef(0);
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState('');
  const [showCheckin,  setShowCheckin]  = useState(false);
  const pendingPostRef = useRef(null);

  // ── post styling ──────────────────────────────────────────────────────────────
  const [postFill,    setPostFill]    = useState('');
  const [postOutline, setPostOutline] = useState('');
  const [postShadow,  setPostShadow]  = useState('');
  const [textColor,   setTextColor]   = useState('#000000');
  const [textColorManuallySet, setTextColorManuallySet] = useState(false);

  // ── toolbar fmt state ─────────────────────────────────────────────────────────
  const [fmtBold,      setFmtBold]      = useState(false);
  const [fmtItalic,    setFmtItalic]    = useState(false);
  const [fmtUnderline, setFmtUnderline] = useState(false);
  const [fmtAlign,     setFmtAlign]     = useState('left'); // managed in state only
  const [fmtSize,      setFmtSize]      = useState(3);
  const [activeCoolFont, setActiveCoolFont] = useState(null);
  const [openToolbar,  setOpenToolbar]  = useState(null);
  const [miniOpenToolbar, setMiniOpenToolbar] = useState(null);
  const [miniPostFill, setMiniPostFill] = useState('');
  const [miniPostOutline, setMiniPostOutline] = useState('');
  const [miniPostShadow, setMiniPostShadow] = useState('');
  const [miniTextColor, setMiniTextColor] = useState('#000000');
  const [miniActiveCoolFont, setMiniActiveCoolFont] = useState(null);
  const miniTxtColBtnRef = useRef(null);
  const miniFillBtnRef = useRef(null);
  const miniOutlineBtnRef = useRef(null);
  const miniShadowBtnRef = useRef(null);
  const miniEmojiBtnRef = useRef(null);
  const miniListBtnRef = useRef(null);
  const miniCoolBtnRef = useRef(null);

  // toolbar button refs (for PortalPopup positioning)
  const listBtnRef     = useRef(null);
  const coolBtnRef     = useRef(null);
  const emojiBtnRef    = useRef(null);
  const txtColBtnRef   = useRef(null);
  const fillBtnRef     = useRef(null);
  const outlineBtnRef  = useRef(null);
  const shadowBtnRef   = useRef(null);
  const boroughTriggerDesktopRef = useRef(null);
  const zipTriggerDesktopRef = useRef(null);
  const timeTriggerDesktopRef = useRef(null);
  const statusTriggerDesktopRef = useRef(null);
  // Separate refs for list mode aside (tile mode aside is visibility:hidden in list mode)
  const boroughTriggerListRef = useRef(null);
  const zipTriggerListRef = useRef(null);
  const timeTriggerListRef = useRef(null);
  const statusTriggerListRef = useRef(null);
  const boroughTriggerMobileRef = useRef(null);
  const zipTriggerMobileRef = useRef(null);
  const timeTriggerMobileRef = useRef(null);
  const statusTriggerMobileRef = useRef(null);
  const savedRangeRef  = useRef(null);
  const coolHandlerRef = useRef(null);

  // ── load feed ─────────────────────────────────────────────────────────────────
  const loadFeed = useCallback(async () => {
    const startedAt = Date.now();
    setLoading(true);
    try {
      const data = await fetchGeoPostFeed({
        type: 'all',
        value: null,
        timeFilter: 'all',
        statusFilter: 'all',
        sortByTop: false,
      });
      const samples = SAMPLE_MODE ? SAMPLE_POSTS : [];
      const combinedMap = new Map();
      [...(data || []), ...samples].forEach((post) => {
        const prev = combinedMap.get(post.id);
        combinedMap.set(post.id, prev ? { ...post, ...prev } : post);
      });
      const combined = Array.from(combinedMap.values()).map((post) => {
        const sampleSource = SAMPLE_POSTS_BY_ID.get(post.id);
        if (sampleSource && !post.username && !isAnonymousAuthor(sampleSource)) {
          return { ...post, username: sampleSource.username };
        }
        if (!post.username && post.user_id && session?.user?.id && post.user_id === session.user.id) {
          const selfUsername = currentProfile?.username || session.user.user_metadata?.username || '';
          if (selfUsername) return { ...post, username: selfUsername };
        }
        return post;
      });
      const finalList = applyFeedFilters(combined, {
        locTab,
        filterBorough,
        filterZip,
        timeFilter,
        statusFilter,
        sortByTop,
      });

      setPosts(finalList);
      setZipHeatMap(getZipHeatSnapshot());
      setVisibleCount(PAGE_SIZE);
      if (finalList.length > 0) {
        const realIds = finalList.filter((p) => !SAMPLE_POST_IDS.has(p.id)).map((p) => p.id);
        if (realIds.length > 0) {
          const rxns = await fetchReactionsForPosts(realIds);
          const byPost = {};
          (rxns || []).forEach(r => { if (!byPost[r.post_id]) byPost[r.post_id] = []; byPost[r.post_id].push(r); });
          setReactions(byPost);
        } else {
          setReactions({});
        }
      }
    } catch (err) {
      console.error('loadFeed error', err);
      const fallback = SAMPLE_MODE
        ? applyFeedFilters(SAMPLE_POSTS, {
          locTab,
          filterBorough,
          filterZip,
          timeFilter,
          statusFilter,
          sortByTop,
        })
        : [];
      setPosts(fallback);
      setReactions({});
      setZipHeatMap(getZipHeatSnapshot());
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed < 220) {
      await new Promise((resolve) => setTimeout(resolve, 220 - elapsed));
    }
    setLoading(false);
  }, [locTab, filterBorough, filterZip, timeFilter, statusFilter, sortByTop, currentProfile, session]);

  useEffect(() => {
    const t = setTimeout(() => { loadFeed(); }, 100);
    return () => clearTimeout(t);
  }, [loadFeed]);

  // Persist filterPanelMode + feedLayout to localStorage
  useEffect(() => {
    try { localStorage.setItem('lapuff_filter_panel_mode', filterPanelMode); } catch {}
  }, [filterPanelMode]);
  useEffect(() => {
    try { localStorage.setItem('lapuff_feed_layout', feedLayout); } catch {}
  }, [feedLayout]);

  useEffect(() => {
    const refreshHeat = () => setZipHeatMap(getZipHeatSnapshot());
    window.addEventListener('storage', refreshHeat);
    window.addEventListener('focus', refreshHeat);
    return () => {
      window.removeEventListener('storage', refreshHeat);
      window.removeEventListener('focus', refreshHeat);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      if (!session?.user?.id) {
        setCurrentProfile(null);
        return;
      }
      const profile = await fetchProfileForGeoPost(session.user.id, session);
      if (!cancelled) setCurrentProfile(profile);
    };
    loadProfile();
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    const syncSamples = async () => {
      if (!SAMPLE_MODE) return;
      try {
        await syncSampleGeoPostsToSupabase(SAMPLE_POSTS, session);
        await syncSampleGeoCommentsToSupabase(SAMPLE_COMMENTS, session);
        if (!cancelled) {
          loadFeed();
        }
      } catch {
        // Non-fatal in development; local sample data still renders.
      }
    };
    syncSamples();
    return () => { cancelled = true; };
  }, [session]);

  // Restore main editor draft on mount
  useEffect(() => {
    const saved = localStorage.getItem('lapuff_createpost_draft');
    if (saved && editorRef.current && !editorRef.current.innerHTML.trim()) {
      editorRef.current.innerHTML = saved;
    }
  }, []);

  // Restore quickpost draft when popup opens
  useEffect(() => {
    if (!quickPostOpen || !miniEditorRef.current) return;
    const saved = localStorage.getItem('lapuff_quickpost_draft');
    if (saved && !miniEditorRef.current.innerHTML.trim()) {
      miniEditorRef.current.innerHTML = saved;
    }
  }, [quickPostOpen]);

  // ── selectionchange: B/I/U/size only (alignment managed in state) ─────────────
  useEffect(() => {
    const update = () => {
      if (!editorRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!editorRef.current.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      setFmtBold(document.queryCommandState('bold'));
      setFmtItalic(document.queryCommandState('italic'));
      setFmtUnderline(document.queryCommandState('underline'));
      setFmtSize(parseInt(document.queryCommandValue('fontSize')) || 3);
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  // ── cool font intercept ───────────────────────────────────────────────────────
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (coolHandlerRef.current) editor.removeEventListener('keydown', coolHandlerRef.current);
    if (!activeCoolFont) { coolHandlerRef.current = null; return; }
    const handler = e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      e.preventDefault();
      document.execCommand('insertText', false, convertFont(e.key, activeCoolFont));
    };
    coolHandlerRef.current = handler;
    editor.addEventListener('keydown', handler);
    return () => editor.removeEventListener('keydown', handler);
  }, [activeCoolFont]);

  // ── post fill live preview + auto text color ─────────────────────────────────
  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.style.backgroundColor = postFill || '';
    // Auto-set text color to contrasting color unless the user manually picked one
    if (postFill && !textColorManuallySet) {
      const h = (postFill || '#ffffff').replace('#','');
      const r = parseInt(h.substring(0,2),16)/255;
      const g = parseInt(h.substring(2,4),16)/255;
      const b = parseInt(h.substring(4,6),16)/255;
      const lum = 0.2126*r + 0.7152*g + 0.0722*b;
      const auto = lum > 0.5 ? '#000000' : '#ffffff';
      setTextColor(auto);
      // Apply to editor active typing color
      editorRef.current.style.color = auto;
    }
  }, [postFill, textColorManuallySet]);

  // apply textColor changes to editor immediately
  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.style.color = textColor || '#000000';
  }, [textColor]);

  // ── helpers ───────────────────────────────────────────────────────────────────
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    const r = savedRangeRef.current;
    if (!r) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  };
  const focusEditor = () => editorRef.current?.focus();
  const execCmd = (cmd, val = null) => { focusEditor(); document.execCommand(cmd, false, val); };
  const miniExecCmd = (cmd, val = null) => { miniEditorRef.current?.focus(); document.execCommand(cmd, false, val); };
  const closeMiniToolbar = useCallback(() => setMiniOpenToolbar(null), []);
  const openMiniTb = (name) => { setMiniOpenToolbar(prev => prev === name ? null : name); };
  const closeToolbar = useCallback(() => setOpenToolbar(null), []);

  const openTb = (name) => {
    if (openToolbar === name) { setOpenToolbar(null); return; }
    saveRange();
    setOpenToolbar(name);
  };

  // toolbar button factory
  const tbBtn = (active, onMD, children, title, ref = null) => (
    <button ref={ref} title={title} onMouseDown={onMD}
      className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded text-[11px] md:text-[13px] font-black transition-all hover:opacity-80 flex-shrink-0"
      style={{ background: active ? accentColor : 'transparent', color: active ? '#fff' : 'inherit' }}>
      {children}
    </button>
  );

  const handleFontSize = dir => {
    const next = Math.max(1, Math.min(6, (fmtSize || 3) + dir));
    execCmd('fontSize', String(next));
    setFmtSize(next);
  };

  // Alignment: tracked in state, pressing active non-left resets to left
  const handleAlign = dir => {
    const newDir = (fmtAlign === dir && dir !== 'left') ? 'left' : dir;
    const cmd = newDir === 'left' ? 'justifyLeft' : newDir === 'center' ? 'justifyCenter' : 'justifyRight';
    execCmd(cmd);
    setFmtAlign(newDir);
  };

  const handleList = type => {
    focusEditor();
    if (type === 'bullet')  { document.execCommand('insertUnorderedList', false, null); }
    else if (type === 'number') { document.execCommand('insertOrderedList', false, null); }
    else if (type === 'roman') {
      document.execCommand('insertOrderedList', false, null);
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        let node = sel.getRangeAt(0).commonAncestorContainer;
        while (node && node.nodeName !== 'OL' && node !== editorRef.current) node = node.parentNode;
        if (node && node.nodeName === 'OL') node.style.listStyleType = 'upper-roman';
      }, 0);
    } else if (type === 'remove') {
      if (document.queryCommandState('insertUnorderedList')) document.execCommand('insertUnorderedList', false, null);
      else if (document.queryCommandState('insertOrderedList')) document.execCommand('insertOrderedList', false, null);
    }
    setOpenToolbar(null);
  };

  const handleCoolFont = key => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      focusEditor();
      // Strip any existing Unicode font chars back to ASCII, then apply the new font
      const plain = toPlainText(sel.toString());
      document.execCommand('insertText', false, convertFont(plain, key));
      setActiveCoolFont(null);
    } else {
      setActiveCoolFont(prev => prev === key ? null : key);
    }
    setOpenToolbar(null);
  };

  const handleInsertEmoji = emoji => {
    restoreRange();
    focusEditor();
    document.execCommand('insertText', false, emoji);
    setOpenToolbar(null);
  };

  const handleApplyTextColor = color => {
    restoreRange();
    focusEditor();
    document.execCommand('foreColor', false, color);
    setTextColor(color);
    setTextColorManuallySet(true);
    setOpenToolbar(null);
  };

  // Clear using execCommand so undo works
  const handleClear = () => {
    focusEditor();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  };

  // ── image ─────────────────────────────────────────────────────────────────────
  const handleImageChange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressGeoImage(file);
    setImageFile(compressed);
    setImagePreview(URL.createObjectURL(compressed));
    e.target.value = '';
  };

  // ── submit ────────────────────────────────────────────────────────────────────
  const handlePost = async () => {
    const html = editorRef.current?.innerHTML?.trim();
    if (!html && !imageFile) { setSubmitError('Write something or add an image.'); return; }
    setSubmitError('');
    if (html && containsProfanity(editorRef.current?.innerText || '')) {
      await doSubmit(html, false, false);
      setSubmitError('Post flagged for review.');
      return;
    }
    if (editorScope === 'digital') { await doSubmit(html, false, true); return; }
    pendingPostRef.current = html;
    setShowCheckin(true);
  };

  const doSubmit = async (html, isParticipant, post_approved) => {
    setSubmitting(true);
    try {
      let image_url = null;
      if (imageFile) {
        image_url = isOciConfigured()
          ? await uploadToOracleCloud(imageFile)
          : await uploadGeoPostImage(imageFile, session);
      }
      await submitGeoPost({
        content: { html, textColor },
        image_url,
        scope: editorScope,
        borough: (editorScope === 'borough' || editorScope === 'zip') ? editorBorough : null,
        zip_code: editorScope === 'zip' ? editorZip : null,
        post_fill:    postFill    || null,
        post_outline: postOutline || null,
        post_shadow:  postShadow  || null,
        is_participant: isParticipant,
        post_approved,
        user_id: session?.user?.id || null,
      }, session);
      if (editorRef.current) editorRef.current.innerHTML = '';
      localStorage.removeItem('lapuff_createpost_draft');
      setImageFile(null); setImagePreview(null); setShowCheckin(false);
      await loadFeed();
    } catch (err) { setSubmitError(err.message || 'Failed to post.'); }
    setSubmitting(false);
  };

  const handleCheckinYes = async () => {
    const html = pendingPostRef.current;
    if (editorScope === 'zip' && editorZip) {
      const res = await isUserInZipCode(editorZip);
      if (res === 'confirmed')    await doSubmit(html, true, true);
      else if (res === 'cant_connect') { setSubmitError("Can't verify GPS."); setShowCheckin(false); }
      else                             { setSubmitError('Not in that zip.'); setShowCheckin(false); }
    } else { await doSubmit(html, true, true); }
  };
  const handleCheckinNo = () => doSubmit(pendingPostRef.current, false, true);

  // ── reactions ─────────────────────────────────────────────────────────────────
  const handleReact = async (postId, emoji) => {
    if (session?.user?.id) {
      // Signed-in user may only have one reaction per post. If they click a different emoji,
      // remove previous reaction and add the new one.
      const userReactions = (reactions[postId] || []).filter(r => r.user_id === session.user.id);
      const existingSame = userReactions.find(r => r.emoji_text === emoji);
      const existingOther = userReactions.find(r => r.emoji_text !== emoji);
      try {
        if (existingSame) {
          await removePostReaction(postId, emoji, session);
          setReactions(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(r => !(r.user_id === session.user.id && r.emoji_text === emoji)) }));
        } else {
          if (existingOther) {
            // remove the old different emoji first
            await removePostReaction(postId, existingOther.emoji_text, session);
            setReactions(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(r => !(r.user_id === session.user.id)) }));
          }
          await addPostReaction(postId, emoji, session);
          setReactions(prev => ({ ...prev, [postId]: [...(prev[postId] || []), { post_id: postId, emoji_text: emoji, user_id: session.user.id, username: session.user.user_metadata?.username }] }));
        }
      } catch (err) { console.warn('react err', err); }
    } else {
      // Anonymous: allow one anon reaction per post per device. Remove any prior anon reaction on that post.
      const anonSet = getAnonSet();
      // find any existing anon keys for this post
      const existingKeys = [...anonSet].filter(k => k.startsWith(postId + ':'));
      // if the same key exists -> toggle off
      const key = `${postId}:${emoji}`;
      if (anonSet.has(key)) {
        // remove it
        anonSet.delete(key); saveAnonSet(anonSet);
        try { await removePostReaction(postId, emoji, null); } catch (e) {}
        setReactions(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(r => !(r.user_id == null && r.emoji_text === emoji)) }));
        return;
      }
      // remove any other anon reactions for this post
      for (const k of existingKeys) {
        anonSet.delete(k);
        const oldEmoji = k.split(':')[1];
        try { await removePostReaction(postId, oldEmoji, null); } catch (e) {}
        setReactions(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(r => !(r.user_id == null && r.emoji_text === oldEmoji)) }));
      }
      // Now add the new anon reaction via RPC (best effort)
      let deviceId = null;
      try { const mod = await import('../lib/deviceId.js'); deviceId = await mod.getDeviceId(); } catch {}
      try {
        const res = await fetch('https://gazuabyyugbbthonqnsp.supabase.co/rpc/increment_anon_count', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_target_id: postId, p_target_table: 'geoposts', p_device_id: deviceId })
        });
        // optimistic local update
        anonSet.add(key); saveAnonSet(anonSet);
        setReactions(prev => ({ ...prev, [postId]: [...(prev[postId] || []), { post_id: postId, emoji_text: emoji, user_id: null }] }));
        if (res.ok) return;
      } catch (err) { console.warn('increment_anon_count failed', err); }
      // fallback local-only
      try { await addPostReaction(postId, emoji, null); } catch (e) {}
      anonSet.add(key); saveAnonSet(anonSet);
      setReactions(prev => ({ ...prev, [postId]: [...(prev[postId] || []), { post_id: postId, emoji_text: emoji, user_id: null }] }));
    }
  };

  const ensureCommentsLoaded = useCallback(async (postId) => {
    if (!postId) return;
    const comments = await fetchCommentsForPost(postId);
    if (comments.length > 0) {
      setCommentsByPost((prev) => ({ ...prev, [postId]: comments }));
      const rxns = await fetchCommentReactions(comments.map((entry) => entry.id));
      const grouped = {};
      (rxns || []).forEach((entry) => {
        if (!grouped[entry.comment_id]) grouped[entry.comment_id] = [];
        grouped[entry.comment_id].push(entry);
      });
      setCommentReactionsByComment((prev) => ({ ...prev, ...grouped }));
      return;
    }
    if (SAMPLE_POST_IDS.has(postId)) {
      const sampleComments = SAMPLE_COMMENTS.filter((entry) => entry.post_id === postId);
      setCommentsByPost((prev) => ({ ...prev, [postId]: sampleComments }));
      const ids = sampleComments.map((entry) => entry.id);
      const grouped = {};
      SAMPLE_COMMENT_REACTIONS.filter((entry) => ids.includes(entry.comment_id)).forEach((entry) => {
        if (!grouped[entry.comment_id]) grouped[entry.comment_id] = [];
        grouped[entry.comment_id].push(entry);
      });
      setCommentReactionsByComment((prev) => ({ ...prev, ...grouped }));
    } else {
      setCommentsByPost((prev) => ({ ...prev, [postId]: [] }));
    }
  }, [commentsByPost]);

  const toggleComments = async (postId) => {
    setOpenCommentsByPost((prev) => ({ ...prev, [postId]: !prev[postId] }));
    if (!openCommentsByPost[postId]) {
      await ensureCommentsLoaded(postId);
    }
  };

  useEffect(() => {
    if (!openPostPopup) return;
    const fetchForPopup = async () => {
      const comments = await fetchCommentsForPost(openPostPopup.id);
      setCommentsByPost(prev => ({ ...prev, [openPostPopup.id]: comments }));
    };
    fetchForPopup();
  }, [openPostPopup?.id]);

  const buildCommentAuthor = async () => {
    if (!session?.user?.id) {
      return {
        user_id: null,
        username: 'anonymous',
        is_participant: false,
        borough: null,
        zip_code: null,
      };
    }
    const username = currentProfile?.username || session.user.user_metadata?.username || 'User';
    const zipCode = currentProfile?.home_zip || null;
    return {
      user_id: session.user.id,
      username,
      is_participant: !!isLocalParticipant(),
      borough: getBoroughForZip(zipCode),
      zip_code: zipCode,
    };
  };

  const submitCommentForPost = async (postId, content, parentId = null) => {
    const author = await buildCommentAuthor();
    const optimistic = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      post_id: postId,
      parent_id: parentId,
      content,
      created_at: new Date().toISOString(),
      ...author,
    };
    setCommentsByPost((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), optimistic] }));
    const payload = { post_id: postId, parent_id: parentId, content, ...author };
    try {
      const saved = await submitPostComment(payload, session);
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).map((entry) => entry.id === optimistic.id ? saved : entry),
      }));
    } catch (error) {
      console.error('submitCommentForPost failed:', error);
      if (SAMPLE_POST_IDS.has(postId)) {
        try {
          const sourcePost = SAMPLE_POSTS.find((entry) => entry.id === postId);
          if (sourcePost) await syncSampleGeoPostsToSupabase([sourcePost], session);
          const savedRetry = await submitPostComment(payload, session);
          setCommentsByPost((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((entry) => entry.id === optimistic.id ? savedRetry : entry),
          }));
          return;
        } catch (retryError) {
          console.error('submitCommentForPost retry failed:', retryError);
        }
      }
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).filter((entry) => entry.id !== optimistic.id),
      }));
    }
  };

  const handleCommentReaction = async (commentId, emoji) => {
    if (session?.user?.id) {
      const current = (commentReactionsByComment[commentId] || []).find((entry) => entry.user_id === session.user.id);
      try {
        if (current?.emoji === emoji) {
          await removeCommentReaction(commentId, session);
          setCommentReactionsByComment((prev) => ({
            ...prev,
            [commentId]: (prev[commentId] || []).filter((entry) => entry.user_id !== session.user.id),
          }));
          return;
        }
        await upsertCommentReaction(commentId, emoji, session);
        setCommentReactionsByComment((prev) => ({
          ...prev,
          [commentId]: [
            ...(prev[commentId] || []).filter((entry) => entry.user_id !== session.user.id),
            { comment_id: commentId, emoji, user_id: session.user.id, profiles: { username: currentProfile?.username || session.user.user_metadata?.username || 'User' } },
          ],
        }));
      } catch {}
      return;
    }
    const anonSet = getAnonCommentSet();
    const key = `${commentId}:${emoji}`;
    const existingKeys = [...anonSet].filter((entry) => entry.startsWith(`${commentId}:`));
    if (anonSet.has(key)) {
      anonSet.delete(key);
      saveAnonCommentSet(anonSet);
      setCommentReactionsByComment((prev) => ({ ...prev, [commentId]: (prev[commentId] || []).filter((entry) => !(entry.user_id == null && entry.emoji === emoji)) }));
      return;
    }
    existingKeys.forEach((entry) => anonSet.delete(entry));
    anonSet.add(key);
    saveAnonCommentSet(anonSet);
    setCommentReactionsByComment((prev) => ({
      ...prev,
      [commentId]: [
        ...(prev[commentId] || []).filter((entry) => entry.user_id != null),
        { comment_id: commentId, emoji, user_id: null },
      ],
    }));
  };

  // ── filter helpers ────────────────────────────────────────────────────────────
  const activeFS = { background: accentColor, color: '#fff', borderColor: accentColor };
  const baseFB   = 'relative px-2 py-1 rounded-lg border-2 border-black text-[11px] font-black transition-all flex items-center gap-0.5';
  const timeLabel = TIME_OPTIONS.find(t => t.key === timeFilter)?.label || 'All Time';
  const zipList   = (locTab === 'borough' && filterBorough) ? (BOROUGH_ZIPS[filterBorough] || []) : (BOROUGH_ZIPS[filterZipBoro] || []);
  const boroughHeatMap = useMemo(() => buildBoroughHeatMap(zipHeatMap), [zipHeatMap]);
  const normalizedQuery = normalizeSearchText(searchQuery);
  const searchTokens = normalizedQuery ? normalizedQuery.split(' ') : [];

  const filteredPosts = useMemo(() => {
    if (!normalizedQuery) return posts;
    return posts.filter((p) => {
      let parsedContent = {};
      if (p.content && typeof p.content === 'object') parsedContent = p.content;
      else if (typeof p.content === 'string') {
        try { parsedContent = JSON.parse(p.content); } catch { parsedContent = {}; }
      }
      const content = parsedContent.html || p.content || '';
      const contentText = normalizeSearchText(content);
      const username = normalizeSearchText(p.username || 'orbiter');
      const borough = normalizeSearchText(p.borough || '');
      const zip = normalizeSearchText(p.zip_code || '');
      const scope = normalizeSearchText(p.scope || '');
      const status = isAnonymousAuthor(p) ? 'anonymous anon' : p.is_participant ? 'participant' : 'orbiter';
      const haystack = `${contentText} ${username} ${borough} ${zip} ${scope} ${status} nyc digital`;
      return searchTokens.every((token) => haystack.includes(token));
    });
  }, [posts, normalizedQuery, searchTokens]);

  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const canShowMore  = visibleCount < filteredPosts.length;
  const canShowLess  = visibleCount > PAGE_SIZE;
  canShowMoreRef.current = canShowMore;
  canShowLessRef.current = canShowLess;

  useEffect(() => {
    const el = desktopFilterRef.current;
    if (!el || typeof window === 'undefined') return undefined;

    const updateHeight = () => {
      const h = Math.max(260, Math.round(el.getBoundingClientRect().height));
      setDesktopUnitHeight(h);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const applyPanelRow = useCallback((newRow) => {
    const prevRow = panelRowRef.current;
    if (newRow === prevRow) return;
    const el = filterPanelInnerRef.current;
    if (!el) {
      panelRowRef.current = newRow;
      setDesktopPanelRow(newRow);
      return;
    }
    // Capture current visual translateY (may be mid-animation)
    const matrix = window.getComputedStyle(el).transform;
    let currentTranslateY = 0;
    if (matrix && matrix !== 'none') {
      const vals = matrix.replace('matrix(', '').replace(')', '').split(',');
      if (vals.length >= 6) currentTranslateY = parseFloat(vals[5]) || 0;
    }
    const rowStep = rowStepRef.current;
    const delta = (prevRow - newRow) * rowStep;
    const startTranslate = currentTranslateY + delta;
    const travelDistance = Math.abs(startTranslate);

    panelRowRef.current = newRow;
    setDesktopPanelRow(newRow);

    // 1. Snap: teleport grid-row but apply counter-translateY so panel APPEARS not to move
    el.style.transition = 'none';
    el.style.transform = `translateY(${startTranslate}px)`;
    // Progressive blur proportional to travel distance
    const blurPx = Math.min(18, Math.max(3, travelDistance / 28));
    el.style.filter = `blur(${blurPx}px)`;
    el.style.opacity = '0.6';

    // 2. On next paint: release — smooth 2s cinematic glide to final position
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = [
        'transform 2000ms cubic-bezier(0.16, 1, 0.3, 1)',
        'filter 1700ms cubic-bezier(0.4, 0, 0.2, 1)',
        'opacity 900ms ease-out',
      ].join(', ');
      el.style.transform = 'translateY(0px)';
      el.style.filter = 'blur(0px)';
      el.style.opacity = '1';
    }));

    // Animate tiles during panel movement
    if (!tileAnimatingRef.current) {
      tileAnimatingRef.current = true;
      if (desktopGridRef.current) {
        desktopGridRef.current.classList.add('geopost-tiles-animating');
      }
      setTimeout(() => {
        tileAnimatingRef.current = false;
        desktopGridRef.current?.classList.remove('geopost-tiles-animating');
      }, 1200);
    }
  }, []);

  useEffect(() => {
    const grid = desktopGridRef.current;
    const scrollEl = grid ? findScrollParent(grid) : window;

    const computeGridOffset = () => {
      if (!desktopGridRef.current) return;
      const scrollTop = scrollEl === window ? window.scrollY : scrollEl.scrollTop;
      const containerClientTop = scrollEl === window ? 0 : scrollEl.getBoundingClientRect().top;
      const gridClientTop = desktopGridRef.current.getBoundingClientRect().top;
      gridOffsetCacheRef.current = gridClientTop - containerClientTop + scrollTop;
    };
    computeGridOffset();

    const computeTargetRow = () => {
      if (typeof window === 'undefined' || window.innerWidth < 768) return 1;
      if (!desktopGridRef.current) return panelRowRef.current;

      const scrollEl2 = scrollEl;
      const scrollTop = scrollEl2 === window ? window.scrollY : scrollEl2.scrollTop;
      const containerH = scrollEl2 === window ? window.innerHeight : scrollEl2.clientHeight;
      const halfRowPx = Math.max(1, (desktopUnitHeight - 12) / 2 + 12);
      const fullVisualRowPx = halfRowPx * 2;
      rowStepRef.current = halfRowPx;

      const TOPBAR_H = 72;
      const containerClientTop = scrollEl2 === window ? 0 : scrollEl2.getBoundingClientRect().top;

      const visibleScrollTopInGrid = Math.max(0, scrollTop - gridOffsetCacheRef.current);

      let visualRowIdx = Math.floor((visibleScrollTopInGrid + fullVisualRowPx * 0.5) / fullVisualRowPx);
      let targetRow = Math.max(1, 1 + visualRowIdx * 2);

      const getVisualPanelTop = (row) => {
        return gridOffsetCacheRef.current + (row - 1) * halfRowPx - scrollTop + containerClientTop;
      };

      for (let safety = 0; safety < 10; safety++) {
        const panelTop = getVisualPanelTop(targetRow);
        if (panelTop >= TOPBAR_H) break;
        targetRow = Math.max(1, targetRow + 2);
      }

      const maxHalfRow = Math.max(1, Math.floor(desktopGridRef.current.scrollHeight / halfRowPx));
      const maxOddRow = maxHalfRow % 2 === 0 ? maxHalfRow - 1 : maxHalfRow;

      if (canShowMoreRef.current || canShowLessRef.current) {
        const showMoreEl = desktopGridRef.current.querySelector('[data-show-more-bar]');
        if (showMoreEl) {
          const smRect = showMoreEl.getBoundingClientRect();
          const viewportBottom = containerClientTop + containerH;
          if (smRect.top < viewportBottom && smRect.bottom > containerClientTop) {
            return Math.min(maxOddRow, maxOddRow);
          }
        }
      }

      return Math.min(maxOddRow, targetRow);
    };

    const onScroll = () => {
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = setTimeout(() => {
        const target = computeTargetRow();
        if (target !== lastAppliedRowRef.current) {
          lastAppliedRowRef.current = target;
          applyPanelRow(target);
        }
      }, 500);
    };

    const onResize = () => {
      computeGridOffset();
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
      applyPanelRow(computeTargetRow());
    };

    // Place panel immediately on mount/dep-change without animation
    const initialRow = computeTargetRow();
    lastAppliedRowRef.current = initialRow;
    panelRowRef.current = initialRow;
    setDesktopPanelRow(initialRow);
    if (filterPanelInnerRef.current) {
      filterPanelInnerRef.current.style.transition = 'none';
      filterPanelInnerRef.current.style.transform = 'translateY(0)';
      filterPanelInnerRef.current.style.filter = 'blur(0)';
      filterPanelInnerRef.current.style.opacity = '1';
    }

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current);
      scrollEl.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [desktopUnitHeight, visiblePosts.length, canShowMore, canShowLess, applyPanelRow, feedLayout, filterPanelMode]);

  // When switching back to tile mode, double-rAF to ensure two browser layout passes
  // (grid was unmounted in list mode so getBoundingClientRect was stale after remount)
  useEffect(() => {
    if (feedLayout !== 'tiles') return;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!desktopGridRef.current) return;
        const scrollEl = findScrollParent(desktopGridRef.current);
        const scrollTop = scrollEl === window ? window.scrollY : scrollEl.scrollTop;
        const containerClientTop = scrollEl === window ? 0 : scrollEl.getBoundingClientRect().top;
        const gridClientTop = desktopGridRef.current.getBoundingClientRect().top;
        // Fresh grid offset — old value was 0 (invalidated in click handler)
        gridOffsetCacheRef.current = gridClientTop - containerClientTop + scrollTop;
        // Hard-reset all tracking refs so computeTargetRow() starts clean
        panelRowRef.current = 1;
        lastAppliedRowRef.current = 1;
        setDesktopPanelRow(1);
        if (filterPanelInnerRef.current) {
          filterPanelInnerRef.current.style.transition = 'none';
          filterPanelInnerRef.current.style.transform = 'translateY(0)';
          filterPanelInnerRef.current.style.filter = 'blur(0)';
          filterPanelInnerRef.current.style.opacity = '1';
        }
      });
    });
    return () => cancelAnimationFrame(raf1);
  }, [feedLayout]);

  // FAB visibility: fade in as create-post area scrolls away
  useEffect(() => {    const scrollEl = desktopGridRef.current ? findScrollParent(desktopGridRef.current) : window;
    const handleFabScroll = () => {
      if (!createPostAreaRef.current) return;
      const rect = createPostAreaRef.current.getBoundingClientRect();
      const containerTop = scrollEl === window ? 0 : scrollEl.getBoundingClientRect().top;
      // visibleFraction: 1 = fully visible, 0 = fully off screen
      const visibleFraction = Math.max(0, Math.min(1, (rect.bottom - containerTop) / Math.max(1, rect.height)));
      // Start fading in during last 40% of create-post leaving, reach 1.0 when fully gone
      const disappearProgress = Math.max(0, Math.min(1, 1 - visibleFraction / 0.4));
      setFabOpacity(disappearProgress);
      setFabVisible(disappearProgress > 0);
    };
    handleFabScroll();
    scrollEl.addEventListener('scroll', handleFabScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleFabScroll);
  }, [visiblePosts.length]);

  const Divider = () => <div className="w-px h-4 bg-gray-300 mx-0.5 flex-shrink-0" />;

  // Handle tag clicks from posts: either location tags or status tags
  const handleSelectTag = (payload) => {
    if (!payload) return;
    if (payload.status) {
      setStatusFilter(payload.status);
      setOpenDropdown(null);
      return;
    }
    const p = payload;
    if (p.scope === 'digital' || p.scope === 'nyc') {
      setLocTab('all');
      setFilterBorough('');
      setFilterZip('');
    } else if (p.scope === 'borough') {
      setLocTab('borough');
      setFilterBorough(p.borough || '');
      setFilterZipBoro(p.borough || 'Manhattan');
      setFilterZip('');
    } else if (p.scope === 'zip') {
      setLocTab('zip');
      setFilterZip(p.zip_code || '');
      if (p.borough) setFilterZipBoro(p.borough);
    }
  };

  const scrollToTop = () => {
    topAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderFeedPostCard = (post, index, options = {}) => {
    const { desktop = false } = options;
    const loadedComments = commentsByPost[post.id];
    const fallbackSampleComments = SAMPLE_POST_IDS.has(post.id) ? SAMPLE_COMMENTS.filter((entry) => entry.post_id === post.id) : [];
    const postComments = loadedComments ?? [];
    const commentCount = Number(post.total_comments || 0) || loadedComments?.length || fallbackSampleComments.length;
    return (
      <PostCard
        key={post.id}
        post={post}
        postReactions={reactions[post.id]}
        onReact={handleReact}
        onOpenReactors={id => setReactorsModal(id)}
        accentColor={accentColor}
        onSelectTag={handleSelectTag}
        zipHeatMap={zipHeatMap}
        boroughHeatMap={boroughHeatMap}
        textScale={feedTextScale}
        imageScale={feedImageScale}
        imagePriority={index < 10}
        isDesktopMasonry={desktop}
        gridUnitHeight={desktop ? desktopUnitHeight : 0}
        commentCount={commentCount}
        commentsOpen={!!openCommentsByPost[post.id]}
        onToggleComments={toggleComments}
        onOpenPopup={(p) => setOpenPostPopup(p)}
        commentsChildren={
          <CommentSection
            post={post}
            comments={postComments.length ? postComments : fallbackSampleComments}
            reactionsByComment={commentReactionsByComment}
            onSubmitComment={(postId, content) => submitCommentForPost(postId, content, null)}
            onSubmitReply={(postId, parentId, content) => submitCommentForPost(postId, content, parentId)}
            onToggleReaction={handleCommentReaction}
            onOpenReactors={(commentId) => setCommentReactorsModal(commentId)}
            zipHeatMap={zipHeatMap}
            boroughHeatMap={boroughHeatMap}
          />
        }
      />
    );
  };

  return (
    <div className="w-full" ref={topAnchorRef}>
      <style>{`
        .geopost-tiles-animating > *:not(aside) {
          transition: transform 1000ms cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
      `}</style>
      {/* Create-post section with mosaic behind it */}
      <div className="w-full relative overflow-hidden" style={{ paddingBottom: 48 }}>
        {/* Mosaic: absolute background layer, fills height of this section, behind createpost */}
        <div className="hidden md:block absolute inset-0 pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true">
          <GeoPostMosaic posts={posts} accentColor={accentColor} opacity={mosaicPeek ? 1 : 0.42} />
        </div>
      <div className="w-full max-w-7xl mx-auto px-3 pt-3" style={{ position: 'relative', zIndex: 1 }}>
        <div ref={createPostAreaRef} className="rounded-2xl border-3 border-black shadow-[4px_4px_0px_black] relative overflow-hidden"
          style={{ background: surfaceBg, borderColor: postOutline || '#000', opacity: mosaicPeek ? 0 : 1, pointerEvents: mosaicPeek ? 'none' : 'auto', transition: 'opacity 200ms ease' }}>

          <div className="relative" style={{ zIndex: 1 }}>
          {/* image preview at top, rounded */}
          {imagePreview && (
            <div className="relative overflow-hidden rounded-t-2xl">
              <img src={imagePreview} alt="preview" className="w-full max-h-44 object-cover" />
              <button onMouseDown={e => e.preventDefault()} onClick={() => { setImageFile(null); setImagePreview(null); }}
                className="absolute top-2 right-2 w-6 h-6 bg-black text-white rounded-full text-[11px] flex items-center justify-center font-black">✕</button>
            </div>
          )}

          {/* location selector */}
          <div className="px-3 pt-3 pb-5">
            <LocationSelector scope={editorScope} setScope={setEditorScope}
              borough={editorBorough} setBorough={setEditorBorough}
              zip={editorZip} setZip={setEditorZip} accentColor={accentColor} />
          </div>

          {/* contenteditable editor — border shows postOutline simulation, expands with content */}
          <div ref={editorRef} contentEditable suppressContentEditableWarning
            className="min-h-[80px] md:min-h-[240px] px-3 py-4 text-sm border-t border-gray-100"
            style={{
              overflowWrap: 'break-word',
              backgroundColor: postFill || undefined,
              outline: postOutline ? `3px solid ${postOutline}` : 'none',
              boxShadow: postShadow ? `5px 5px 0px ${postShadow}` : 'none',
            }}
            onInput={() => { localStorage.setItem('lapuff_createpost_draft', editorRef.current?.innerHTML || ''); }}
            onKeyDown={e => {
              if (e.ctrlKey || e.metaKey) {
                if (e.key === 'b') { e.preventDefault(); execCmd('bold'); }
                else if (e.key === 'i') { e.preventDefault(); execCmd('italic'); }
                else if (e.key === 'u') { e.preventDefault(); execCmd('underline'); }
                else if (e.key === 'l') { e.preventDefault(); handleAlign('left'); }
                else if (e.key === 'e') { e.preventDefault(); handleAlign('center'); }
                else if (e.key === 'r') { e.preventDefault(); handleAlign('right'); }
              }
            }}
          />

          {/* ── Toolbar ──────────────────────────────────────────────────────── */}
          <div className="border-t border-gray-200 px-2 py-2 md:py-3 flex items-center gap-1 flex-wrap bg-gray-50">
            {tbBtn(false, e => { e.preventDefault(); execCmd('undo'); }, '↩', 'Undo')}
            {tbBtn(false, e => { e.preventDefault(); execCmd('redo'); }, '↪', 'Redo')}
            <Divider />

            {tbBtn(fmtBold, e => { e.preventDefault(); execCmd('bold'); }, <strong>B</strong>, 'Bold')}
            {tbBtn(fmtItalic, e => { e.preventDefault(); execCmd('italic'); }, <em>I</em>, 'Italic')}
            {tbBtn(fmtUnderline, e => { e.preventDefault(); execCmd('underline'); }, <u>U</u>, 'Underline')}
            <Divider />

            {tbBtn(fmtAlign === 'left', e => { e.preventDefault(); handleAlign('left'); }, <AlignLeftIcon />, 'Align Left')}
            {tbBtn(fmtAlign === 'center', e => { e.preventDefault(); handleAlign('center'); }, <AlignCenterIcon />, 'Align Center')}
            {tbBtn(fmtAlign === 'right', e => { e.preventDefault(); handleAlign('right'); }, <AlignRightIcon />, 'Align Right')}
            <Divider />

            {tbBtn(fmtSize < 3, e => { e.preventDefault(); handleFontSize(-1); }, <span className="text-[10px]">A↓</span>, 'Font Smaller')}
            {tbBtn(fmtSize > 3, e => { e.preventDefault(); handleFontSize(+1); }, <span className="text-[10px]">A↑</span>, 'Font Larger')}
            <Divider />

            {tbBtn(false, e => { e.preventDefault(); openTb('list'); }, <span className="text-[10px]">☰▾</span>, 'Lists', listBtnRef)}
            <PortalPopup btnRef={listBtnRef} open={openToolbar === 'list'} onClose={closeToolbar} minWidth={140}>
              <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                {[['bullet','• Bullets'],['number','1. Numbers'],['roman','I. Roman'],['remove','Remove']].map(([t, label]) => (
                  <button key={t} onMouseDown={e => e.preventDefault()} onClick={() => handleList(t)} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 whitespace-nowrap">{label}</button>
                ))}
              </div>
            </PortalPopup>

            {tbBtn(!!activeCoolFont, e => { e.preventDefault(); openTb('coolFont'); }, <span className="text-[10px]" style={activeCoolFont ? { color: '#fff' } : {}}>Ψ▾</span>, 'Cool Font', coolBtnRef)}
            <PortalPopup btnRef={coolBtnRef} open={openToolbar === 'coolFont'} onClose={closeToolbar} minWidth={170}>
              <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden" style={{ maxHeight: 300, overflowY: 'auto' }}>
                {activeCoolFont && (
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setActiveCoolFont(null); setOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200">✕ Off</button>
                )}
                {ALL_COOL_FONTS.map(f => (
                  <button key={f.key} onMouseDown={e => e.preventDefault()} onClick={() => handleCoolFont(f.key)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 whitespace-nowrap flex items-center gap-2" style={activeCoolFont === f.key ? { background: accentColor + '22', color: accentColor } : {}}>
                    <span className="font-black text-[10px] w-16 truncate">{f.label}</span>
                    <span className="text-gray-500 text-[10px]">{f.name}</span>
                  </button>
                ))}
              </div>
            </PortalPopup>
            <Divider />

            {tbBtn(openToolbar === 'textColor', e => { e.preventDefault(); openTb('textColor'); }, <span style={{ borderBottom: `3px solid ${textColor}`, fontWeight: 900, fontSize: 11, lineHeight: 1.1, paddingBottom: 1 }}>A</span>, 'Text Color', txtColBtnRef)}
            <PortalPopup btnRef={txtColBtnRef} open={openToolbar === 'textColor'} onClose={closeToolbar} minWidth={180}>
              <HexColorPicker value={textColor} onChange={handleApplyTextColor} onClose={closeToolbar} />
            </PortalPopup>

            {tbBtn(!!postFill || openToolbar === 'postFill', e => { e.preventDefault(); openTb('postFill'); }, <span style={{ fontSize: 13 }}>🪣</span>, 'Post Fill Color', fillBtnRef)}
            <PortalPopup btnRef={fillBtnRef} open={openToolbar === 'postFill'} onClose={closeToolbar} minWidth={180}>
              <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                {postFill && (
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setPostFill(''); setOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear fill</button>
                )}
                <div className="p-1">
                  <HexColorPicker value={postFill || '#ffffff'} onChange={c => setPostFill(c)} onClose={closeToolbar} />
                </div>
              </div>
            </PortalPopup>

            {tbBtn(!!postOutline || openToolbar === 'postOutline', e => { e.preventDefault(); openTb('postOutline'); }, <span style={{ fontSize: 10, border: `2px solid ${postOutline || '#555'}`, padding: '0 2px', borderRadius: 2 }}>□</span>, 'Post Outline Color', outlineBtnRef)}
            <PortalPopup btnRef={outlineBtnRef} open={openToolbar === 'postOutline'} onClose={closeToolbar} minWidth={180} alignRight>
              <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                {postOutline && (
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setPostOutline(''); setOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear outline</button>
                )}
                <div className="p-1">
                  <HexColorPicker value={postOutline || '#000000'} onChange={c => setPostOutline(c)} onClose={closeToolbar} />
                </div>
              </div>
            </PortalPopup>

            {tbBtn(!!postShadow || openToolbar === 'postShadow', e => { e.preventDefault(); openTb('postShadow'); }, <span style={{ fontSize: 10, textShadow: `2px 2px 0 ${postShadow || '#555'}` }}>▦</span>, 'Post Shadow Color', shadowBtnRef)}
            <PortalPopup btnRef={shadowBtnRef} open={openToolbar === 'postShadow'} onClose={closeToolbar} minWidth={180} alignRight>
              <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                {postShadow && (
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setPostShadow(''); setOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear shadow</button>
                )}
                <div className="p-1">
                  <HexColorPicker value={postShadow || '#000000'} onChange={c => setPostShadow(c)} onClose={closeToolbar} />
                </div>
              </div>
            </PortalPopup>

            {tbBtn(openToolbar === 'emoji', e => { e.preventDefault(); openTb('emoji'); }, <span style={{ fontSize: 13 }}>😀</span>, 'Emoji', emojiBtnRef)}
            <PortalPopup btnRef={emojiBtnRef} open={openToolbar === 'emoji'} onClose={closeToolbar} minWidth={300} alignRight>
              <EmojiPicker embedded={true} compact={true} value="" onChange={e => { if (e) handleInsertEmoji(e); }} />
            </PortalPopup>

            {tbBtn(false, e => { e.preventDefault(); handleClear(); }, '✕', 'Clear')}
          </div>

          <div className="px-3 pb-3 pt-2 flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            <button onMouseDown={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()} className="px-3 py-2 md:px-4 md:py-3 border-2 border-black rounded-lg text-sm md:text-base font-black bg-white hover:bg-gray-100 shadow-[2px_2px_0px_black]">
              <span className="text-xl leading-none">📎</span> Image
            </button>
            {submitError && <p className="text-[10px] text-red-600 font-semibold flex-1 truncate">{submitError}</p>}
            <button onMouseDown={e => e.preventDefault()} onClick={handlePost} disabled={submitting} className="ml-auto px-4 py-2 md:px-5 md:py-3 border-2 border-black rounded-lg text-sm md:text-base font-black shadow-[2px_2px_0px_black]" style={{ background: accentColor, color: '#fff' }}>
              {submitting ? '...' : 'Post'}
            </button>
          </div>
          </div>
        </div>
      </div>
      {/* Top-right controls: feed layout toggle + eye peek button */}
      <div className="hidden md:flex absolute items-center gap-2" style={{ top: 10, right: 24, zIndex: 10 }}>
        {/* Layout toggle: tile mode or list mode */}
        <div className="flex items-center rounded-lg border-2 border-black bg-white shadow-[2px_2px_0px_black] overflow-hidden select-none">
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              // Full reset to load-time tile state — clears any stale filterPanelMode/refs from list mode
              setFeedLayout('tiles');
              setFilterPanelMode('panel');
              setFilterPanelPinned(false);
              setDesktopPanelRow(1);
              // Invalidate stale panel refs so the scroll effect recomputes fresh
              gridOffsetCacheRef.current = 0;
              panelRowRef.current = 1;
              lastAppliedRowRef.current = 1;
            }}
            title="Tile / bento view"
            className="flex items-center justify-center w-7 h-7 transition-colors"
            style={{ background: feedLayout === 'tiles' ? accentColor : '#fff', color: feedLayout === 'tiles' ? '#fff' : '#000' }}
          >
            {/* 2×2 grid icon */}
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="0" y="0" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="7.5" y="0" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="0" y="7.5" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" fill="currentColor"/></svg>
          </button>
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => setFeedLayout('list')}
            title="Simple list view"
            className="flex items-center justify-center w-7 h-7 transition-colors"
            style={{ background: feedLayout === 'list' ? accentColor : '#fff', color: feedLayout === 'list' ? '#fff' : '#000' }}
          >
            {/* 3 stacked bars icon */}
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="0" y="0.5" width="13" height="3" rx="1" fill="currentColor"/><rect x="0" y="5" width="13" height="3" rx="1" fill="currentColor"/><rect x="0" y="9.5" width="13" height="3" rx="1" fill="currentColor"/></svg>
          </button>
        </div>
        {/* Eye button: hold to peek at mosaic behind createpost */}
        <button
          className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-black bg-white shadow-[2px_2px_0px_black] hover:scale-110 transition-transform select-none"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onMouseDown={() => setMosaicPeek(true)}
          onMouseUp={() => setMosaicPeek(false)}
          onMouseLeave={() => setMosaicPeek(false)}
          onTouchStart={() => setMosaicPeek(true)}
          onTouchEnd={() => setMosaicPeek(false)}
          title="Hold to peek at mosaic"
          aria-label="Peek at mosaic"
        >👁</button>
      </div>
      </div>{/* end mosaic section wrapper */}

      {/* GEO-FEED Separator: OUTSIDE mosaic wrapper. overflow:visible so pill pokes up into mosaic.
          Line button top = mosaic wrapper bottom exactly.
          GEO-FEED pill centered on line → extends ~half-height above into mosaic area. */}
      <div className="w-full relative" style={{ height: 44, overflow: 'visible', zIndex: 10 }}>
        {/* Line button: full width, anchored at top:0 (= mosaic bottom), border-y, no shadow */}
        <div className="absolute left-0 right-0" style={{ top: 0, height: 20, borderTop: '3px solid #000', borderBottom: '3px solid #000', background: '#fff', zIndex: 1 }} />
        {/* GEO-FEED pill: center locked to line center (top:10px = midpoint of 20px line).
            translateY(-50%) pulls it up by half its own height → top half overlaps mosaic. */}
        <div className="absolute left-1/2" style={{ top: 10, transform: 'translate(-50%, -50%)', zIndex: 5 }}>
          <div className="border-[3px] border-black rounded-xl px-4 py-1.5 bg-white" style={{ whiteSpace: 'nowrap' }}>
            <span className="font-black text-[1.75rem] leading-none tracking-tight text-black">GEO-FEED</span>
          </div>
        </div>
      </div>

      {/* Horizontal filter top bar — only in tile mode when filterPanelMode === 'topbar' */}
      {filterPanelMode === 'topbar' && feedLayout === 'tiles' && (
        <div
          className="hidden md:flex items-center gap-2 flex-wrap px-3 py-2 bg-white"
          style={{
            border: '3px solid #000',
            borderRadius: 12,
            position: filterPanelPinned ? 'sticky' : 'static',
            top: filterPanelPinned ? 4 : undefined,
            zIndex: filterPanelPinned ? 50 : undefined,
            marginLeft: filterPanelPinned ? 16 : undefined,
            marginRight: filterPanelPinned ? 16 : undefined,
            marginBottom: filterPanelPinned ? 4 : 12,
          }}
        >
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
            placeholder="Search..."
            className="px-2 py-1 border-2 border-black rounded text-[11px] font-black"
            style={{ minWidth: 140, maxWidth: 200 }}
          />
          <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)} className={baseFB} style={sortByTop ? activeFS : {}}>🔥 Top</button>
          <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setFilterZip(''); setOpenDropdown(null); }} className={baseFB} style={locTab === 'all' ? activeFS : {}}>🌀 All</button>

          <div className="relative">
            <button ref={boroughTriggerDesktopRef} onMouseDown={e => e.preventDefault()}
              onClick={() => { if (locTab === 'borough' && filterBorough) { setLocTab('all'); setFilterBorough(''); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'borough' ? null : 'borough'); } }}
              className={baseFB} style={locTab === 'borough' && filterBorough ? activeFS : {}}>
              🏙 {locTab === 'borough' && filterBorough ? `${filterBorough} ×` : 'Borough ▾'}
            </button>
            <InlineDropdown open={openDropdown === 'borough'} onClose={() => setOpenDropdown(null)} triggerRef={boroughTriggerDesktopRef}>
              {(locTab === 'borough' && filterBorough) && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setLocTab('all'); setFilterBorough(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
              {BOROUGHS.map(b => (<button key={b} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setFilterBorough(b); setFilterZip(''); setLocTab('borough'); setFilterZipBoro(b); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={filterBorough === b ? { background: accentColor+'22', color: accentColor } : {}}>{b}</button>))}
            </InlineDropdown>
          </div>

          <div className="relative">
            <button ref={zipTriggerDesktopRef} onMouseDown={e => e.preventDefault()}
              onClick={() => { if (locTab === 'zip' && filterZip) { setLocTab('all'); setFilterZip(''); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'zip' ? null : 'zip'); } }}
              className={baseFB} style={locTab === 'zip' && filterZip ? activeFS : {}}>
              📍 {locTab === 'zip' && filterZip ? `${filterZip} ×` : 'Zip ▾'}
            </button>
            <InlineDropdown open={openDropdown === 'zip'} onClose={() => setOpenDropdown(null)} triggerRef={zipTriggerDesktopRef}>
              {(locTab === 'zip' && filterZip) && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setLocTab('all'); setFilterZip(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
              <div className="p-2 border-b border-gray-200"><div className="flex gap-1 flex-wrap">{BOROUGHS.map(b => (<button key={b} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => setFilterZipBoro(b)} className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black" style={filterZipBoro === b ? { background: accentColor, color: '#fff' } : {}}>{b.split(' ')[0]}</button>))}</div></div>
              {zipList.map(z => (<button key={z.zip} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setFilterZip(z.zip); setFilterBorough(''); setLocTab('zip'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100" style={filterZip === z.zip ? { background: accentColor+'22', color: accentColor } : {}}>{z.zip} <span className="text-[10px] text-gray-400">{z.name}</span></button>))}
            </InlineDropdown>
          </div>

          <div className="relative">
            <button ref={timeTriggerDesktopRef} onMouseDown={e => e.preventDefault()}
              onClick={() => { if (timeFilter !== 'all') { setTimeFilter('all'); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'time' ? null : 'time'); } }}
              className={baseFB} style={timeFilter !== 'all' ? activeFS : {}}>
              {timeFilter !== 'all' ? `${timeLabel} ×` : `${timeLabel} ▾`}
            </button>
            <InlineDropdown open={openDropdown === 'time'} onClose={() => setOpenDropdown(null)} triggerRef={timeTriggerDesktopRef}>
              {timeFilter !== 'all' && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setTimeFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
              {TIME_OPTIONS.map(t => (<button key={t.key} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setTimeFilter(t.key); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={timeFilter === t.key ? { background: accentColor+'22', color: accentColor } : {}}>{t.label}</button>))}
            </InlineDropdown>
          </div>

          <div className="relative">
            <button ref={statusTriggerDesktopRef} onMouseDown={e => e.preventDefault()}
              onClick={() => { if (statusFilter !== 'all') { setStatusFilter('all'); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'status' ? null : 'status'); } }}
              className={baseFB}
              style={statusFilter === 'participant' ? { background: '#22c55e', color: '#fff', borderColor: '#22c55e' } : statusFilter === 'orbiter' ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' } : statusFilter === 'anonymous' ? { background: '#374151', color: '#fff', borderColor: '#374151' } : {}}>
              {statusFilter === 'participant' ? 'Participant ×' : statusFilter === 'orbiter' ? 'Orbiter ×' : statusFilter === 'anonymous' ? 'Anonymous ×' : 'Status ▾'}
            </button>
            <InlineDropdown open={openDropdown === 'status'} onClose={() => setOpenDropdown(null)} alignRight triggerRef={statusTriggerDesktopRef}>
              {statusFilter !== 'all' && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setStatusFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
              {[['all','All'],['participant','Participant'],['orbiter','Orbiter'],['anonymous','Anonymous']].map(([k,l]) => (<button key={k} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setStatusFilter(k); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={statusFilter === k ? { background: accentColor+'22', color: accentColor } : {}}>{l}</button>))}
            </InlineDropdown>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            {/* ⬆️ returns to panel mode and fully resets panel state */}
            <button onMouseDown={e => e.preventDefault()} onClick={() => { setFilterPanelMode('panel'); setFilterPanelPinned(false); setDesktopPanelRow(1); }} className={baseFB} style={activeFS} title="Return to side panel">⬆️</button>
            <button onMouseDown={e => e.preventDefault()} onClick={() => setFilterPanelPinned(v => !v)} className={baseFB} style={filterPanelPinned ? activeFS : {}} title={filterPanelPinned ? 'Unpin top bar' : 'Pin top bar below topbar'}>📌</button>
          </div>
        </div>
      )}

      <div className="w-full px-3 md:px-4">
        {/* ── TILE / BENTO MODE ── */}
        {feedLayout === 'tiles' && (<>
        <div ref={desktopGridRef} className="hidden md:grid gap-3 mt-3"
          style={{
            '--image-scale': Math.max(0.5, Number(feedImageScale || 1)),
            gridAutoFlow: 'dense',
            gridTemplateColumns: 'repeat(14, minmax(0, 1fr))',
            gridAutoRows: `${Math.max(1, (desktopUnitHeight - 12) / 2)}px`,
            overflowAnchor: 'none',
            // Clip at 16 half-rows when at initial page; expand when user presses Show More
            overflow: canShowLess ? 'visible' : 'hidden',
            maxHeight: canShowLess ? 'none' : `${16 * Math.max(1, (desktopUnitHeight - 12) / 2) + 15 * 12}px`,
          }}
        >
          {/* Filter aside — always in DOM on desktop.
              In topbar mode: visibility:hidden + frozen at row 1 so tile grid never reflows.
              In panel mode: visible, scroll-tracked to desktopPanelRow. */}
          <aside ref={filterPanelInnerRef} style={{
            gridColumn: '1 / span 2',
            gridRow: filterPanelMode === 'topbar' ? '1 / span 2' : `${desktopPanelRow} / span 2`,
            // In topbar mode: absolutely positioned (leaves grid flow → tiles fill cols 1-2, no blank gap)
            // In panel mode: relative (participates in grid flow as leftmost tile)
            position: filterPanelMode === 'topbar' ? 'absolute' : 'relative',
            zIndex: 20,
            willChange: 'transform, filter, opacity',
            visibility: filterPanelMode === 'topbar' ? 'hidden' : 'visible',
            pointerEvents: filterPanelMode === 'topbar' ? 'none' : undefined,
          }}>
            <div ref={desktopFilterRef} className="rounded-2xl bg-white p-2" style={{ border: '5px dotted #000', boxShadow: 'none' }}>
              <div className="text-[10px] font-black text-center tracking-widest uppercase mb-1.5 opacity-60">Filter Panel</div>
              <input
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
                placeholder="Search posts, usernames, zips..."
                className="w-full px-2 py-1.5 border-2 border-black rounded text-[11px] font-black mb-3"
              />
              <div className="flex flex-col gap-2">
                <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)} className={baseFB} style={sortByTop ? activeFS : {}}>🔥 Top</button>
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setFilterZip(''); setOpenDropdown(null); }} className={baseFB} style={locTab === 'all' ? activeFS : {}}>🌀 All</button>

                <div className="relative">
                  <button
                    ref={boroughTriggerDesktopRef}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (locTab === 'borough' && filterBorough) {
                        setLocTab('all'); setFilterBorough(''); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'borough' ? null : 'borough');
                      }
                    }}
                    className={baseFB}
                    style={locTab === 'borough' && filterBorough ? activeFS : {}}
                  >
                    🏙 {locTab === 'borough' && filterBorough ? `${filterBorough} ×` : 'Borough ▾'}
                  </button>
                  <InlineDropdown open={openDropdown === 'borough'} onClose={() => setOpenDropdown(null)} triggerRef={boroughTriggerDesktopRef}>
                    {(locTab === 'borough' && filterBorough) && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setLocTab('all'); setFilterBorough(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {BOROUGHS.map(b => (
                      <button key={b} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFilterBorough(b); setFilterZip(''); setLocTab('borough'); setFilterZipBoro(b); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={filterBorough === b ? { background: accentColor + '22', color: accentColor } : {}}>{b}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button
                    ref={zipTriggerDesktopRef}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (locTab === 'zip' && filterZip) {
                        setLocTab('all'); setFilterZip(''); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'zip' ? null : 'zip');
                      }
                    }}
                    className={baseFB}
                    style={locTab === 'zip' && filterZip ? activeFS : {}}
                  >
                    📍 {locTab === 'zip' && filterZip ? `${filterZip} ×` : 'Zip ▾'}
                  </button>
                  <InlineDropdown open={openDropdown === 'zip'} onClose={() => setOpenDropdown(null)} className="w-[220px] max-h-[280px]" triggerRef={zipTriggerDesktopRef}>
                    {(locTab === 'zip' && filterZip) && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setLocTab('all'); setFilterZip(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    <div className="p-2 border-b border-gray-200">
                      <div className="flex gap-1 flex-wrap">
                        {BOROUGHS.map(b => (
                          <button key={b} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFilterZipBoro(b); }} className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black" style={filterZipBoro === b ? { background: accentColor, color: '#fff' } : {}}>{b.split(' ')[0]}</button>
                        ))}
                      </div>
                    </div>
                    {zipList.map(z => (
                      <button key={z.zip} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFilterZip(z.zip); setFilterBorough(''); setLocTab('zip'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100" style={filterZip === z.zip ? { background: accentColor + '22', color: accentColor } : {}}>{z.zip} <span className="text-[10px] text-gray-400">{z.name}</span></button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button
                    ref={timeTriggerDesktopRef}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (timeFilter !== 'all') {
                        setTimeFilter('all'); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'time' ? null : 'time');
                      }
                    }}
                    className={baseFB}
                    style={timeFilter !== 'all' ? activeFS : {}}
                  >
                    {timeFilter !== 'all' ? `${timeLabel} ×` : `${timeLabel} ▾`}
                  </button>
                  <InlineDropdown open={openDropdown === 'time'} onClose={() => setOpenDropdown(null)} triggerRef={timeTriggerDesktopRef}>
                    {timeFilter !== 'all' && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setTimeFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {TIME_OPTIONS.map(t => (
                      <button key={t.key} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setTimeFilter(t.key); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={timeFilter === t.key ? { background: accentColor + '22', color: accentColor } : {}}>{t.label}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button ref={statusTriggerDesktopRef} onMouseDown={e => e.preventDefault()} onClick={() => {
                      if (statusFilter !== 'all') {
                        setStatusFilter('all'); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'status' ? null : 'status');
                      }
                    }} className={baseFB}
                    style={statusFilter === 'participant' ? { background: '#22c55e', color: '#fff', borderColor: '#22c55e' }
                      : statusFilter === 'orbiter' ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' }
                      : statusFilter === 'anonymous' ? { background: '#374151', color: '#fff', borderColor: '#374151' }
                      : {}}>{statusFilter === 'participant' ? 'Participant ×' : statusFilter === 'orbiter' ? 'Orbiter ×' : statusFilter === 'anonymous' ? 'Anonymous ×' : 'Status ▾'}</button>
                  <InlineDropdown open={openDropdown === 'status'} onClose={() => setOpenDropdown(null)} alignRight triggerRef={statusTriggerDesktopRef}>
                    {statusFilter !== 'all' && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setStatusFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {[['all','All'],['participant','Participant'],['orbiter','Orbiter'],['anonymous','Anonymous']].map(([k, l]) => (
                      <button key={k} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setStatusFilter(k); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={statusFilter === k ? { background: accentColor + '22', color: accentColor } : {}}>{l}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative mt-1">
                  <button
                    ref={scaleButtonRef}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (scalePopupPos) { setScalePopupPos(null); return; }
                      const rect = scaleButtonRef.current.getBoundingClientRect();
                      const scrollEl = findScrollParent(scaleButtonRef.current);
                      const scrollTop = scrollEl === window ? window.scrollY : scrollEl.scrollTop;
                      setScalePopupPos({ top: rect.top + scrollTop - 8, left: rect.left, width: rect.width });
                    }}
                    className={baseFB}
                  >
                    Aa {scalePopupPos ? '▴' : '▾'}
                  </button>
                </div>
                {/* ⬆️ button at bottom of panel — switches to topbar mode */}
                <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-200">
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setFilterPanelMode('topbar')}
                    className={baseFB}
                    style={{}}
                    title="Switch to horizontal top bar"
                  >⬆️</button>
                </div>
              </div>
            </div>
          </aside>

          {!loading && filteredPosts.length === 0 && (
            <div className="rounded-2xl border-3 border-black bg-white shadow-[4px_4px_0px_black] flex items-center justify-center" style={{ gridColumn: '3 / -1', gridRow: 'span 2' }}>
              <div className="text-center py-8 px-4">
                <div className="text-4xl mb-2">🌀</div>
                <p className="font-black text-gray-500">Nothing here yet! Be the first!</p>
              </div>
            </div>
          )}

          {!loading && visiblePosts.map((post, index) => renderFeedPostCard(post, index, { desktop: true }))}

          {loading && (
            <div className="rounded-2xl border-3 border-black bg-white shadow-[4px_4px_0px_black] flex items-center justify-center" style={{ gridColumn: '3 / -1', gridRow: 'span 2' }}>
              <p className="text-center text-sm text-gray-400 font-semibold py-4">Loading...</p>
            </div>
          )}

        </div>
        {(canShowMore || canShowLess) && (
          <div data-show-more-bar className="hidden md:flex justify-center gap-3 pt-2 pb-1">
            {canShowMore && (
              <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(v => v + PAGE_SIZE)} className="min-h-[32px] px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform leading-tight text-center inline-flex items-center justify-center whitespace-nowrap">
                Show More ({filteredPosts.length - visibleCount} remaining)
              </button>
            )}
            {canShowLess && (
              <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(PAGE_SIZE)} className="min-h-[32px] px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform leading-tight text-center inline-flex items-center justify-center whitespace-nowrap">
                Show Less
              </button>
            )}
          </div>
        )}
        </>)}{/* end feedLayout === 'tiles' */}

        {/* ── LIST MODE ── desktop only, feedLayout === 'list', layout from b10941b */}
        {feedLayout === 'list' && (
          <div className="hidden md:grid grid-cols-3 gap-4 mt-3 max-w-7xl mx-auto">

            {/* Sticky filter aside — 1/3 width */}
            <aside className="col-span-1 sticky self-start" style={{ top: 16 }}>
              <div className="rounded-2xl border-3 border-black p-3 bg-white shadow-[4px_4px_0px_black]">
                <div className="text-[10px] font-black text-center tracking-widest uppercase mb-1.5 opacity-60">Filter Panel</div>
                <input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
                  placeholder="Search posts, usernames, zips..."
                  className="w-full px-2 py-1.5 border-2 border-black rounded text-[11px] font-black mb-3"
                />
                <div className="flex flex-col gap-2">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)} className={baseFB} style={sortByTop ? activeFS : {}}>🔥 Top</button>
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setFilterZip(''); setOpenDropdown(null); }} className={baseFB} style={locTab === 'all' ? activeFS : {}}>🌀 All</button>

                  <div className="relative">
                    <button ref={boroughTriggerListRef} onMouseDown={e => e.preventDefault()}
                      onClick={() => { if (locTab === 'borough' && filterBorough) { setLocTab('all'); setFilterBorough(''); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'boroughL' ? null : 'boroughL'); } }}
                      className={baseFB} style={locTab === 'borough' && filterBorough ? activeFS : {}}>
                      🏙 {locTab === 'borough' && filterBorough ? `${filterBorough} ×` : 'Borough ▾'}
                    </button>
                    <InlineDropdown open={openDropdown === 'boroughL'} onClose={() => setOpenDropdown(null)} triggerRef={boroughTriggerListRef}>
                      {(locTab === 'borough' && filterBorough) && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setLocTab('all'); setFilterBorough(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
                      {BOROUGHS.map(b => (<button key={b} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setFilterBorough(b); setFilterZip(''); setLocTab('borough'); setFilterZipBoro(b); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={filterBorough === b ? { background: accentColor+'22', color: accentColor } : {}}>{b}</button>))}
                    </InlineDropdown>
                  </div>

                  <div className="relative">
                    <button ref={zipTriggerListRef} onMouseDown={e => e.preventDefault()}
                      onClick={() => { if (locTab === 'zip' && filterZip) { setLocTab('all'); setFilterZip(''); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'zipL' ? null : 'zipL'); } }}
                      className={baseFB} style={locTab === 'zip' && filterZip ? activeFS : {}}>
                      📍 {locTab === 'zip' && filterZip ? `${filterZip} ×` : 'Zip ▾'}
                    </button>
                    <InlineDropdown open={openDropdown === 'zipL'} onClose={() => setOpenDropdown(null)} triggerRef={zipTriggerListRef}>
                      {(locTab === 'zip' && filterZip) && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setLocTab('all'); setFilterZip(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
                      <div className="p-2 border-b border-gray-200"><div className="flex gap-1 flex-wrap">{BOROUGHS.map(b => (<button key={b} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => setFilterZipBoro(b)} className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black" style={filterZipBoro === b ? { background: accentColor, color: '#fff' } : {}}>{b.split(' ')[0]}</button>))}</div></div>
                      {zipList.map(z => (<button key={z.zip} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setFilterZip(z.zip); setFilterBorough(''); setLocTab('zip'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100" style={filterZip === z.zip ? { background: accentColor+'22', color: accentColor } : {}}>{z.zip} <span className="text-[10px] text-gray-400">{z.name}</span></button>))}
                    </InlineDropdown>
                  </div>

                  <div className="relative">
                    <button ref={timeTriggerListRef} onMouseDown={e => e.preventDefault()}
                      onClick={() => { if (timeFilter !== 'all') { setTimeFilter('all'); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'timeL' ? null : 'timeL'); } }}
                      className={baseFB} style={timeFilter !== 'all' ? activeFS : {}}>
                      {timeFilter !== 'all' ? `${timeLabel} ×` : `${timeLabel} ▾`}
                    </button>
                    <InlineDropdown open={openDropdown === 'timeL'} onClose={() => setOpenDropdown(null)} triggerRef={timeTriggerListRef}>
                      {timeFilter !== 'all' && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setTimeFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
                      {TIME_OPTIONS.map(t => (<button key={t.key} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setTimeFilter(t.key); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={timeFilter === t.key ? { background: accentColor+'22', color: accentColor } : {}}>{t.label}</button>))}
                    </InlineDropdown>
                  </div>

                  <div className="relative">
                    <button ref={statusTriggerListRef} onMouseDown={e => e.preventDefault()}
                      onClick={() => { if (statusFilter !== 'all') { setStatusFilter('all'); setVisibleCount(PAGE_SIZE); } else { setOpenDropdown(p => p === 'statusL' ? null : 'statusL'); } }}
                      className={baseFB}
                      style={statusFilter === 'participant' ? { background: '#22c55e', color: '#fff', borderColor: '#22c55e' } : statusFilter === 'orbiter' ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' } : statusFilter === 'anonymous' ? { background: '#374151', color: '#fff', borderColor: '#374151' } : {}}>
                      {statusFilter === 'participant' ? 'Participant ×' : statusFilter === 'orbiter' ? 'Orbiter ×' : statusFilter === 'anonymous' ? 'Anonymous ×' : 'Status ▾'}
                    </button>
                    <InlineDropdown open={openDropdown === 'statusL'} onClose={() => setOpenDropdown(null)} alignRight triggerRef={statusTriggerListRef}>
                      {statusFilter !== 'all' && (<button onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setStatusFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>)}
                      {[['all','All'],['participant','Participant'],['orbiter','Orbiter'],['anonymous','Anonymous']].map(([k,l]) => (<button key={k} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={() => { setStatusFilter(k); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={statusFilter === k ? { background: accentColor+'22', color: accentColor } : {}}>{l}</button>))}
                    </InlineDropdown>
                  </div>

                  {/* Text / image scale */}
                  <div className="mt-1">
                    <button onMouseDown={e => e.preventDefault()} onClick={() => setListScaleOpen(v => !v)} className={baseFB}>Aa {listScaleOpen ? '▴' : '▾'}</button>
                    {listScaleOpen && (
                      <div className="mt-2 border-2 border-black rounded-lg p-2 bg-white">
                        <div className="flex items-center justify-between mb-1"><span className="text-[10px] font-black">Text Scale</span><span className="text-[10px] font-black">{Math.round(feedTextScale * 100)}%</span></div>
                        <input type="range" min="0.5" max="2" step="0.05" value={feedTextScale} onChange={(e) => setFeedTextScale(Number(e.target.value))} className="w-full mb-2" />
                        <div className="flex items-center justify-between mb-1"><span className="text-[10px] font-black">Image Scale</span><span className="text-[10px] font-black">{Math.round(feedImageScale * 100)}%</span></div>
                        <input type="range" min="0.5" max="2" step="0.05" value={feedImageScale} onChange={(e) => setFeedImageScale(Number(e.target.value))} className="w-full" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </aside>

            {/* Posts feed — 2/3 width, simple stacked list */}
            <section className="col-span-2">
              {loading && (
                <div className="rounded-2xl border-3 border-black bg-white shadow-[4px_4px_0px_black] flex items-center justify-center py-8">
                  <p className="text-sm text-gray-400 font-semibold">Loading...</p>
                </div>
              )}
              {!loading && filteredPosts.length === 0 && (
                <div className="rounded-2xl border-3 border-black bg-white shadow-[4px_4px_0px_black] text-center py-8 px-4">
                  <div className="text-4xl mb-2">🌀</div>
                  <p className="font-black text-gray-500">Nothing here yet! Be the first!</p>
                </div>
              )}
              {!loading && (
                <div className="flex flex-col gap-3">
                  {visiblePosts.map((post, index) => renderFeedPostCard(post, index, { desktop: false }))}
                </div>
              )}
              {(canShowMore || canShowLess) && (
                <div className="flex justify-center gap-3 pt-3 pb-1">
                  {canShowMore && (
                    <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(v => v + PAGE_SIZE)} className="min-h-[32px] px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform">
                      Show More ({filteredPosts.length - visibleCount} remaining)
                    </button>
                  )}
                  {canShowLess && (
                    <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(PAGE_SIZE)} className="min-h-[32px] px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform">
                      Show Less
                    </button>
                  )}
                </div>
              )}
            </section>

          </div>
        )}{/* end feedLayout === 'list' */}

        <div className="md:hidden">
          <section data-geopost-feed-scroll>
            <div className="md:hidden rounded-2xl border-3 border-black p-3 bg-white shadow-[4px_4px_0px_black] mb-3">
              <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="Search posts, usernames, zips..." className="w-full px-3 py-2 border-2 border-black rounded text-sm font-black mb-3" />
              <div className="flex items-center gap-1 flex-wrap">
                <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)} className={baseFB} style={sortByTop ? activeFS : {}}>🔥 Top</button>
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setFilterZip(''); setOpenDropdown(null); }} className={baseFB} style={locTab === 'all' ? activeFS : {}}>🌀 All</button>

                <div className="relative">
                  <button
                    ref={boroughTriggerMobileRef}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (locTab === 'borough' && filterBorough) {
                        setLocTab('all'); setFilterBorough(''); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'borough' ? null : 'borough');
                      }
                    }}
                    className={baseFB}
                    style={locTab === 'borough' && filterBorough ? activeFS : {}}
                  >
                    🏙 {locTab === 'borough' && filterBorough ? `${filterBorough} ×` : 'Borough ▾'}
                  </button>
                  <InlineDropdown open={openDropdown === 'borough'} onClose={() => setOpenDropdown(null)} triggerRef={boroughTriggerMobileRef}>
                    {(locTab === 'borough' && filterBorough) && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setLocTab('all'); setFilterBorough(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {BOROUGHS.map(b => (
                      <button key={b} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFilterBorough(b); setFilterZip(''); setLocTab('borough'); setFilterZipBoro(b); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={filterBorough === b ? { background: accentColor + '22', color: accentColor } : {}}>{b}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button
                    ref={zipTriggerMobileRef}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (locTab === 'zip' && filterZip) {
                        setLocTab('all'); setFilterZip(''); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'zip' ? null : 'zip');
                      }
                    }}
                    className={baseFB}
                    style={locTab === 'zip' && filterZip ? activeFS : {}}
                  >
                    📍 {locTab === 'zip' && filterZip ? `${filterZip} ×` : 'Zip ▾'}
                  </button>
                  <InlineDropdown open={openDropdown === 'zip'} onClose={() => setOpenDropdown(null)} className="w-[220px] max-h-[280px]" triggerRef={zipTriggerMobileRef}>
                    {(locTab === 'zip' && filterZip) && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setLocTab('all'); setFilterZip(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    <div className="p-2 border-b border-gray-200">
                      <div className="flex gap-1 flex-wrap">
                        {BOROUGHS.map(b => (
                          <button key={b} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFilterZipBoro(b); }} className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black" style={filterZipBoro === b ? { background: accentColor, color: '#fff' } : {}}>{b.split(' ')[0]}</button>
                        ))}
                      </div>
                    </div>
                    {zipList.map(z => (
                      <button key={z.zip} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setFilterZip(z.zip); setFilterBorough(''); setLocTab('zip'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100" style={filterZip === z.zip ? { background: accentColor + '22', color: accentColor } : {}}>{z.zip} <span className="text-[10px] text-gray-400">{z.name}</span></button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button
                    ref={timeTriggerMobileRef}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (timeFilter !== 'all') {
                        setTimeFilter('all'); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'time' ? null : 'time');
                      }
                    }}
                    className={baseFB}
                    style={timeFilter !== 'all' ? activeFS : {}}
                  >
                    {timeFilter !== 'all' ? `${timeLabel} ×` : `${timeLabel} ▾`}
                  </button>
                  <InlineDropdown open={openDropdown === 'time'} onClose={() => setOpenDropdown(null)} triggerRef={timeTriggerMobileRef}>
                    {timeFilter !== 'all' && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setTimeFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {TIME_OPTIONS.map(t => (
                      <button key={t.key} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setTimeFilter(t.key); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={timeFilter === t.key ? { background: accentColor + '22', color: accentColor } : {}}>{t.label}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button ref={statusTriggerMobileRef} onMouseDown={e => e.preventDefault()} onClick={() => {
                      if (statusFilter !== 'all') {
                        setStatusFilter('all'); setVisibleCount(PAGE_SIZE);
                      } else {
                        setOpenDropdown(p => p === 'status' ? null : 'status');
                      }
                    }} className={baseFB}
                    style={statusFilter === 'participant' ? { background: '#22c55e', color: '#fff', borderColor: '#22c55e' }
                      : statusFilter === 'orbiter' ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' }
                      : statusFilter === 'anonymous' ? { background: '#374151', color: '#fff', borderColor: '#374151' }
                      : {}}>{statusFilter === 'participant' ? 'Participant ×' : statusFilter === 'orbiter' ? 'Orbiter ×' : statusFilter === 'anonymous' ? 'Anonymous ×' : 'Status ▾'}</button>
                  <InlineDropdown open={openDropdown === 'status'} onClose={() => setOpenDropdown(null)} alignRight triggerRef={statusTriggerMobileRef}>
                    {statusFilter !== 'all' && (
                      <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setStatusFilter('all'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {[['all','All'],['participant','Participant'],['orbiter','Orbiter'],['anonymous','Anonymous']].map(([k, l]) => (
                      <button key={k} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setStatusFilter(k); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={statusFilter === k ? { background: accentColor + '22', color: accentColor } : {}}>{l}</button>
                    ))}
                  </InlineDropdown>
                </div>
                <div className="relative w-full mt-1">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setMobileScaleOpen((v) => !v)} className={baseFB}>Aa / Image Scale {mobileScaleOpen ? '▴' : '▾'}</button>
                  {mobileScaleOpen && (
                    <div className="mt-2 border-2 border-black rounded-lg p-2 bg-white w-full">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black">Text Scale</span>
                        <span className="text-[10px] font-black">{Math.round(feedTextScale * 100)}%</span>
                      </div>
                      <input type="range" min="0.5" max="2" step="0.05" value={feedTextScale} onChange={(e) => setFeedTextScale(Number(e.target.value))} className="w-full mb-2" />

                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black">Image Scale</span>
                        <span className="text-[10px] font-black">{Math.round(feedImageScale * 100)}%</span>
                      </div>
                      <input type="range" min="0.5" max="2" step="0.05" value={feedImageScale} onChange={(e) => setFeedImageScale(Number(e.target.value))} className="w-full" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={`transition-opacity duration-200 ${loading ? 'opacity-35' : 'opacity-100'}`}>
              {filteredPosts.length === 0 && !loading && (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">🌀</div>
                  <p className="font-black text-gray-500">Nothing here yet! Be the first!</p>
                </div>
              )}

              {filteredPosts.length > 0 && (
                <div className="flex flex-col gap-3 pb-8">
                  {visiblePosts.map((post, index) => renderFeedPostCard(post, index))}
                  {(canShowMore || canShowLess) && (
                    <div className="flex justify-center gap-3 pt-2 pb-2">
                      {canShowMore && (
                        <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(v => v + PAGE_SIZE)} className="min-h-[32px] px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform leading-tight text-center inline-flex items-center justify-center whitespace-nowrap">
                          Show More ({filteredPosts.length - visibleCount} remaining)
                        </button>
                      )}
                      {canShowLess && (
                        <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(PAGE_SIZE)} className="min-h-[32px] px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform leading-tight text-center inline-flex items-center justify-center whitespace-nowrap">
                          Show Less
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`transition-opacity duration-200 ${loading ? 'opacity-100' : 'opacity-0 pointer-events-none h-0 overflow-hidden'}`}>
              <p className="text-center text-sm text-gray-400 font-semibold py-4">Loading...</p>
            </div>
          </section>
        </div>
      </div>

      {scalePopupPos && createPortal(
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setScalePopupPos(null)} />
          <div
            className="fixed z-[99999] rounded-xl border-2 border-black bg-white p-3 shadow-[4px_4px_0px_black] min-w-[180px]"
            style={{ top: scalePopupPos.top, left: scalePopupPos.left, width: Math.max(scalePopupPos.width, 180), transform: 'translateY(-100%)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-black">Text Scale</span>
              <span className="text-[10px] font-black">{Math.round(feedTextScale * 100)}%</span>
            </div>
            <input type="range" min="0.5" max="2" step="0.05" value={feedTextScale} onChange={(e) => setFeedTextScale(Number(e.target.value))} className="w-full mb-2" />
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-black">Image Scale</span>
              <span className="text-[10px] font-black">{Math.round(feedImageScale * 100)}%</span>
            </div>
            <input type="range" min="0.5" max="2" step="0.05" value={feedImageScale} onChange={(e) => setFeedImageScale(Number(e.target.value))} className="w-full" />
          </div>
        </>,
        document.body
      )}

      {openPostPopup && (
        <PostDetailPopup
          post={openPostPopup}
          postReactions={reactions[openPostPopup.id] || []}
          onReact={handleReact}
          onOpenReactors={(id) => setReactorsModal(id)}
          accentColor={accentColor}
          onSelectTag={handleSelectTag}
          onClose={() => setOpenPostPopup(null)}
          comments={commentsByPost[openPostPopup.id] || []}
          onSubmitComment={submitCommentForPost}
          session={session}
        />
      )}
      <ReactionListModal isOpen={!!reactorsModal} list={reactorsModal ? (reactions[reactorsModal] || []) : []} onClose={() => setReactorsModal(null)} />
      <ReactionListModal isOpen={!!commentReactorsModal} title="Comment Reactions" list={commentReactorsModal ? (commentReactionsByComment[commentReactorsModal] || []) : []} emojiField="emoji" onClose={() => setCommentReactorsModal(null)} />

      {/* Quick Post FAB — 2x size, square, more padding, full toolbar */}
      {fabVisible && createPortal(
        <>
          {quickPostOpen && (
            <div className="fixed inset-0 z-[99969]" onClick={() => setQuickPostOpen(false)} />
          )}
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => setQuickPostOpen(v => !v)}
            className="fixed z-[99970] bg-white border-3 border-black flex items-center justify-center font-black shadow-[4px_4px_0px_black] hover:scale-105 active:scale-95"
            style={{
              bottom: 36, left: 36,
              width: 56, height: 56,
              borderRadius: 14,
              fontSize: 28,
              opacity: fabOpacity,
              transition: 'opacity 300ms ease, transform 150ms ease',
            }}
            aria-label="Quick post"
          >
            +
          </button>
          {quickPostOpen && (
            <div
              className="fixed z-[99971] bg-white rounded-2xl border-3 border-black shadow-[8px_8px_0px_black] flex flex-col overflow-hidden"
              style={{ bottom: 108, left: 36, width: 680, maxHeight: '86vh', opacity: fabOpacity }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b-2 border-black flex-shrink-0">
                <span className="font-black text-sm">✍️ Quick Post</span>
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    if (miniEditorRef.current && editorRef.current) {
                      editorRef.current.innerHTML = miniEditorRef.current.innerHTML;
                    }
                    setQuickPostOpen(false);
                    const scrollEl = desktopGridRef.current ? findScrollParent(desktopGridRef.current) : window;
                    if (scrollEl && scrollEl !== window) {
                      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className="px-3 py-1 border-2 border-black rounded-lg text-[11px] font-black bg-yellow-100 hover:bg-yellow-200"
                >
                  ✏️ Edit Above
                </button>
              </div>

              {/* Mini toolbar — full parity with main editor */}
              <div className="flex items-center gap-0.5 px-3 py-1.5 border-b-2 border-black flex-shrink-0 flex-wrap bg-gray-50">
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('undo'); }, '↩', 'Undo')}
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('redo'); }, '↪', 'Redo')}
                <Divider />
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('bold'); }, <strong>B</strong>, 'Bold')}
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('italic'); }, <em>I</em>, 'Italic')}
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('underline'); }, <u>U</u>, 'Underline')}
                <Divider />
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('justifyLeft'); }, <AlignLeftIcon />, 'Align Left')}
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('justifyCenter'); }, <AlignCenterIcon />, 'Align Center')}
                {tbBtn(false, e => { e.preventDefault(); miniExecCmd('justifyRight'); }, <AlignRightIcon />, 'Align Right')}
                <Divider />
                {tbBtn(false, e => { e.preventDefault(); miniEditorRef.current?.focus(); document.execCommand('fontSize', false, String(Math.max(1, (parseInt(document.queryCommandValue('fontSize'))||3)-1))); }, <span className="text-[10px]">A↓</span>, 'Font Smaller')}
                {tbBtn(false, e => { e.preventDefault(); miniEditorRef.current?.focus(); document.execCommand('fontSize', false, String(Math.min(6, (parseInt(document.queryCommandValue('fontSize'))||3)+1))); }, <span className="text-[10px]">A↑</span>, 'Font Larger')}
                <Divider />
                {tbBtn(false, e => { e.preventDefault(); openMiniTb('list'); }, <span className="text-[10px]">☰▾</span>, 'Lists', miniListBtnRef)}
                <PortalPopup btnRef={miniListBtnRef} open={miniOpenToolbar === 'list'} onClose={closeMiniToolbar} minWidth={140}>
                  <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                    {[['bullet','• Bullets'],['number','1. Numbers'],['roman','I. Roman'],['remove','Remove']].map(([t, label]) => (
                      <button key={t} onMouseDown={e => e.preventDefault()} onClick={() => { miniEditorRef.current?.focus(); if (t === 'bullet') document.execCommand('insertUnorderedList', false, null); else if (t === 'number') document.execCommand('insertOrderedList', false, null); else if (t === 'remove') { if (document.queryCommandState('insertUnorderedList')) document.execCommand('insertUnorderedList', false, null); else if (document.queryCommandState('insertOrderedList')) document.execCommand('insertOrderedList', false, null); } setMiniOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 whitespace-nowrap">{label}</button>
                    ))}
                  </div>
                </PortalPopup>
                {tbBtn(!!miniActiveCoolFont, e => { e.preventDefault(); openMiniTb('coolFont'); }, <span className="text-[10px]" style={miniActiveCoolFont ? { color: '#fff' } : {}}>Ψ▾</span>, 'Cool Font', miniCoolBtnRef)}
                <PortalPopup btnRef={miniCoolBtnRef} open={miniOpenToolbar === 'coolFont'} onClose={closeMiniToolbar} minWidth={170}>
                  <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden" style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {miniActiveCoolFont && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => { setMiniActiveCoolFont(null); setMiniOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200">✕ Off</button>
                    )}
                    {ALL_COOL_FONTS.map(f => (
                      <button key={f.key} onMouseDown={e => e.preventDefault()} onClick={() => {
                        const sel = window.getSelection();
                        if (sel && sel.toString().length > 0) { miniEditorRef.current?.focus(); document.execCommand('insertText', false, convertFont(toPlainText(sel.toString()), f.key)); setMiniActiveCoolFont(null); }
                        else { setMiniActiveCoolFont(prev => prev === f.key ? null : f.key); }
                        setMiniOpenToolbar(null);
                      }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 whitespace-nowrap flex items-center gap-2" style={miniActiveCoolFont === f.key ? { background: accentColor + '22', color: accentColor } : {}}>
                        <span className="font-black text-[10px] w-16 truncate">{f.label}</span>
                        <span className="text-gray-500 text-[10px]">{f.name}</span>
                      </button>
                    ))}
                  </div>
                </PortalPopup>
                <Divider />
                {tbBtn(miniOpenToolbar === 'textColor', e => { e.preventDefault(); openMiniTb('textColor'); }, <span style={{ borderBottom: `3px solid ${miniTextColor}`, fontWeight: 900, fontSize: 11, lineHeight: 1.1, paddingBottom: 1 }}>A</span>, 'Text Color', miniTxtColBtnRef)}
                <PortalPopup btnRef={miniTxtColBtnRef} open={miniOpenToolbar === 'textColor'} onClose={closeMiniToolbar} minWidth={180}>
                  <HexColorPicker value={miniTextColor} onChange={(color) => { miniEditorRef.current?.focus(); document.execCommand('foreColor', false, color); setMiniTextColor(color); setMiniOpenToolbar(null); }} onClose={closeMiniToolbar} />
                </PortalPopup>
                {tbBtn(!!miniPostFill || miniOpenToolbar === 'postFill', e => { e.preventDefault(); openMiniTb('postFill'); }, <span style={{ fontSize: 13 }}>🪣</span>, 'Post Fill Color', miniFillBtnRef)}
                <PortalPopup btnRef={miniFillBtnRef} open={miniOpenToolbar === 'postFill'} onClose={closeMiniToolbar} minWidth={180}>
                  <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                    {miniPostFill && <button onMouseDown={e => e.preventDefault()} onClick={() => { setMiniPostFill(''); setMiniOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear fill</button>}
                    <div className="p-1"><HexColorPicker value={miniPostFill || '#ffffff'} onChange={c => setMiniPostFill(c)} onClose={closeMiniToolbar} /></div>
                  </div>
                </PortalPopup>
                {tbBtn(!!miniPostOutline || miniOpenToolbar === 'postOutline', e => { e.preventDefault(); openMiniTb('postOutline'); }, <span style={{ fontSize: 10, border: `2px solid ${miniPostOutline || '#555'}`, padding: '0 2px', borderRadius: 2 }}>□</span>, 'Post Outline Color', miniOutlineBtnRef)}
                <PortalPopup btnRef={miniOutlineBtnRef} open={miniOpenToolbar === 'postOutline'} onClose={closeMiniToolbar} minWidth={180} alignRight>
                  <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                    {miniPostOutline && <button onMouseDown={e => e.preventDefault()} onClick={() => { setMiniPostOutline(''); setMiniOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear outline</button>}
                    <div className="p-1"><HexColorPicker value={miniPostOutline || '#000000'} onChange={c => setMiniPostOutline(c)} onClose={closeMiniToolbar} /></div>
                  </div>
                </PortalPopup>
                {tbBtn(!!miniPostShadow || miniOpenToolbar === 'postShadow', e => { e.preventDefault(); openMiniTb('postShadow'); }, <span style={{ fontSize: 10, textShadow: `2px 2px 0 ${miniPostShadow || '#555'}` }}>▦</span>, 'Post Shadow Color', miniShadowBtnRef)}
                <PortalPopup btnRef={miniShadowBtnRef} open={miniOpenToolbar === 'postShadow'} onClose={closeMiniToolbar} minWidth={180} alignRight>
                  <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                    {miniPostShadow && <button onMouseDown={e => e.preventDefault()} onClick={() => { setMiniPostShadow(''); setMiniOpenToolbar(null); }} className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear shadow</button>}
                    <div className="p-1"><HexColorPicker value={miniPostShadow || '#000000'} onChange={c => setMiniPostShadow(c)} onClose={closeMiniToolbar} /></div>
                  </div>
                </PortalPopup>
                {tbBtn(miniOpenToolbar === 'emoji', e => { e.preventDefault(); openMiniTb('emoji'); }, <span style={{ fontSize: 13 }}>😀</span>, 'Emoji', miniEmojiBtnRef)}
                <PortalPopup btnRef={miniEmojiBtnRef} open={miniOpenToolbar === 'emoji'} onClose={closeMiniToolbar} minWidth={300} alignRight>
                  <EmojiPicker embedded={true} compact={true} value="" onChange={e => { if (e) { miniEditorRef.current?.focus(); document.execCommand('insertText', false, e); setMiniOpenToolbar(null); } }} />
                </PortalPopup>
                {tbBtn(false, e => { e.preventDefault(); if (miniEditorRef.current) miniEditorRef.current.innerHTML = ''; }, '✕', 'Clear')}
              </div>

              {/* Editor */}
              <div
                ref={miniEditorRef}
                contentEditable
                suppressContentEditableWarning
                className="flex-1 px-4 py-3 text-sm border-0 outline-none overflow-y-auto"
                style={{ minHeight: 160, overflowWrap: 'break-word' }}
                onInput={() => { localStorage.setItem('lapuff_quickpost_draft', miniEditorRef.current?.innerHTML || ''); }}
              />

              {/* Bottom bar */}
              <div className="flex gap-2 items-center px-4 py-2 border-t-2 border-black flex-shrink-0 bg-gray-50">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  id="fab-file-input"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    handleImageChange(e);
                  }}
                />
                <label htmlFor="fab-file-input" className="px-3 py-1.5 border-2 border-black rounded-lg text-[12px] font-black bg-white cursor-pointer hover:bg-gray-100">📎 Image</label>
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={async () => {
                    if (miniEditorRef.current && editorRef.current) {
                      editorRef.current.innerHTML = miniEditorRef.current.innerHTML;
                    }
                    await handlePost();
                    setQuickPostOpen(false);
                    if (miniEditorRef.current) miniEditorRef.current.innerHTML = '';
                    localStorage.removeItem('lapuff_quickpost_draft');
                  }}
                  className="ml-auto px-5 py-1.5 border-2 border-black rounded-lg text-[12px] font-black text-white shadow-[2px_2px_0px_black]"
                  style={{ background: accentColor }}
                >
                  Post
                </button>
              </div>
            </div>
          )}
        </>,
        document.body
      )}

      <button
        onClick={scrollToTop}
        className="hidden md:flex fixed z-[200000] bg-black text-white items-center justify-center hover:scale-105 active:scale-95 font-black shadow-[4px_4px_0px_rgba(0,0,0,0.35)]"
        style={{ bottom: 36, right: 36, width: 56, height: 56, borderRadius: 14, fontSize: 22 }}
        aria-label="Back to top"
      >
        ▲
      </button>

      {showCheckin && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCheckin(false)} />
          <div className="relative bg-white border-3 border-black rounded-2xl shadow-[6px_6px_0px_black] p-5 max-w-sm w-full text-center">
            <p className="font-black text-sm mb-1">Check in?</p>
            <p className="text-xs text-gray-600 mb-4">
              Send as a <strong>Participant</strong> (verifies you're there) or post as an <strong>Orbiter</strong>.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={handleCheckinYes}
                className="px-4 py-2 font-black text-sm rounded-xl border-2 border-black shadow-[2px_2px_0px_black]"
                style={{ background: accentColor, color: '#fff' }}>Yes (Participant)</button>
              <button onClick={handleCheckinNo}
                className="px-4 py-2 font-black text-sm rounded-xl border-2 border-black bg-white shadow-[2px_2px_0px_black]">No (Orbiter)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
