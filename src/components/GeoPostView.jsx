// @ts-nocheck
import { useState, useRef, useEffect, useCallback } from 'react';
import { useSiteTheme } from '../lib/theme';
import { containsProfanity } from '../lib/profanityFilter';
import { isUserInZipCode } from '../lib/locationService';
import {
  fetchGeoPostFeed,
  submitGeoPost,
  uploadGeoPostImage,
  addPostReaction,
  removePostReaction,
  fetchReactionsForPosts,
} from '../lib/supabase';
import { uploadToOracleCloud, isOciConfigured } from '../lib/oracleStorage';
import { NYC_ZIP_FEATURES } from '../lib/nycZipGeoJSON';
import { ALL_COOL_FONTS, convertFont } from '../lib/unicodeFonts';

// ── constants ─────────────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 500 * 1024;
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const BOROUGH_ZIPS = BOROUGHS.reduce((acc, b) => {
  acc[b] = NYC_ZIP_FEATURES.filter(z => z.borough === b).sort((a, b) => a.zip.localeCompare(b.zip));
  return acc;
}, {});
const ALL_ZIPS = [...NYC_ZIP_FEATURES].sort((a, b) => a.zip.localeCompare(b.zip));
const QUICK_EMOJIS = ['😂','❤️','🔥','😍','👏','🙌','💯','😭','🤩','😎','👀','🎉','💀','🤔','😤','🥹'];
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

// ── HexColorPicker ─────────────────────────────────────────────────────────────
function HexColorPicker({ value, onChange, onClose }) {
  const [hex, setHex] = useState(value.replace('#', ''));
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  const applyHex = (h) => {
    const clean = h.replace('#', '');
    if (/^[0-9a-fA-F]{6}$/.test(clean)) { onChange('#' + clean); }
  };
  return (
    <div ref={ref}
      className="absolute z-[9999] bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] p-2 w-[180px]"
      style={{ top: '110%', left: 0 }}>
      <div className="grid grid-cols-6 gap-1 mb-2">
        {PRESET_COLORS.map(c => (
          <button key={c} onMouseDown={e => { e.preventDefault(); onChange(c); onClose(); }}
            className="w-5 h-5 rounded border border-gray-400 cursor-pointer hover:scale-110 transition-transform"
            style={{ background: c, outline: c === value ? '2px solid #7C3AED' : 'none' }} />
        ))}
      </div>
      <div className="flex items-center gap-1">
        <span className="font-black text-[10px]">#</span>
        <input
          value={hex} maxLength={6}
          onChange={e => { setHex(e.target.value); applyHex(e.target.value); }}
          className="flex-1 border-2 border-black rounded px-1 text-[11px] font-mono w-0"
          style={{ background: /^[0-9a-fA-F]{6}$/.test(hex) ? '#' + hex : '#fff' }} />
        <button onMouseDown={e => { e.preventDefault(); applyHex(hex); onClose(); }}
          className="px-1.5 py-0.5 bg-black text-white rounded text-[10px] font-black">OK</button>
      </div>
    </div>
  );
}

// ── LocationSelector ───────────────────────────────────────────────────────────
function LocationSelector({ scope, setScope, borough, setBorough, zip, setZip, accentColor }) {
  const [step, setStep] = useState(scope === 'zip' ? 'zip' : scope === 'borough' ? 'borough' : scope);
  const boroughZips = BOROUGH_ZIPS[borough] || [];
  const handleScope = (s) => {
    setScope(s);
    setStep(s);
    if (s !== 'zip' && s !== 'borough') { setBorough('Manhattan'); setZip(''); }
    if (s === 'borough') setZip('');
  };
  const scopeBtn = (key, emoji, label) => {
    const active = scope === key;
    return (
      <button onMouseDown={e => e.preventDefault()} onClick={() => handleScope(key)}
        className="px-2 py-1 rounded-lg border-2 border-black text-[10px] sm:text-xs font-black transition-all"
        style={active ? { background: accentColor, color: '#fff', borderColor: accentColor } : {}}>
        {emoji} {label}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] font-black text-gray-500 mr-0.5">Posting to:</span>
        {scopeBtn('digital','💻','Digital')}
        {scopeBtn('nyc','🗽','NYC')}
        {(scope === 'nyc' || scope === 'borough' || scope === 'zip') && (
          <select value={borough} onChange={e => { setBorough(e.target.value); if (scope === 'zip') setZip(''); setScope('borough'); setStep('borough'); }}
            className="border-2 border-black rounded-lg px-1.5 py-0.5 text-[10px] font-black bg-white cursor-pointer">
            {BOROUGHS.map(b => <option key={b}>{b}</option>)}
          </select>
        )}
        {(scope === 'borough' || scope === 'zip') && (
          <select value={zip} onChange={e => { setZip(e.target.value); setScope('zip'); }}
            className="border-2 border-black rounded-lg px-1.5 py-0.5 text-[10px] font-black bg-white cursor-pointer">
            <option value="">— zip —</option>
            {boroughZips.map(z => <option key={z.zip} value={z.zip}>{z.zip} {z.name}</option>)}
          </select>
        )}
      </div>
      <p className="text-[9px] text-gray-400 font-medium">you can post at the zip, borough, or city level</p>
    </div>
  );
}

// ── AlignIcon ──────────────────────────────────────────────────────────────────
const AlignLeftIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="10" height="2" rx="1"/>
    <rect x="1" y="12" width="12" height="2" rx="1"/>
  </svg>
);
const AlignCenterIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="3" y="7" width="10" height="2" rx="1"/>
    <rect x="2" y="12" width="12" height="2" rx="1"/>
  </svg>
);
const AlignRightIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="5" y="7" width="10" height="2" rx="1"/>
    <rect x="3" y="12" width="12" height="2" rx="1"/>
  </svg>
);

// ── PostCard ───────────────────────────────────────────────────────────────────
function PostCard({ post, postReactions, onReact, onOpenReactors, accentColor }) {
  const { resolvedTheme } = useSiteTheme();
  const bg = resolvedTheme?.surfaceBackgroundColor || '#fff';
  const border = resolvedTheme?.tileShadowColor || '#000';
  const date = new Date(post.created_at);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // top-4 reactions
  const emojiCounts = {};
  (postReactions || []).forEach(r => { emojiCounts[r.emoji_text] = (emojiCounts[r.emoji_text] || 0) + 1; });
  const topEmojis = Object.entries(emojiCounts).sort((a,b)=>b[1]-a[1]).slice(0,4);

  const locationTag = (() => {
    if (post.zip_code) return `📍 ${post.zip_code} · ${post.borough}`;
    if (post.borough)  return `🏙 ${post.borough}`;
    if (post.scope === 'nyc') return '🗽 NYC';
    return '💻 Digital';
  })();

  return (
    <div className="rounded-2xl border-3 border-black overflow-hidden shadow-[4px_4px_0px_black]" style={{ background: bg }}>
      {post.image_url && (
        <div className="w-full aspect-video overflow-hidden">
          <img src={post.image_url} alt="post" className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
      <div className="p-3">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="font-black text-xs">{post.username || 'Orbiter'}</span>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${post.is_participant ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
            ● {post.is_participant ? 'PARTICIPANT' : 'ORBITER'}
          </span>
          <span className="text-[9px] text-gray-400 ml-auto">{dateStr} · {timeStr}</span>
        </div>
        {/* Content */}
        <div className="text-sm leading-relaxed mb-3 break-words min-h-[1.5rem]"
          dangerouslySetInnerHTML={{ __html: post.content?.html || post.content || '' }} />
        {/* Footer: reactions + location tag */}
        <div className="flex items-center gap-1 flex-wrap">
          {topEmojis.map(([emoji, count]) => (
            <button key={emoji} onMouseDown={e => e.preventDefault()} onClick={() => onReact(post.id, emoji)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-full border-2 border-black text-xs font-black hover:scale-105 transition-transform bg-gray-50">
              {emoji}<span className="text-[10px]">{count}</span>
            </button>
          ))}
          <button onMouseDown={e => e.preventDefault()}
            onClick={() => document.getElementById(`qep-${post.id}`)?.classList.toggle('hidden')}
            className="px-2 py-0.5 rounded-full border-2 border-black text-xs font-black bg-gray-50 hover:scale-105 transition-transform">+</button>
          {(postReactions?.length > 0) && (
            <button onMouseDown={e => e.preventDefault()} onClick={() => onOpenReactors(post.id)}
              className="px-2 py-0.5 rounded-full border-2 border-black text-[10px] font-black bg-gray-50 hover:scale-105 transition-transform">…</button>
          )}
          <div className="ml-auto">
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-gray-100 border border-gray-300 text-gray-600">{locationTag}</span>
          </div>
        </div>
        {/* Quick emoji picker (hidden by default) */}
        <div id={`qep-${post.id}`} className="hidden mt-2 flex flex-wrap gap-1">
          {QUICK_EMOJIS.map(e => (
            <button key={e} onMouseDown={ev => ev.preventDefault()} onClick={() => { onReact(post.id, e); document.getElementById(`qep-${post.id}`)?.classList.add('hidden'); }}
              className="text-sm hover:scale-125 transition-transform px-0.5">{e}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ReactorListModal ───────────────────────────────────────────────────────────
function ReactorListModal({ postId, reactions, onClose }) {
  if (!postId) return null;
  const postReactions = reactions[postId] || [];
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white border-3 border-black rounded-2xl shadow-[6px_6px_0px_black] p-4 w-full max-w-xs">
        <button onClick={onClose} className="absolute top-2 right-3 font-black text-lg">✕</button>
        <h3 className="font-black mb-3">Reactions</h3>
        {postReactions.length === 0 && <p className="text-sm text-gray-400">No reactions yet</p>}
        <div className="max-h-60 overflow-y-auto space-y-1">
          {postReactions.map((r, i) => (
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

// ── image compression ──────────────────────────────────────────────────────────
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
          if (blob.size <= MAX_IMAGE_BYTES || q <= 0.3) { resolve(new File([blob], file.name, { type: 'image/jpeg' })); }
          else { q = Math.max(0.3, q - 0.12); tryQ(); }
        }, 'image/jpeg', q);
      };
      tryQ();
    };
    img.src = url;
  });
}

// ── Inline Dropdown wrapper ────────────────────────────────────────────────────
function InlineDropdown({ open, onClose, children, alignRight = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref}
      className={`absolute top-full mt-1 z-[9999] bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden min-w-[120px] max-h-[280px] overflow-y-auto ${alignRight ? 'right-0' : 'left-0'}`}>
      {children}
    </div>
  );
}

// ── Main GeoPostView ───────────────────────────────────────────────────────────
export default function GeoPostView({ session }) {
  const { resolvedTheme } = useSiteTheme();
  const accentColor = resolvedTheme?.accentColor || '#7C3AED';
  const surfaceBg = resolvedTheme?.surfaceBackgroundColor || '#fff';

  // ── filter state ─────────────────────────────────────────────────────────────
  const [locTab, setLocTab] = useState('all');         // 'all'|'borough'|'zip'
  const [filterBorough, setFilterBorough] = useState('Manhattan');
  const [filterZipBorough, setFilterZipBorough] = useState('Manhattan');
  const [filterZip, setFilterZip] = useState('');
  const [timeFilter, setTimeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortByTop, setSortByTop] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null); // 'borough'|'zip'|'time'|'status'

  // ── feed state ───────────────────────────────────────────────────────────────
  const [posts, setPosts] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [reactions, setReactions] = useState({});
  const [reactorsModal, setReactorsModal] = useState(null);

  // ── editor state ─────────────────────────────────────────────────────────────
  const [editorScope, setEditorScope] = useState('digital');
  const [editorBorough, setEditorBorough] = useState('Manhattan');
  const [editorZip, setEditorZip] = useState('');
  const editorRef = useRef(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showCheckin, setShowCheckin] = useState(false);
  const pendingPostRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── toolbar state ─────────────────────────────────────────────────────────────
  const [fmtBold, setFmtBold] = useState(false);
  const [fmtItalic, setFmtItalic] = useState(false);
  const [fmtUnderline, setFmtUnderline] = useState(false);
  const [fmtAlign, setFmtAlign] = useState('left');
  const [fmtSize, setFmtSize] = useState(3);  // 1-6, 3=normal
  const [activeCoolFont, setActiveCoolFont] = useState(null);
  const [showListMenu, setShowListMenu] = useState(false);
  const [showCoolFontMenu, setShowCoolFontMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTextColor, setShowTextColor] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [textColor, setTextColor] = useState('#000000');
  const [highlightColor, setHighlightColor] = useState('#FFFF00');
  const savedRangeRef = useRef(null);
  const coolFontHandlerRef = useRef(null);
  const toolbarRef = useRef(null);

  // ── load feed ─────────────────────────────────────────────────────────────────
  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const type = locTab === 'borough' ? 'borough' : locTab === 'zip' ? 'zip' : 'all';
      const value = locTab === 'borough' ? filterBorough : locTab === 'zip' ? filterZip : null;
      const data = await fetchGeoPostFeed({ type, value, timeFilter, statusFilter, sortByTop });
      setPosts(data || []);
      setVisibleCount(PAGE_SIZE);
      if (data?.length > 0) {
        const ids = data.map(p => p.id);
        const rxns = await fetchReactionsForPosts(ids);
        const byPost = {};
        (rxns || []).forEach(r => {
          if (!byPost[r.post_id]) byPost[r.post_id] = [];
          byPost[r.post_id].push(r);
        });
        setReactions(byPost);
      }
    } catch {}
    setLoading(false);
  }, [locTab, filterBorough, filterZip, timeFilter, statusFilter, sortByTop]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // ── selectionchange tracking ──────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      if (!editorRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!editorRef.current.contains(range.commonAncestorContainer)) return;
      setFmtBold(document.queryCommandState('bold'));
      setFmtItalic(document.queryCommandState('italic'));
      setFmtUnderline(document.queryCommandState('underline'));
      if (document.queryCommandState('justifyCenter')) setFmtAlign('center');
      else if (document.queryCommandState('justifyRight')) setFmtAlign('right');
      else if (document.queryCommandState('justifyFull')) setFmtAlign('full');
      else setFmtAlign('left');
      const sz = parseInt(document.queryCommandValue('fontSize')) || 3;
      setFmtSize(sz);
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  // ── cool font keydown intercept ───────────────────────────────────────────────
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (coolFontHandlerRef.current) editor.removeEventListener('keydown', coolFontHandlerRef.current);
    if (!activeCoolFont) { coolFontHandlerRef.current = null; return; }
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      e.preventDefault();
      const converted = convertFont(e.key, activeCoolFont);
      document.execCommand('insertText', false, converted);
    };
    coolFontHandlerRef.current = handler;
    editor.addEventListener('keydown', handler);
    return () => editor.removeEventListener('keydown', handler);
  }, [activeCoolFont]);

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

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const execCmd = (cmd, val = null) => {
    focusEditor();
    document.execCommand(cmd, false, val);
  };

  const tbBtn = (active, onMD, children, title = '') => (
    <button title={title} onMouseDown={onMD}
      className="flex items-center justify-center w-6 h-6 rounded text-[11px] font-black transition-all hover:opacity-80"
      style={{ background: active ? accentColor : 'transparent', color: active ? '#fff' : 'inherit' }}>
      {children}
    </button>
  );

  const handleFontSize = (dir) => {
    focusEditor();
    const cur = fmtSize || 3;
    const next = Math.max(1, Math.min(6, cur + dir));
    document.execCommand('fontSize', false, String(next));
    setFmtSize(next);
  };

  const handleApplyCoolFont = (key) => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      // Apply to selection
      const text = sel.toString();
      const converted = convertFont(text, key);
      focusEditor();
      document.execCommand('insertText', false, converted);
      setActiveCoolFont(null);
    } else {
      // Toggle intercept mode
      setActiveCoolFont(prev => prev === key ? null : key);
    }
    setShowCoolFontMenu(false);
  };

  const handleInsertEmoji = (emoji) => {
    focusEditor();
    document.execCommand('insertText', false, emoji);
    setShowEmojiPicker(false);
  };

  const applyTextColor = (color) => {
    restoreRange();
    focusEditor();
    document.execCommand('foreColor', false, color);
    setTextColor(color);
  };

  const applyHighlight = (color) => {
    restoreRange();
    focusEditor();
    document.execCommand('hiliteColor', false, color);
    setHighlightColor(color);
  };

  // ── image handler ─────────────────────────────────────────────────────────────
  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressGeoImage(file);
    setImageFile(compressed);
    setImagePreview(URL.createObjectURL(compressed));
    e.target.value = '';
  };

  // ── submit flow ───────────────────────────────────────────────────────────────
  const handlePost = async () => {
    const html = editorRef.current?.innerHTML?.trim();
    if (!html && !imageFile) { setSubmitError('Write something or add an image.'); return; }
    if (html && containsProfanity(editorRef.current?.innerText || '')) {
      setSubmitError('Post flagged for review.');
      await doSubmit(html, false, false);
      return;
    }
    // digital = no checkin popup
    if (editorScope === 'digital') {
      await doSubmit(html, false, false);
      return;
    }
    // For nyc/borough/zip — show checkin popup
    pendingPostRef.current = html;
    setShowCheckin(true);
  };

  const doSubmit = async (html, isPending = false, isParticipant = false, post_approved = true) => {
    const content = { html, fillColor: textColor };
    let image_url = null;
    try {
      setSubmitting(true);
      setSubmitError('');
      if (imageFile) {
        image_url = isOciConfigured()
          ? await uploadToOracleCloud(imageFile)
          : await uploadGeoPostImage(imageFile, session);
      }
      const payload = {
        content,
        image_url,
        scope: editorScope,
        borough: (editorScope === 'borough' || editorScope === 'zip') ? editorBorough : null,
        zip_code: editorScope === 'zip' ? editorZip : null,
        is_participant: isParticipant,
        post_approved,
        user_id: session?.user?.id || null,
      };
      await submitGeoPost(payload, session);
      if (editorRef.current) editorRef.current.innerHTML = '';
      setImageFile(null); setImagePreview(null);
      setShowCheckin(false);
      await loadFeed();
    } catch (err) {
      setSubmitError(err.message || 'Failed to post. Try again.');
    }
    setSubmitting(false);
  };

  const handleCheckinYes = async () => {
    const html = pendingPostRef.current;
    if (editorScope === 'zip' && editorZip) {
      const res = await isUserInZipCode(editorZip);
      if (res === 'confirmed') { await doSubmit(html, false, true); }
      else if (res === 'cant_connect') { setSubmitError("Can't verify GPS. Try again."); setShowCheckin(false); }
      else { setSubmitError('Not in that zip. Post as Orbiter?'); setShowCheckin(false); }
    } else {
      // nyc or borough — self-attestation
      await doSubmit(html, false, true);
    }
  };

  const handleCheckinNo = async () => {
    await doSubmit(pendingPostRef.current, false, false);
  };

  // ── reaction handler ──────────────────────────────────────────────────────────
  const handleReact = async (postId, emoji) => {
    const existing = (reactions[postId] || []).find(r =>
      r.user_id === session?.user?.id && r.emoji_text === emoji
    );
    try {
      if (existing) {
        await removePostReaction(postId, emoji, session);
        setReactions(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(r => !(r.user_id === session?.user?.id && r.emoji_text === emoji)) }));
      } else {
        await addPostReaction(postId, emoji, session);
        setReactions(prev => ({
          ...prev,
          [postId]: [...(prev[postId] || []), { post_id: postId, emoji_text: emoji, user_id: session?.user?.id, username: session?.user?.user_metadata?.username }],
        }));
      }
    } catch {}
  };

  // ── filter bar helpers ────────────────────────────────────────────────────────
  const activeFilterStyle = { background: accentColor, color: '#fff', borderColor: accentColor };
  const baseFilterBtn = 'relative px-2 py-1 rounded-lg border-2 border-black text-[10px] sm:text-xs font-black transition-all flex items-center gap-0.5';

  const timeLabel = timeFilter === 'all' ? 'Time' : TIME_OPTIONS.find(t => t.key === timeFilter)?.label || 'Time';
  const timeActive = timeFilter !== 'all';

  const zipList = BOROUGH_ZIPS[filterZipBorough] || [];

  const toggleDropdown = (key) => {
    setOpenDropdown(prev => prev === key ? null : key);
  };

  const visiblePosts = posts.slice(0, visibleCount);
  const canShowMore = visibleCount < posts.length;
  const canShowLess = visibleCount > PAGE_SIZE;

  return (
    <div className="flex-1 flex flex-col min-h-0 max-w-2xl mx-auto w-full px-3 pt-3 pb-8 gap-3">
      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* 🌀 All */}
        <button onMouseDown={e => e.preventDefault()} onClick={() => { setLocTab('all'); setOpenDropdown(null); }}
          className={baseFilterBtn}
          style={locTab === 'all' ? activeFilterStyle : {}}>
          🌀 All
        </button>
        {/* 🏙 Borough */}
        <div className="relative">
          <button onMouseDown={e => e.preventDefault()}
            onClick={() => { setLocTab('borough'); toggleDropdown('borough'); }}
            className={baseFilterBtn}
            style={locTab === 'borough' ? activeFilterStyle : {}}>
            🏙 {locTab === 'borough' ? filterBorough : 'Borough'} ▾
          </button>
          <InlineDropdown open={openDropdown === 'borough'} onClose={() => setOpenDropdown(null)}>
            {BOROUGHS.map(b => (
              <button key={b} onMouseDown={e => e.preventDefault()}
                onClick={() => { setFilterBorough(b); setLocTab('borough'); setOpenDropdown(null); }}
                className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100"
                style={filterBorough === b && locTab === 'borough' ? { background: accentColor + '22', color: accentColor } : {}}>
                {b}
              </button>
            ))}
          </InlineDropdown>
        </div>
        {/* 📍 Zip */}
        <div className="relative">
          <button onMouseDown={e => e.preventDefault()}
            onClick={() => { setLocTab('zip'); toggleDropdown('zip'); }}
            className={baseFilterBtn}
            style={locTab === 'zip' && filterZip ? activeFilterStyle : locTab === 'zip' ? { background: accentColor + '22', color: accentColor, borderColor: accentColor } : {}}>
            📍 {locTab === 'zip' && filterZip ? filterZip : 'Zip'} ▾
          </button>
          <InlineDropdown open={openDropdown === 'zip'} onClose={() => setOpenDropdown(null)}>
            <div className="p-2 border-b border-gray-200">
              <div className="flex gap-1 flex-wrap">
                {BOROUGHS.map(b => (
                  <button key={b} onMouseDown={e => e.preventDefault()} onClick={() => setFilterZipBorough(b)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-black border border-black"
                    style={filterZipBorough === b ? { background: accentColor, color: '#fff' } : {}}>
                    {b.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
            {zipList.map(z => (
              <button key={z.zip} onMouseDown={e => e.preventDefault()}
                onClick={() => { setFilterZip(z.zip); setLocTab('zip'); setOpenDropdown(null); }}
                className="w-full text-left px-3 py-1 text-xs font-semibold hover:bg-gray-100"
                style={filterZip === z.zip && locTab === 'zip' ? { background: accentColor + '22', color: accentColor } : {}}>
                {z.zip} <span className="text-[10px] text-gray-500">{z.name}</span>
              </button>
            ))}
          </InlineDropdown>
        </div>
        {/* Time */}
        <div className="relative">
          <button onMouseDown={e => e.preventDefault()} onClick={() => toggleDropdown('time')}
            className={baseFilterBtn}
            style={timeActive ? activeFilterStyle : {}}>
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
          <button onMouseDown={e => e.preventDefault()} onClick={() => toggleDropdown('status')}
            className={baseFilterBtn}
            style={statusFilter !== 'all' ? activeFilterStyle : {}}>
            {statusFilter === 'participant' ? '● Part' : statusFilter === 'orbiter' ? '● Orb' : 'Status'} ▾
          </button>
          <InlineDropdown open={openDropdown === 'status'} onClose={() => setOpenDropdown(null)} alignRight>
            {[['all','All'], ['participant','Participant'], ['orbiter','Orbiter']].map(([k,l]) => (
              <button key={k} onMouseDown={e => e.preventDefault()}
                onClick={() => { setStatusFilter(k); setOpenDropdown(null); }}
                className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100"
                style={statusFilter === k ? { background: accentColor + '22', color: accentColor } : {}}>
                {l}
              </button>
            ))}
          </InlineDropdown>
        </div>
        {/* 🔥 Top */}
        <button onMouseDown={e => e.preventDefault()} onClick={() => setSortByTop(v => !v)}
          className={baseFilterBtn}
          style={sortByTop ? activeFilterStyle : {}}>
          🔥 Top
        </button>
      </div>

      {/* ── Create Post ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border-3 border-black shadow-[4px_4px_0px_black] overflow-hidden" style={{ background: surfaceBg }}>
        <div className="p-3">
          <LocationSelector
            scope={editorScope} setScope={setEditorScope}
            borough={editorBorough} setBorough={setEditorBorough}
            zip={editorZip} setZip={setEditorZip}
            accentColor={accentColor} />
        </div>

        {/* Editor */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="min-h-[80px] px-3 pb-2 text-sm outline-none border-t border-gray-100"
          style={{ overflowWrap: 'break-word' }}
          onKeyDown={() => {}}
          onFocus={() => {}} />

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <div ref={toolbarRef} className="border-t border-gray-200 px-2 py-1 flex items-center gap-0.5 flex-wrap bg-gray-50">
          {/* Undo / Redo */}
          {tbBtn(false, e => { e.preventDefault(); execCmd('undo'); }, '↩', 'Undo')}
          {tbBtn(false, e => { e.preventDefault(); execCmd('redo'); }, '↪', 'Redo')}
          <div className="w-px h-4 bg-gray-300 mx-0.5" />
          {/* Bold / Italic / Underline */}
          {tbBtn(fmtBold,      e => { e.preventDefault(); execCmd('bold'); },      <strong>B</strong>, 'Bold')}
          {tbBtn(fmtItalic,    e => { e.preventDefault(); execCmd('italic'); },    <em>I</em>, 'Italic')}
          {tbBtn(fmtUnderline, e => { e.preventDefault(); execCmd('underline'); }, <u>U</u>, 'Underline')}
          <div className="w-px h-4 bg-gray-300 mx-0.5" />
          {/* Alignment */}
          {tbBtn(fmtAlign==='left',   e => { e.preventDefault(); execCmd('justifyLeft'); },   <AlignLeftIcon />,   'Align Left')}
          {tbBtn(fmtAlign==='center', e => { e.preventDefault(); execCmd('justifyCenter'); }, <AlignCenterIcon />, 'Align Center')}
          {tbBtn(fmtAlign==='right',  e => { e.preventDefault(); execCmd('justifyRight'); },  <AlignRightIcon />,  'Align Right')}
          <div className="w-px h-4 bg-gray-300 mx-0.5" />
          {/* Font Size */}
          {tbBtn(fmtSize < 3, e => { e.preventDefault(); handleFontSize(-1); }, 'A↓', 'Font Smaller')}
          {tbBtn(fmtSize > 3, e => { e.preventDefault(); handleFontSize(+1); }, 'A↑', 'Font Larger')}
          <div className="w-px h-4 bg-gray-300 mx-0.5" />
          {/* Lists */}
          <div className="relative">
            {tbBtn(false, e => { e.preventDefault(); setShowListMenu(v => !v); setShowCoolFontMenu(false); setShowEmojiPicker(false); setShowTextColor(false); setShowHighlight(false); }, '☰▾', 'Lists')}
            {showListMenu && (
              <div className="absolute top-full left-0 mt-1 z-[9999] bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                {[['insertUnorderedList','• Bullets'],['insertOrderedList','1. Numbers'],['roman','I. Roman'],['none','Remove']].map(([cmd, label]) => (
                  <button key={cmd} onMouseDown={e => { e.preventDefault();
                    if (cmd === 'roman') {
                      focusEditor();
                      document.execCommand('insertOrderedList', false, null);
                      const sel = window.getSelection();
                      if (sel) {
                        let node = sel.anchorNode;
                        while (node && node.nodeName !== 'OL') node = node.parentNode;
                        if (node) node.style.listStyleType = 'upper-roman';
                      }
                    } else if (cmd === 'none') {
                      execCmd('insertUnorderedList'); execCmd('insertUnorderedList');
                    } else { execCmd(cmd); }
                    setShowListMenu(false);
                  }} className="w-full text-left px-3 py-1.5 text-xs font-black hover:bg-gray-100 whitespace-nowrap">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Cool Font */}
          <div className="relative">
            {tbBtn(!!activeCoolFont, e => { e.preventDefault(); setShowCoolFontMenu(v => !v); setShowListMenu(false); setShowEmojiPicker(false); setShowTextColor(false); setShowHighlight(false); }, 'Ψ▾', 'Cool Font')}
            {showCoolFontMenu && (
              <div className="absolute top-full left-0 mt-1 z-[9999] bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] overflow-hidden">
                {activeCoolFont && (
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setActiveCoolFont(null); setShowCoolFontMenu(false); }}
                    className="w-full text-left px-3 py-1.5 text-[10px] font-black bg-gray-100 border-b border-gray-200">
                    ✕ Off
                  </button>
                )}
                {ALL_COOL_FONTS.map(f => (
                  <button key={f.key} onMouseDown={e => e.preventDefault()} onClick={() => handleApplyCoolFont(f.key)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 whitespace-nowrap flex items-center gap-2"
                    style={activeCoolFont === f.key ? { background: accentColor + '22', color: accentColor } : {}}>
                    <span className="font-black text-[10px] w-16 truncate">{f.label}</span>
                    <span className="text-gray-500 text-[10px]">{f.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-gray-300 mx-0.5" />
          {/* Text Color */}
          <div className="relative">
            {tbBtn(showTextColor, e => { e.preventDefault(); saveRange(); setShowTextColor(v => !v); setShowHighlight(false); setShowEmojiPicker(false); setShowListMenu(false); setShowCoolFontMenu(false); },
              <span style={{ borderBottom: `3px solid ${textColor}`, lineHeight: 1.1, fontWeight: 900, fontSize: 11 }}>A</span>, 'Text Color')}
            {showTextColor && <HexColorPicker value={textColor} onChange={c => applyTextColor(c)} onClose={() => setShowTextColor(false)} />}
          </div>
          {/* Highlight */}
          <div className="relative">
            {tbBtn(showHighlight, e => { e.preventDefault(); saveRange(); setShowHighlight(v => !v); setShowTextColor(false); setShowEmojiPicker(false); setShowListMenu(false); setShowCoolFontMenu(false); },
              <span style={{ background: highlightColor, padding: '0 2px', fontWeight: 900, fontSize: 11 }}>🖊</span>, 'Highlight')}
            {showHighlight && <HexColorPicker value={highlightColor} onChange={c => applyHighlight(c)} onClose={() => setShowHighlight(false)} />}
          </div>
          {/* Emoji */}
          <div className="relative">
            {tbBtn(showEmojiPicker, e => { e.preventDefault(); setShowEmojiPicker(v => !v); setShowTextColor(false); setShowHighlight(false); setShowListMenu(false); setShowCoolFontMenu(false); }, '😀', 'Emoji')}
            {showEmojiPicker && (
              <div className="absolute top-full left-0 mt-1 z-[9999] bg-white border-3 border-black rounded-xl shadow-[4px_4px_0px_black] p-2 flex flex-wrap gap-1 w-[160px]">
                {QUICK_EMOJIS.map(em => (
                  <button key={em} onMouseDown={e => e.preventDefault()} onClick={() => handleInsertEmoji(em)}
                    className="text-lg hover:scale-125 transition-transform">{em}</button>
                ))}
              </div>
            )}
          </div>
          {/* Clear */}
          {tbBtn(false, e => { e.preventDefault(); if (editorRef.current) { editorRef.current.innerHTML = ''; editorRef.current.focus(); } }, '✕', 'Clear')}
        </div>

        {/* Image preview */}
        {imagePreview && (
          <div className="px-3 pb-2 pt-1 relative inline-block">
            <img src={imagePreview} alt="preview" className="max-h-32 rounded-lg border-2 border-black" />
            <button onMouseDown={e => e.preventDefault()} onClick={() => { setImageFile(null); setImagePreview(null); }}
              className="absolute -top-1 -right-1 w-5 h-5 bg-black text-white rounded-full text-[10px] flex items-center justify-center font-black">✕</button>
          </div>
        )}

        {/* Submit row */}
        <div className="px-3 pb-3 flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          <button onMouseDown={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}
            className="px-2 py-1 border-2 border-black rounded-lg text-xs font-black bg-white hover:bg-gray-100 transition-all shadow-[2px_2px_0px_black]">
            📎 Image
          </button>
          {submitError && <p className="text-[10px] text-red-600 font-semibold flex-1">{submitError}</p>}
          <button onMouseDown={e => e.preventDefault()} onClick={handlePost} disabled={submitting}
            className="ml-auto px-3 py-1.5 border-2 border-black rounded-lg text-xs font-black shadow-[2px_2px_0px_black] transition-all"
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
            <PostCard key={post.id} post={post}
              postReactions={reactions[post.id]}
              onReact={handleReact}
              onOpenReactors={id => setReactorsModal(id)}
              accentColor={accentColor} />
          ))}
          {/* Show More / Show Less */}
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

      {/* ── Reactors Modal ───────────────────────────────────────────────────── */}
      <ReactorListModal
        postId={reactorsModal}
        reactions={reactions}
        onClose={() => setReactorsModal(null)} />
    </div>
  );
}
