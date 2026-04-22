// @ts-nocheck
import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
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
function PostCard({ post, postReactions, onReact, onOpenReactors, accentColor }) {
  const { resolvedTheme } = useSiteTheme();
  const cardBg  = post.post_fill    || resolvedTheme?.surfaceBackgroundColor || '#fff';
  const cardBdr = post.post_outline || '#000';
  const date = new Date(post.created_at);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const emojiCounts = {};
  (postReactions || []).forEach(r => { emojiCounts[r.emoji_text] = (emojiCounts[r.emoji_text] || 0) + 1; });
  const topEmojis = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const locationTag = post.zip_code ? `📍 ${post.zip_code} · ${post.borough}`
    : post.borough ? `🏙 ${post.borough}`
    : post.scope === 'nyc' ? '🗽 NYC'
    : '💻 Digital';
  const [qepOpen, setQepOpen] = useState(false);

  return (
    <div className="rounded-2xl border-3 overflow-hidden shadow-[4px_4px_0px_black]"
      style={{ background: cardBg, borderColor: cardBdr }}>
      {post.image_url && (
        <div className="w-full aspect-video overflow-hidden">
          <img src={post.image_url} alt="post" className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="font-black text-xs">{post.username || (post.user_id ? 'Orbiter' : 'Anonymous')}</span>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${post.is_participant ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
            ● {post.is_participant ? 'PARTICIPANT' : post.user_id ? 'ORBITER' : 'ANON'}
          </span>
          <span className="text-[9px] text-gray-400 ml-auto">{dateStr} · {timeStr}</span>
        </div>
        <div className="text-sm leading-relaxed mb-3 break-words min-h-[1.5rem]"
          dangerouslySetInnerHTML={{ __html: post.content?.html || post.content || '' }} />
        <div className="flex items-center gap-1 flex-wrap">
          {topEmojis.map(([emoji, count]) => (
            <button key={emoji} onMouseDown={e => e.preventDefault()} onClick={() => onReact(post.id, emoji)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-full border-2 border-black text-xs font-black hover:scale-105 transition-transform bg-gray-50">
              {emoji}<span className="text-[10px]">{count}</span>
            </button>
          ))}
          <button onMouseDown={e => e.preventDefault()} onClick={() => setQepOpen(v => !v)}
            className="px-2 py-0.5 rounded-full border-2 border-black text-xs font-black bg-gray-50 hover:scale-105 transition-transform">+</button>
          {(postReactions?.length > 0) && (
            <button onMouseDown={e => e.preventDefault()} onClick={() => onOpenReactors(post.id)}
              className="px-2 py-0.5 rounded-full border-2 border-black text-[10px] font-black bg-gray-50 hover:scale-105 transition-transform">…</button>
          )}
          <span className="ml-auto text-[9px] font-black px-1.5 py-0.5 rounded-full bg-gray-100 border border-gray-300 text-gray-600">{locationTag}</span>
        </div>
        {qepOpen && (
          <div className="mt-2">
            <EmojiPicker embedded={true} compact={true} value=""
              onChange={e => { if (e) { onReact(post.id, e); setQepOpen(false); } }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── ReactorListModal ──────────────────────────────────────────────────────────
function ReactorListModal({ postId, reactions, onClose }) {
  if (!postId) return null;
  const list = reactions[postId] || [];
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white border-3 border-black rounded-2xl shadow-[6px_6px_0px_black] p-4 w-full max-w-xs">
        <button onClick={onClose} className="absolute top-2 right-3 font-black text-lg">✕</button>
        <h3 className="font-black mb-3">Reactions</h3>
        {list.length === 0 && <p className="text-sm text-gray-400">No reactions yet</p>}
        <div className="max-h-60 overflow-y-auto space-y-1">
          {list.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-lg">{r.emoji_text}</span>
              <span className="font-semibold">{r.username || 'Orbiter'}</span>
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
      setPosts(data || []);
      setVisibleCount(PAGE_SIZE);
      if (data?.length > 0) {
        const rxns = await fetchReactionsForPosts(data.map(p => p.id));
        const byPost = {};
        (rxns || []).forEach(r => { if (!byPost[r.post_id]) byPost[r.post_id] = []; byPost[r.post_id].push(r); });
        setReactions(byPost);
      }
    } catch {}
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

  // ── post fill live preview ────────────────────────────────────────────────────
  useEffect(() => {
    if (editorRef.current) editorRef.current.style.backgroundColor = postFill || '';
  }, [postFill]);

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
      className="flex items-center justify-center w-6 h-6 rounded text-[11px] font-black transition-all hover:opacity-80 flex-shrink-0"
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
      // ── Authenticated path ──────────────────────────────────────────────────
      const existing = (reactions[postId] || []).find(r => r.user_id === session.user.id && r.emoji_text === emoji);
      try {
        if (existing) {
          await removePostReaction(postId, emoji, session);
          setReactions(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(r => !(r.user_id === session.user.id && r.emoji_text === emoji)) }));
        } else {
          await addPostReaction(postId, emoji, session);
          setReactions(prev => ({ ...prev, [postId]: [...(prev[postId] || []), { post_id: postId, emoji_text: emoji, user_id: session.user.id, username: session.user.user_metadata?.username }] }));
        }
      } catch {}
    } else {
      // ── Anonymous path — localStorage dedup, no points awarded ─────────────
      const key = `${postId}:${emoji}`;
      const anonSet = getAnonSet();
      if (anonSet.has(key)) {
        // Toggle off: remove from localStorage + local state (can't remove from DB for null user_id)
        anonSet.delete(key);
        saveAnonSet(anonSet);
        setReactions(prev => {
          const list = [...(prev[postId] || [])];
          const idx = list.findIndex(r => r.emoji_text === emoji && r.user_id == null);
          if (idx !== -1) list.splice(idx, 1);
          return { ...prev, [postId]: list };
        });
      } else {
        // Toggle on: add to DB (null user_id = no points trigger) + localStorage + local state
        anonSet.add(key);
        saveAnonSet(anonSet);
        try { await addPostReaction(postId, emoji, null); } catch {}
        setReactions(prev => ({
          ...prev,
          [postId]: [...(prev[postId] || []), { post_id: postId, emoji_text: emoji, user_id: null }],
        }));
      }
    }
  };

  // ── filter helpers ────────────────────────────────────────────────────────────
  const activeFS = { background: accentColor, color: '#fff', borderColor: accentColor };
  const baseFB   = 'relative px-2.5 py-1 rounded-lg border-2 border-black text-[10px] sm:text-xs font-black transition-all flex items-center gap-0.5';
  const timeLabel = timeFilter === 'all' ? 'Time' : TIME_OPTIONS.find(t => t.key === timeFilter)?.label || 'Time';
  const zipList   = (locTab === 'borough' && filterBorough) ? (BOROUGH_ZIPS[filterBorough] || []) : (BOROUGH_ZIPS[filterZipBoro] || []);
  const visiblePosts = posts.slice(0, visibleCount);
  const canShowMore  = visibleCount < posts.length;
  const canShowLess  = visibleCount > PAGE_SIZE;

  const Divider = () => <div className="w-px h-4 bg-gray-300 mx-0.5 flex-shrink-0" />;

  return (
    <div className="flex-1 flex flex-col min-h-0 max-w-2xl mx-auto w-full px-3 pt-3 pb-8 gap-3">

      {/* ── Create Post ──────────────────────────────────────────────────────── */}
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
        <div className="px-3 pt-3 pb-1">
          <LocationSelector scope={editorScope} setScope={setEditorScope}
            borough={editorBorough} setBorough={setEditorBorough}
            zip={editorZip} setZip={setEditorZip} accentColor={accentColor} />
        </div>

        {/* contenteditable editor — border shows postOutline simulation */}
        <div ref={editorRef} contentEditable suppressContentEditableWarning
          className="min-h-[80px] px-3 py-2 text-sm border-t border-gray-100"
          style={{
            overflowWrap: 'break-word',
            backgroundColor: postFill || undefined,
            outline: postOutline ? `3px solid ${postOutline}` : 'none',
          }} />

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="border-t border-gray-200 px-2 py-1 flex items-center gap-0.5 flex-wrap bg-gray-50">

          {/* Undo / Redo */}
          {tbBtn(false, e => { e.preventDefault(); execCmd('undo'); }, '↩', 'Undo')}
          {tbBtn(false, e => { e.preventDefault(); execCmd('redo'); }, '↪', 'Redo')}
          <Divider />

          {/* B / I / U */}
          {tbBtn(fmtBold,      e => { e.preventDefault(); execCmd('bold');      }, <strong>B</strong>, 'Bold')}
          {tbBtn(fmtItalic,    e => { e.preventDefault(); execCmd('italic');    }, <em>I</em>,         'Italic')}
          {tbBtn(fmtUnderline, e => { e.preventDefault(); execCmd('underline'); }, <u>U</u>,           'Underline')}
          <Divider />

          {/* Alignment */}
          {tbBtn(fmtAlign === 'left',   e => { e.preventDefault(); handleAlign('left');   }, <AlignLeftIcon />,   'Align Left')}
          {tbBtn(fmtAlign === 'center', e => { e.preventDefault(); handleAlign('center'); }, <AlignCenterIcon />, 'Align Center')}
          {tbBtn(fmtAlign === 'right',  e => { e.preventDefault(); handleAlign('right');  }, <AlignRightIcon />,  'Align Right')}
          <Divider />

          {/* Font size */}
          {tbBtn(fmtSize < 3, e => { e.preventDefault(); handleFontSize(-1); }, <span className="text-[10px]">A↓</span>, 'Font Smaller')}
          {tbBtn(fmtSize > 3, e => { e.preventDefault(); handleFontSize(+1); }, <span className="text-[10px]">A↑</span>, 'Font Larger')}
          <Divider />

          {/* Lists */}
          {tbBtn(false, e => { e.preventDefault(); openTb('list'); }, <span className="text-[10px]">☰▾</span>, 'Lists', listBtnRef)}
          <PortalPopup btnRef={listBtnRef} open={openToolbar === 'list'} onClose={closeToolbar} minWidth={140}>
            <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
              {[['bullet','• Bullets'],['number','1. Numbers'],['roman','I. Roman'],['remove','Remove']].map(([t, label]) => (
                <button key={t} onMouseDown={e => e.preventDefault()} onClick={() => handleList(t)}
                  className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 whitespace-nowrap">{label}</button>
              ))}
            </div>
          </PortalPopup>

          {/* Cool Font */}
          {tbBtn(!!activeCoolFont, e => { e.preventDefault(); openTb('coolFont'); }, <span className="text-[10px]" style={activeCoolFont ? { color: '#fff' } : {}}>Ψ▾</span>, 'Cool Font', coolBtnRef)}
          <PortalPopup btnRef={coolBtnRef} open={openToolbar === 'coolFont'} onClose={closeToolbar} minWidth={170}>
            <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden" style={{ maxHeight: 300, overflowY: 'auto' }}>
              {activeCoolFont && (
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setActiveCoolFont(null); setOpenToolbar(null); }}
                  className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200">✕ Off</button>
              )}
              {ALL_COOL_FONTS.map(f => (
                <button key={f.key} onMouseDown={e => e.preventDefault()} onClick={() => handleCoolFont(f.key)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 whitespace-nowrap flex items-center gap-2"
                  style={activeCoolFont === f.key ? { background: accentColor + '22', color: accentColor } : {}}>
                  <span className="font-black text-[10px] w-16 truncate">{f.label}</span>
                  <span className="text-gray-500 text-[10px]">{f.name}</span>
                </button>
              ))}
            </div>
          </PortalPopup>
          <Divider />

          {/* Text Color */}
          {tbBtn(openToolbar === 'textColor',
            e => { e.preventDefault(); openTb('textColor'); },
            <span style={{ borderBottom: `3px solid ${textColor}`, fontWeight: 900, fontSize: 11, lineHeight: 1.1, paddingBottom: 1 }}>A</span>,
            'Text Color', txtColBtnRef)}
          <PortalPopup btnRef={txtColBtnRef} open={openToolbar === 'textColor'} onClose={closeToolbar} minWidth={180}>
            <HexColorPicker value={textColor} onChange={handleApplyTextColor} onClose={closeToolbar} />
          </PortalPopup>

          {/* Post Fill */}
          {tbBtn(!!postFill || openToolbar === 'postFill',
            e => { e.preventDefault(); openTb('postFill'); },
            <span style={{ fontSize: 13 }}>🪣</span>, 'Post Fill Color', fillBtnRef)}
          <PortalPopup btnRef={fillBtnRef} open={openToolbar === 'postFill'} onClose={closeToolbar} minWidth={180}>
            <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
              {postFill && (
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setPostFill(''); setOpenToolbar(null); }}
                  className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear fill</button>
              )}
              <div className="p-1">
                <HexColorPicker value={postFill || '#ffffff'} onChange={c => setPostFill(c)} onClose={closeToolbar} />
              </div>
            </div>
          </PortalPopup>

          {/* Post Outline */}
          {tbBtn(!!postOutline || openToolbar === 'postOutline',
            e => { e.preventDefault(); openTb('postOutline'); },
            <span style={{ fontSize: 10, border: `2px solid ${postOutline || '#555'}`, padding: '0 2px', borderRadius: 2 }}>□</span>,
            'Post Outline Color', outlineBtnRef)}
          <PortalPopup btnRef={outlineBtnRef} open={openToolbar === 'postOutline'} onClose={closeToolbar} minWidth={180} alignRight>
            <div className="bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
              {postOutline && (
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setPostOutline(''); setOpenToolbar(null); }}
                  className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200 hover:bg-gray-200">✕ Clear outline</button>
              )}
              <div className="p-1">
                <HexColorPicker value={postOutline || '#000000'} onChange={c => setPostOutline(c)} onClose={closeToolbar} />
              </div>
            </div>
          </PortalPopup>

          {/* Emoji */}
          {tbBtn(openToolbar === 'emoji',
            e => { e.preventDefault(); openTb('emoji'); },
            <span style={{ fontSize: 13 }}>😀</span>, 'Emoji', emojiBtnRef)}
          <PortalPopup btnRef={emojiBtnRef} open={openToolbar === 'emoji'} onClose={closeToolbar} minWidth={300} alignRight>
            <EmojiPicker embedded={true} compact={true} value=""
              onChange={e => { if (e) handleInsertEmoji(e); }} />
          </PortalPopup>

          {/* Clear */}
          {tbBtn(false, e => { e.preventDefault(); handleClear(); }, '✕', 'Clear')}
        </div>

        {/* submit row */}
        <div className="px-3 pb-3 pt-2 flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          <button onMouseDown={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}
            className="px-2 py-1 border-2 border-black rounded-lg text-xs font-black bg-white hover:bg-gray-100 shadow-[2px_2px_0px_black]">
            📎 Image
          </button>
          {submitError && <p className="text-[10px] text-red-600 font-semibold flex-1 truncate">{submitError}</p>}
          <button onMouseDown={e => e.preventDefault()} onClick={handlePost} disabled={submitting}
            className="ml-auto px-3 py-1.5 border-2 border-black rounded-lg text-xs font-black shadow-[2px_2px_0px_black]"
            style={{ background: accentColor, color: '#fff' }}>
            {submitting ? '...' : 'Post'}
          </button>
        </div>
      </div>

      {/* ── Check-In Popup ───────────────────────────────────────────────────── */}
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

      {/* ── Geo-Feed Separator ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 border-t-2 border-black" />
        <span className="font-black text-xs text-black whitespace-nowrap px-1">— Geo-Feed —</span>
        <div className="flex-1 border-t-2 border-black" />
      </div>

      {/* ── Filter Bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* 🔥 Top — leftmost */}
        <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)}
          className={baseFB} style={sortByTop ? activeFS : {}}>
          🔥 Top
        </button>
        {/* 🌀 All */}
        <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setFilterBorough(''); setFilterZip(''); setOpenDropdown(null); }}
          className={baseFB} style={locTab === 'all' ? activeFS : {}}>
          🌀 All
        </button>
        {/* 🏙 Borough */}
        <div className="relative">
          <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'borough' ? null : 'borough')}
            className={baseFB}
            style={locTab === 'borough' && filterBorough ? activeFS : {}}>
            🏙 {locTab === 'borough' && filterBorough ? filterBorough : 'Borough'} ▾
          </button>
          <InlineDropdown open={openDropdown === 'borough'} onClose={() => setOpenDropdown(null)}>
            {BOROUGHS.map(b => (
              <button key={b} onMouseDown={e => e.preventDefault()}
                onClick={() => { setFilterBorough(b); setLocTab('borough'); setFilterZipBoro(b); setOpenDropdown(null); }}
                className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100"
                style={filterBorough === b ? { background: accentColor + '22', color: accentColor } : {}}>
                {b}
              </button>
            ))}
          </InlineDropdown>
        </div>
        {/* 📍 Zip */}
        <div className="relative">
          <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'zip' ? null : 'zip')}
            className={baseFB} style={locTab === 'zip' && filterZip ? activeFS : {}}>
            📍 {locTab === 'zip' && filterZip ? filterZip : 'Zip'} ▾
          </button>
          <InlineDropdown open={openDropdown === 'zip'} onClose={() => setOpenDropdown(null)} className="w-[220px] max-h-[280px]">
            {/* Borough row only when no borough filter active */}
            {!(locTab === 'borough' && filterBorough) && (
              <div className="p-2 border-b border-gray-200">
                <div className="flex gap-1 flex-wrap">
                  {BOROUGHS.map(b => (
                    <button key={b} onMouseDown={e => e.preventDefault()} onClick={() => setFilterZipBoro(b)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black"
                      style={filterZipBoro === b ? { background: accentColor, color: '#fff' } : {}}>
                      {b.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {zipList.map(z => (
              <button key={z.zip} onMouseDown={e => e.preventDefault()}
                onClick={() => { setFilterZip(z.zip); setLocTab('zip'); setOpenDropdown(null); }}
                className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100"
                style={filterZip === z.zip ? { background: accentColor + '22', color: accentColor } : {}}>
                {z.zip} <span className="text-[10px] text-gray-400">{z.name}</span>
              </button>
            ))}
          </InlineDropdown>
        </div>
        {/* Time */}
        <div className="relative">
          <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'time' ? null : 'time')}
            className={baseFB} style={timeFilter !== 'all' ? activeFS : {}}>
            {timeLabel} ▾
          </button>
          <InlineDropdown open={openDropdown === 'time'} onClose={() => setOpenDropdown(null)}>
            {TIME_OPTIONS.map(t => (
              <button key={t.key} onMouseDown={e => e.preventDefault()}
                onClick={() => { setTimeFilter(t.key); setOpenDropdown(null); }}
                className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100"
                style={timeFilter === t.key ? { background: accentColor + '22', color: accentColor } : {}}>
                {t.label}
              </button>
            ))}
          </InlineDropdown>
        </div>
        {/* Status */}
        <div className="relative">
          <button onMouseDown={e => e.preventDefault()} onClick={() => setOpenDropdown(p => p === 'status' ? null : 'status')}
            className={baseFB}
            style={statusFilter === 'participant' ? { background: '#22c55e', color: '#fff', borderColor: '#22c55e' }
                 : statusFilter === 'orbiter'     ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' }
                 : {}}>
            {statusFilter === 'participant' ? 'Participant' : statusFilter === 'orbiter' ? 'Orbiter' : 'Status'} ▾
          </button>
          <InlineDropdown open={openDropdown === 'status'} onClose={() => setOpenDropdown(null)} alignRight>
            {[['all','All'],['participant','Participant'],['orbiter','Orbiter']].map(([k, l]) => (
              <button key={k} onMouseDown={e => e.preventDefault()}
                onClick={() => { setStatusFilter(k); setOpenDropdown(null); }}
                className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100"
                style={statusFilter === k ? { background: accentColor + '22', color: accentColor } : {}}>
                {l}
              </button>
            ))}
          </InlineDropdown>
        </div>
      </div>

      {/* ── Feed ─────────────────────────────────────────────────────────────── */}
      {loading && <p className="text-center text-sm text-gray-400 font-semibold py-4">Loading...</p>}
      {!loading && posts.length === 0 && (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">🌀</div>
          <p className="font-black text-gray-500">Nothing here yet! Be the first!</p>
        </div>
      )}
      {!loading && posts.length > 0 && (
        <div className="flex flex-col gap-3">
          {visiblePosts.map(post => (
            <PostCard key={post.id} post={post} postReactions={reactions[post.id]}
              onReact={handleReact} onOpenReactors={id => setReactorsModal(id)} accentColor={accentColor} />
          ))}
          {(canShowMore || canShowLess) && (
            <div className="flex justify-center gap-3 pt-1">
              {canShowMore && (
                <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                  className="px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform">
                  Show More ({posts.length - visibleCount} remaining)
                </button>
              )}
              {canShowLess && (
                <button onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(PAGE_SIZE)}
                  className="px-4 py-1.5 border-2 border-black rounded-full text-xs font-black bg-white shadow-[2px_2px_0px_black] hover:scale-105 transition-transform">
                  Show Less
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <ReactorListModal postId={reactorsModal} reactions={reactions} onClose={() => setReactorsModal(null)} />
    </div>
  );
}
