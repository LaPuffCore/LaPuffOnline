// @ts-nocheck
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSiteTheme } from '../lib/theme';
import { containsProfanity } from '../lib/profanityFilter';
import { isUserInZipCode } from '../lib/locationService';
import {
  fetchGeoPostFeed, submitGeoPost, uploadGeoPostImage,
  addPostReaction, removePostReaction, fetchReactionsForPosts,
} from '../lib/supabase';
import { uploadToOracleCloud, isOciConfigured } from '../lib/oracleStorage';
import { NYC_ZIP_FEATURES } from '../lib/nycZipGeoJSON';
import { ALL_COOL_FONTS, convertFont, toPlainText } from '../lib/unicodeFonts';
import { isLocalParticipant } from '../lib/pointsSystem';
import EmojiPicker from './EmojiPicker';

// ── constants ─────────────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 500 * 1024;
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const BOROUGH_ZIPS = BOROUGHS.reduce((acc, b) => {
  acc[b] = NYC_ZIP_FEATURES.filter(z => z.borough === b).sort((a, x) => a.zip.localeCompare(x.zip));
  return acc;
}, {});
const PAGE_SIZE = 10;
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
  const text = contrastTextColor(fill);
  const chipFill = text;
  const chipText = contrastTextColor(chipFill);
  return { fill, outline, text, chipFill, chipText };
}

function normalizeSearchText(value = '') {
  return toPlainText(stripHtmlTags(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sample posts shown in SAMPLE_MODE when feed is empty
const SAMPLE_POSTS = [
  { id: 'sp1', user_id: 'fake-user-1', username: 'xo_brooklynite', is_participant: true, scope: 'zip', borough: 'Brooklyn', zip_code: '11211', content: { html: '<b>Williamsburg block party this Saturday 🎉</b> — come thru Havemeyer St around 4pm, free food and live DJs. Bring the whole squad, all ages welcome!' }, post_fill: '#fff7ed', post_outline: '#f97316', total_reactions: 18, created_at: new Date(Date.now() - 2 * 3600000).toISOString(), post_approved: true },
  { id: 'sp2', user_id: null, username: 'Anonymous', is_participant: false, scope: 'borough', borough: 'Manhattan', zip_code: null, content: { html: 'Anyone else notice how crowded the 1/2/3 trains are rn? Serious sardine energy 😩 why is the MTA like this' }, post_fill: '', post_outline: '', total_reactions: 9, created_at: new Date(Date.now() - 5 * 3600000).toISOString(), post_approved: true },
  { id: 'sp3', user_id: 'fake-user-3', username: 'queensbridge_kev', is_participant: true, scope: 'zip', borough: 'Queens', zip_code: '11101', content: { html: '<i>Just found the most underrated bodega in LIC — iced coffee for $1.50 no cap 🧊</i><br/>It\'s on 21st St near the park. Go before they raise prices.' }, post_fill: '#f0fdf4', post_outline: '#22c55e', total_reactions: 24, created_at: new Date(Date.now() - 8 * 3600000).toISOString(), post_approved: true },
  { id: 'sp4', user_id: 'fake-user-4', username: 'nyc_culture_vulture', is_participant: false, scope: 'nyc', borough: null, zip_code: null, content: { html: '🗽 <u>NYC wide art week incoming</u> — dozens of galleries opening simultaneously across all 5 boroughs. Check lapuff for all the events this weekend.' }, post_fill: '#fdf4ff', post_outline: '#8b5cf6', total_reactions: 31, created_at: new Date(Date.now() - 12 * 3600000).toISOString(), post_approved: true },
  { id: 'sp5', user_id: 'fake-user-5', username: 'bronx_wave_rider', is_participant: true, scope: 'borough', borough: 'Bronx', zip_code: null, content: { html: 'Real talk the Bronx has the best food scene in the city rn 🔥 Grand Concourse hits different. Mofongo, birria, doubles — all within 2 blocks.' }, post_fill: '', post_outline: '#ef4444', total_reactions: 15, created_at: new Date(Date.now() - 15 * 3600000).toISOString(), post_approved: true },
  { id: 'sp6', user_id: null, username: 'Anonymous', is_participant: false, scope: 'digital', borough: null, zip_code: null, content: { html: 'Anyone know if the red line on NYC MTA has delays tonight? Can\'t find real info anywhere 🤔' }, post_fill: '', post_outline: '', total_reactions: 4, created_at: new Date(Date.now() - 18 * 3600000).toISOString(), post_approved: true },
  { id: 'sp7', user_id: 'fake-user-7', username: 'staten_island_sal', is_participant: true, scope: 'zip', borough: 'Staten Island', zip_code: '10301', content: { html: '<span style="font-weight:900">Ferry vibes are unmatched fr ⛴️</span><br/>Caught the sunset from the deck tonight. Free trip, best view in the city. Tourists don\'t even know.' }, post_fill: '#eff6ff', post_outline: '#3b82f6', total_reactions: 22, created_at: new Date(Date.now() - 22 * 3600000).toISOString(), post_approved: true },
  { id: 'sp8', user_id: 'fake-user-8', username: 'harlem_renaissance_gal', is_participant: true, scope: 'zip', borough: 'Manhattan', zip_code: '10027', content: { html: 'Sunday service brunch in Harlem hits different when the choir starts 🙏 Marcus Garvey Park after = perfect day. Who\'s linking?' }, post_fill: '#fff1f2', post_outline: '#f43f5e', total_reactions: 37, created_at: new Date(Date.now() - 26 * 3600000).toISOString(), post_approved: true },
  { id: 'sp9', user_id: 'fake-user-9', username: 'dumbo_design_kid', is_participant: false, scope: 'borough', borough: 'Brooklyn', zip_code: null, content: { html: 'DUMBO art walk tonight was insane 🎨 found 3 new artists I want to commission. Brooklyn keeps winning with the creative energy.' }, post_fill: '', post_outline: '#ec4899', total_reactions: 12, created_at: new Date(Date.now() - 30 * 3600000).toISOString(), post_approved: true },
  { id: 'sp10', user_id: 'fake-user-10', username: 'flushing_local', is_participant: true, scope: 'zip', borough: 'Queens', zip_code: '11354', content: { html: 'Flushing night market season is BACK 🥟🍜 New vendors this year and the soup dumpling spot from last year expanded. Bring cash and an appetite.' }, post_fill: '#fefce8', post_outline: '#eab308', total_reactions: 45, created_at: new Date(Date.now() - 36 * 3600000).toISOString(), post_approved: true },
];

// Anonymous reaction dedup via localStorage (prevents refresh-spam without accounts)
const ANON_REACTIONS_KEY = 'lapuff_geo_anon_reactions';
function getAnonSet() {
  try { return new Set(JSON.parse(localStorage.getItem(ANON_REACTIONS_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveAnonSet(s) { localStorage.setItem(ANON_REACTIONS_KEY, JSON.stringify([...s])); }

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

// ── PostCard ──────────────────────────────────────────────────────────────────
function PostCard({ post, postReactions, onReact, onOpenReactors, accentColor, onSelectTag }) {
  const { resolvedTheme } = useSiteTheme();
  const theme = getPostVisualTheme(post, resolvedTheme);
  const date = new Date(post.created_at);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const emojiCounts = {};
  (postReactions || []).forEach((r) => { emojiCounts[r.emoji_text] = (emojiCounts[r.emoji_text] || 0) + 1; });
  const topEmojis = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const [qepOpen, setQepOpen] = useState(false);
  const [imgRatio, setImgRatio] = useState(1);
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const postHtml = post.content?.html || post.content || '';
  const postTextColor = normalizeHexColor(post.content?.textColor || '', theme.text);

  const statusStyle = post.is_participant
    ? { background: '#22c55e', color: '#fff' }
    : post.user_id == null
      ? { background: '#374151', color: '#f3f4f6' }
      : { background: '#ef4444', color: '#fff' };

  const invertedChipStyle = {
    background: theme.chipFill,
    color: theme.chipText,
    border: `1px solid ${theme.chipText}`,
  };

  const outlineButtonStyle = {
    borderColor: theme.text,
    backgroundColor: theme.fill,
    color: theme.text,
  };

  return (
    <div className="rounded-2xl border-3 overflow-hidden shadow-[4px_4px_0px_black]" style={{ borderColor: theme.outline }}>
      {post.image_url && (
        <div className={`w-full overflow-hidden ${imgRatio > 1.2 ? 'h-40' : 'aspect-square'}`}>
          <img
            src={post.image_url}
            alt="post"
            className="w-full h-full object-cover"
            loading="lazy"
            onLoad={(e) => { try { setImgRatio(e.target.naturalWidth / e.target.naturalHeight); } catch {} }}
            onClick={() => { if (imgRatio < 0.9) setImgModalOpen(true); }}
          />
          {imgRatio < 0.9 && (
            <div className="absolute right-3 bottom-3">
              <button
                className="w-8 h-8 rounded-full bg-white border-2 border-black flex items-center justify-center shadow-[2px_2px_0px_black] hover:scale-105 transition-transform"
                onClick={() => setImgModalOpen(true)}
              >
                🔍
              </button>
            </div>
          )}
        </div>
      )}

      <div className="p-3" style={{ background: theme.fill }}>
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {post.user_id == null ? (
            <span className="font-black text-xs flex items-center gap-1" style={{ color: theme.text }}>
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'currentColor' }}>
                <rect x="2" y="9" width="16" height="2.5" rx="1.25" fill="currentColor" />
                <rect x="5" y="3" width="10" height="7" rx="1.5" fill="currentColor" />
                <circle cx="9.5" cy="15" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
              Anonymous
            </span>
          ) : (
            <span className="font-black text-xs" style={{ color: theme.text }}>{post.username || 'Orbiter'}</span>
          )}

          <span
            onClick={() => onSelectTag && onSelectTag({ status: post.user_id == null ? 'anonymous' : post.is_participant ? 'participant' : 'orbiter' })}
            className="text-[9px] font-black px-1.5 py-0.5 rounded-full cursor-pointer"
            style={post.post_fill ? invertedChipStyle : statusStyle}
          >
            ● {post.is_participant ? 'PARTICIPANT' : post.user_id == null ? 'ANON' : 'ORBITER'}
          </span>

          <span className="text-[9px] ml-auto" style={{ color: theme.text }}>{dateStr} · {timeStr}</span>
        </div>

        <div
          className="text-sm leading-relaxed mb-3 break-words min-h-[1.5rem]"
          style={{ color: postTextColor }}
          dangerouslySetInnerHTML={{ __html: postHtml }}
        />

        <div className="flex items-center gap-1 flex-wrap">
          {topEmojis.map(([emoji, count]) => (
            <button
              key={emoji}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onReact(post.id, emoji)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-full border-2 text-xs font-black hover:scale-105 transition-transform"
              style={post.post_fill ? outlineButtonStyle : { borderColor: '#000', backgroundColor: '#f3f4f6', color: '#000' }}
            >
              {emoji}<span className="text-[10px]">{count}</span>
            </button>
          ))}

          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQepOpen((v) => !v)}
            className="px-2 py-0.5 rounded-full border-2 text-xs font-black hover:scale-105 transition-transform"
            style={post.post_fill ? outlineButtonStyle : { borderColor: '#000', backgroundColor: '#f3f4f6', color: '#000' }}
          >
            +
          </button>

          {(postReactions?.length > 0) && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onOpenReactors(post.id)}
              className="px-2 py-0.5 rounded-full border-2 text-[10px] font-black hover:scale-105 transition-transform"
              style={post.post_fill ? outlineButtonStyle : { borderColor: '#000', backgroundColor: '#f3f4f6', color: '#000' }}
            >
              …
            </button>
          )}

          {post.scope === 'zip' && post.borough && (
            <span
              onClick={() => onSelectTag && onSelectTag({ ...post, scope: 'borough' })}
              className="text-[9px] font-black px-1.5 py-0.5 rounded-full cursor-pointer"
              style={post.post_fill ? invertedChipStyle : { background: '#f3f4f6', border: '1px solid #d1d5db', color: '#4b5563' }}
            >
              🏙 {post.borough}
            </span>
          )}

          <span
            onClick={() => onSelectTag && onSelectTag(post)}
            className="ml-auto text-[9px] font-black px-1.5 py-0.5 rounded-full cursor-pointer"
            style={post.post_fill
              ? invertedChipStyle
              : { background: '#f3f4f6', border: '1px solid #d1d5db', color: '#4b5563' }}
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

        {qepOpen && (
          <div className="mt-2">
            <EmojiPicker
              embedded={true}
              compact={true}
              value=""
              onChange={(e) => { if (e) { onReact(post.id, e); setQepOpen(false); } }}
            />
          </div>
        )}
      </div>

      {imgModalOpen && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setImgModalOpen(false)} />
          <div className="relative max-h-[90vh] overflow-auto">
            <img src={post.image_url} alt="full" className="max-w-[90vw] max-h-[90vh] object-contain" />
            <button onClick={() => setImgModalOpen(false)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white border-2 border-black">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ReactorListModal ──────────────────────────────────────────────────────────
function ReactorListModal({ postId, reactions, onClose }) {
  if (!postId) return null;
  const list = reactions[postId] || [];
  const named = list.filter(r => r.user_id != null);
  const anon  = list.filter(r => r.user_id == null);

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white border-3 border-black rounded-2xl shadow-[6px_6px_0px_black] p-4 w-full max-w-xs">
        <button onClick={onClose} className="absolute top-2 right-3 font-black text-lg">✕</button>
        <h3 className="font-black mb-3">Reactions</h3>
        {list.length === 0 && <p className="text-sm text-gray-400">No reactions yet</p>}
        <div className="max-h-60 overflow-y-auto space-y-1">
          {named.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-lg">{r.emoji_text}</span>
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
              <span className="text-lg">{r.emoji_text}</span>
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
function InlineDropdown({ open, onClose, children, alignRight = false, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref}
      className={`absolute top-full mt-1 z-[9999] bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-y-auto min-w-[120px] max-h-[280px] ${alignRight ? 'right-0' : 'left-0'} ${className}`}>
      {children}
    </div>
  );
}

// Filter SAMPLE_POSTS by type/value/etc. for demo mode
function filterSamplePosts(type, value, timeFilter, statusFilter, sortByTop) {
  let posts = [...SAMPLE_POSTS];
  if (type === 'borough' && value) posts = posts.filter(p => p.borough === value);
  else if (type === 'zip' && value) posts = posts.filter(p => p.zip_code === value);

  const since = getTimeFilterSince(timeFilter);
  if (since) {
    const sinceMs = new Date(since).getTime();
    posts = posts.filter((p) => new Date(p.created_at).getTime() >= sinceMs);
  }

  if (statusFilter === 'participant') posts = posts.filter(p => p.is_participant);
  else if (statusFilter === 'orbiter') posts = posts.filter(p => !p.is_participant && p.user_id != null);
  else if (statusFilter === 'anonymous') posts = posts.filter(p => p.user_id == null);

  if (sortByTop) posts.sort((a, b) => (b.total_reactions || 0) - (a.total_reactions || 0));
  else posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return posts;
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

function mergeFeedWithSamples(realPosts, samplePosts) {
  const merged = [];
  const data = realPosts || [];
  let sampleIdx = 0;

  if (data.length === 0) return [...samplePosts];

  for (let i = 0; i < data.length; i += 1) {
    merged.push(data[i]);
    if ((i + 1) % 3 === 0 && sampleIdx < samplePosts.length) {
      merged.push(samplePosts[sampleIdx++]);
    }
  }
  while (sampleIdx < samplePosts.length) merged.push(samplePosts[sampleIdx++]);

  return merged;
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

  // ── feed state ────────────────────────────────────────────────────────────────
  const [posts,       setPosts]       = useState([]);
  const [visibleCount,setVisibleCount]= useState(PAGE_SIZE);
  const [loading,     setLoading]     = useState(false);
  const [reactions,   setReactions]   = useState({});
  const [reactorsModal,setReactorsModal]=useState(null);

  // ── editor scope ──────────────────────────────────────────────────────────────
  const [editorScope,   setEditorScope]   = useState('digital');
  const [editorBorough, setEditorBorough] = useState('Manhattan');
  const [editorZip,     setEditorZip]     = useState('');

  // ── editor / image ────────────────────────────────────────────────────────────
  const editorRef    = useRef(null);
  const fileInputRef = useRef(null);
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState('');
  const [showCheckin,  setShowCheckin]  = useState(false);
  const pendingPostRef = useRef(null);

  // ── post styling ──────────────────────────────────────────────────────────────
  const [postFill,    setPostFill]    = useState('');
  const [postOutline, setPostOutline] = useState('');
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

  // toolbar button refs (for PortalPopup positioning)
  const listBtnRef     = useRef(null);
  const coolBtnRef     = useRef(null);
  const emojiBtnRef    = useRef(null);
  const txtColBtnRef   = useRef(null);
  const fillBtnRef     = useRef(null);
  const outlineBtnRef  = useRef(null);
  const savedRangeRef  = useRef(null);
  const coolHandlerRef = useRef(null);

  // ── load feed ─────────────────────────────────────────────────────────────────
  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const type  = locTab === 'borough' ? 'borough' : locTab === 'zip' ? 'zip' : 'all';
      const value = locTab === 'borough' ? filterBorough : locTab === 'zip' ? filterZip : null;
      const data  = await fetchGeoPostFeed({ type, value, timeFilter, statusFilter, sortByTop });

      const samples = filterSamplePosts(type, value, timeFilter, statusFilter, sortByTop);
      const finalList = mergeFeedWithSamples(data || [], samples);

      setPosts(finalList);
      setVisibleCount(PAGE_SIZE);
      if (finalList.length > 0) {
        const realIds = finalList.filter(p => !p.id.startsWith('sp') && !p.id.startsWith('gsp_')).map(p => p.id);
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
      const type  = locTab === 'borough' ? 'borough' : locTab === 'zip' ? 'zip' : 'all';
      const value = locTab === 'borough' ? filterBorough : locTab === 'zip' ? filterZip : null;
      const samples = filterSamplePosts(type, value, timeFilter, statusFilter, sortByTop);
      setPosts(samples);
      setReactions({});
    }
    setLoading(false);
  }, [locTab, filterBorough, filterZip, timeFilter, statusFilter, sortByTop]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

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
        is_participant: isParticipant,
        post_approved,
        user_id: session?.user?.id || null,
      }, session);
      if (editorRef.current) editorRef.current.innerHTML = '';
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

  // ── filter helpers ────────────────────────────────────────────────────────────
  const activeFS = { background: accentColor, color: '#fff', borderColor: accentColor };
  const baseFB   = 'relative px-2.5 py-1 rounded-lg border-2 border-black text-[10px] sm:text-xs font-black transition-all flex items-center gap-0.5';
  const timeLabel = timeFilter === 'all' ? 'Time' : TIME_OPTIONS.find(t => t.key === timeFilter)?.label || 'Time';
  const zipList   = (locTab === 'borough' && filterBorough) ? (BOROUGH_ZIPS[filterBorough] || []) : (BOROUGH_ZIPS[filterZipBoro] || []);
  const normalizedQuery = normalizeSearchText(searchQuery);
  const searchTokens = normalizedQuery ? normalizedQuery.split(' ') : [];

  const filteredPosts = useMemo(() => {
    if (!normalizedQuery) return posts;
    return posts.filter((p) => {
      const content = p.content?.html || p.content || '';
      const contentText = normalizeSearchText(content);
      const username = normalizeSearchText(p.username || 'orbiter');
      const borough = normalizeSearchText(p.borough || '');
      const zip = normalizeSearchText(p.zip_code || '');
      const scope = normalizeSearchText(p.scope || '');
      const status = p.user_id == null ? 'anonymous anon' : p.is_participant ? 'participant' : 'orbiter';
      const haystack = `${contentText} ${username} ${borough} ${zip} ${scope} ${status} nyc digital`;
      return searchTokens.every((token) => haystack.includes(token));
    });
  }, [posts, normalizedQuery, searchTokens]);

  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const canShowMore  = visibleCount < filteredPosts.length;
  const canShowLess  = visibleCount > PAGE_SIZE;

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(() => {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  };

  return (
    <div className="w-full">
      <div className="w-full max-w-7xl mx-auto px-3 pt-3">
        <div className="rounded-2xl border-3 border-black shadow-[4px_4px_0px_black]"
          style={{ background: surfaceBg, borderColor: postOutline || '#000' }}>

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
            }}
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

      <div className="w-full max-w-7xl mx-auto px-3">
        <div className="flex items-center gap-2 mt-2 mb-3">
          <div className="flex-1 border-t-2 border-black" />
          <span className="font-black text-xs text-black whitespace-nowrap px-1">- Geo-Feed -</span>
          <div className="flex-1 border-t-2 border-black" />
        </div>

        <div className="md:grid md:grid-cols-3 md:gap-4">
          <aside className="hidden md:block md:col-span-1 md:sticky md:top-24 self-start">
            <div className="rounded-2xl border-3 border-black p-3 bg-white shadow-[4px_4px_0px_black]">
              <input
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
                placeholder="Search posts, usernames, zips..."
                className="w-full px-3 py-2 border-2 border-black rounded text-sm font-black mb-3"
              />
              <div className="flex flex-col gap-2">
                <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)} className={baseFB} style={sortByTop ? activeFS : {}}>🔥 Top</button>
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setFilterZip(''); setOpenDropdown(null); }} className={baseFB} style={locTab === 'all' ? activeFS : {}}>🌀 All</button>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'borough' ? null : 'borough')} className={baseFB} style={locTab === 'borough' && filterBorough ? activeFS : {}}>🏙 {locTab === 'borough' && filterBorough ? filterBorough : 'Borough'} ▾</button>
                  <InlineDropdown open={openDropdown === 'borough'} onClose={() => setOpenDropdown(null)}>
                    {(locTab === 'borough' && filterBorough) && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {BOROUGHS.map(b => (
                      <button key={b} onMouseDown={e => e.preventDefault()} onClick={() => { setFilterBorough(b); setLocTab('borough'); setFilterZipBoro(b); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={filterBorough === b ? { background: accentColor + '22', color: accentColor } : {}}>{b}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'zip' ? null : 'zip')} className={baseFB} style={locTab === 'zip' && filterZip ? activeFS : {}}>📍 {locTab === 'zip' && filterZip ? filterZip : 'Zip'} ▾</button>
                  <InlineDropdown open={openDropdown === 'zip'} onClose={() => setOpenDropdown(null)} className="w-[220px] max-h-[280px]">
                    {(locTab === 'zip' && filterZip) && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterZip(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    <div className="p-2 border-b border-gray-200">
                      <div className="flex gap-1 flex-wrap">
                        {BOROUGHS.map(b => (
                          <button key={b} onMouseDown={e => e.preventDefault()} onClick={() => setFilterZipBoro(b)} className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black" style={filterZipBoro === b ? { background: accentColor, color: '#fff' } : {}}>{b.split(' ')[0]}</button>
                        ))}
                      </div>
                    </div>
                    {zipList.map(z => (
                      <button key={z.zip} onMouseDown={e => e.preventDefault()} onClick={() => { setFilterZip(z.zip); setLocTab('zip'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100" style={filterZip === z.zip ? { background: accentColor + '22', color: accentColor } : {}}>{z.zip} <span className="text-[10px] text-gray-400">{z.name}</span></button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'time' ? null : 'time')} className={baseFB} style={timeFilter !== 'all' ? activeFS : {}}>{timeLabel} ▾</button>
                  <InlineDropdown open={openDropdown === 'time'} onClose={() => setOpenDropdown(null)}>
                    {TIME_OPTIONS.map(t => (
                      <button key={t.key} onMouseDown={e => e.preventDefault()} onClick={() => { setTimeFilter(t.key); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={timeFilter === t.key ? { background: accentColor + '22', color: accentColor } : {}}>{t.label}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'status' ? null : 'status')} className={baseFB}
                    style={statusFilter === 'participant' ? { background: '#22c55e', color: '#fff', borderColor: '#22c55e' }
                      : statusFilter === 'orbiter' ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' }
                      : statusFilter === 'anonymous' ? { background: '#374151', color: '#fff', borderColor: '#374151' }
                      : {}}>{statusFilter === 'participant' ? 'Participant' : statusFilter === 'orbiter' ? 'Orbiter' : statusFilter === 'anonymous' ? 'Anonymous' : 'Status'} ▾</button>
                  <InlineDropdown open={openDropdown === 'status'} onClose={() => setOpenDropdown(null)} alignRight>
                    {[['all','All'],['participant','Participant'],['orbiter','Orbiter'],['anonymous','Anonymous']].map(([k, l]) => (
                      <button key={k} onMouseDown={e => e.preventDefault()} onClick={() => { setStatusFilter(k); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={statusFilter === k ? { background: accentColor + '22', color: accentColor } : {}}>{l}</button>
                    ))}
                  </InlineDropdown>
                </div>
              </div>
            </div>
          </aside>

          <section className="md:col-span-2" data-geopost-feed-scroll>
            <div className="md:hidden rounded-2xl border-3 border-black p-3 bg-white shadow-[4px_4px_0px_black] mb-3">
              <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="Search posts, usernames, zips..." className="w-full px-3 py-2 border-2 border-black rounded text-sm font-black mb-3" />
              <div className="flex items-center gap-1 flex-wrap">
                <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)} className={baseFB} style={sortByTop ? activeFS : {}}>🔥 Top</button>
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setFilterZip(''); setOpenDropdown(null); }} className={baseFB} style={locTab === 'all' ? activeFS : {}}>🌀 All</button>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'borough' ? null : 'borough')} className={baseFB} style={locTab === 'borough' && filterBorough ? activeFS : {}}>🏙 {locTab === 'borough' && filterBorough ? filterBorough : 'Borough'} ▾</button>
                  <InlineDropdown open={openDropdown === 'borough'} onClose={() => setOpenDropdown(null)}>
                    {(locTab === 'borough' && filterBorough) && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    {BOROUGHS.map(b => (
                      <button key={b} onMouseDown={e => e.preventDefault()} onClick={() => { setFilterBorough(b); setLocTab('borough'); setFilterZipBoro(b); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={filterBorough === b ? { background: accentColor + '22', color: accentColor } : {}}>{b}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'zip' ? null : 'zip')} className={baseFB} style={locTab === 'zip' && filterZip ? activeFS : {}}>📍 {locTab === 'zip' && filterZip ? filterZip : 'Zip'} ▾</button>
                  <InlineDropdown open={openDropdown === 'zip'} onClose={() => setOpenDropdown(null)} className="w-[220px] max-h-[280px]">
                    {(locTab === 'zip' && filterZip) && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterZip(''); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 border-b border-gray-200 text-red-500">× Clear</button>
                    )}
                    <div className="p-2 border-b border-gray-200">
                      <div className="flex gap-1 flex-wrap">
                        {BOROUGHS.map(b => (
                          <button key={b} onMouseDown={e => e.preventDefault()} onClick={() => setFilterZipBoro(b)} className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black" style={filterZipBoro === b ? { background: accentColor, color: '#fff' } : {}}>{b.split(' ')[0]}</button>
                        ))}
                      </div>
                    </div>
                    {zipList.map(z => (
                      <button key={z.zip} onMouseDown={e => e.preventDefault()} onClick={() => { setFilterZip(z.zip); setLocTab('zip'); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100" style={filterZip === z.zip ? { background: accentColor + '22', color: accentColor } : {}}>{z.zip} <span className="text-[10px] text-gray-400">{z.name}</span></button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'time' ? null : 'time')} className={baseFB} style={timeFilter !== 'all' ? activeFS : {}}>{timeLabel} ▾</button>
                  <InlineDropdown open={openDropdown === 'time'} onClose={() => setOpenDropdown(null)}>
                    {TIME_OPTIONS.map(t => (
                      <button key={t.key} onMouseDown={e => e.preventDefault()} onClick={() => { setTimeFilter(t.key); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={timeFilter === t.key ? { background: accentColor + '22', color: accentColor } : {}}>{t.label}</button>
                    ))}
                  </InlineDropdown>
                </div>

                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'status' ? null : 'status')} className={baseFB}
                    style={statusFilter === 'participant' ? { background: '#22c55e', color: '#fff', borderColor: '#22c55e' }
                      : statusFilter === 'orbiter' ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' }
                      : statusFilter === 'anonymous' ? { background: '#374151', color: '#fff', borderColor: '#374151' }
                      : {}}>{statusFilter === 'participant' ? 'Participant' : statusFilter === 'orbiter' ? 'Orbiter' : statusFilter === 'anonymous' ? 'Anonymous' : 'Status'} ▾</button>
                  <InlineDropdown open={openDropdown === 'status'} onClose={() => setOpenDropdown(null)} alignRight>
                    {[['all','All'],['participant','Participant'],['orbiter','Orbiter'],['anonymous','Anonymous']].map(([k, l]) => (
                      <button key={k} onMouseDown={e => e.preventDefault()} onClick={() => { setStatusFilter(k); setOpenDropdown(null); setVisibleCount(PAGE_SIZE); }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100" style={statusFilter === k ? { background: accentColor + '22', color: accentColor } : {}}>{l}</button>
                    ))}
                  </InlineDropdown>
                </div>
              </div>
            </div>

            {loading && <p className="text-center text-sm text-gray-400 font-semibold py-4">Loading...</p>}
            {!loading && filteredPosts.length === 0 && (
              <div className="text-center py-8">
                <div className="text-4xl mb-2">🌀</div>
                <p className="font-black text-gray-500">Nothing here yet! Be the first!</p>
              </div>
            )}
            {!loading && filteredPosts.length > 0 && (
              <div className="flex flex-col gap-3">
                {visiblePosts.map(post => (
                  <PostCard key={post.id} post={post} postReactions={reactions[post.id]} onReact={handleReact} onOpenReactors={id => setReactorsModal(id)} accentColor={accentColor} onSelectTag={handleSelectTag} />
                ))}
                {(canShowMore || canShowLess) && (
                  <div className="flex justify-center gap-3 pt-1">
                    {canShowMore && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(v => v + PAGE_SIZE)} className="px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform">
                        Show More ({filteredPosts.length - visibleCount} remaining)
                      </button>
                    )}
                    {canShowLess && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(PAGE_SIZE)} className="px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform">
                        Show Less
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <ReactorListModal postId={reactorsModal} reactions={reactions} onClose={() => setReactorsModal(null)} />

      <button
        onClick={scrollToTop}
        className="hidden md:flex fixed right-4 bottom-4 z-[200000] w-12 h-12 rounded-full bg-black text-white items-center justify-center hover:scale-110 transition-transform shadow-[2px_2px_0px_rgba(0,0,0,0.35)]"
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
