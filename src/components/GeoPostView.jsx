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
  fetchReactionsForPosts,
} from '../lib/supabase';
import { uploadToOracleCloud, isOciConfigured } from '../lib/oracleStorage';
import { NYC_ZIP_FEATURES } from '../lib/nycZipGeoJSON';

// ── constants ──────────────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 500 * 1024; // 500 KB
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const ZIP_OPTIONS = [...NYC_ZIP_FEATURES].sort((a, b) => a.zip.localeCompare(b.zip));

// ── image compression ─────────────────────────────────────────────────────────
async function compressGeoImage(file) {
  if (file.size <= MAX_IMAGE_BYTES) return file;
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      const MAX_DIM = 1280;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      let quality = 0.82;
      const tryCompress = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= MAX_IMAGE_BYTES || quality <= 0.3) {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          } else {
            quality -= 0.1;
            tryCompress();
          }
        }, 'image/jpeg', quality);
      };
      tryCompress();
    };
    img.src = url;
  });
}

// ── Rich Text Toolbar ─────────────────────────────────────────────────────────
function RichToolbar({ editorRef, accentColor }) {
  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };
  const textColorRef = useRef(null);
  const bgColorRef = useRef(null);

  const ALIGNS = [
    { cmd: 'justifyLeft', icon: '⬅', title: 'Align Left' },
    { cmd: 'justifyCenter', icon: '↔', title: 'Center' },
    { cmd: 'justifyRight', icon: '➡', title: 'Align Right' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b-2 border-black bg-gray-50">
      <ToolBtn onClick={() => exec('bold')} title="Bold"><b>B</b></ToolBtn>
      <ToolBtn onClick={() => exec('italic')} title="Italic"><i>I</i></ToolBtn>
      <ToolBtn onClick={() => exec('underline')} title="Underline"><u>U</u></ToolBtn>
      <span className="w-px h-4 bg-black/20 mx-0.5" />
      {ALIGNS.map(a => (
        <ToolBtn key={a.cmd} onClick={() => exec(a.cmd)} title={a.title}>{a.icon}</ToolBtn>
      ))}
      <span className="w-px h-4 bg-black/20 mx-0.5" />
      {/* Text color */}
      <label title="Text Color" className="flex items-center gap-0.5 cursor-pointer hover:opacity-80">
        <span className="text-[11px] font-black">A</span>
        <input
          type="color"
          ref={textColorRef}
          className="w-4 h-4 cursor-pointer rounded border border-black"
          defaultValue="#000000"
          onChange={e => exec('foreColor', e.target.value)}
          title="Text Color"
        />
      </label>
      {/* Highlight */}
      <label title="Highlight" className="flex items-center gap-0.5 cursor-pointer hover:opacity-80">
        <span className="text-[11px] font-black">🖊</span>
        <input
          type="color"
          ref={bgColorRef}
          className="w-4 h-4 cursor-pointer rounded border border-black"
          defaultValue="#ffff00"
          onChange={e => exec('hiliteColor', e.target.value)}
          title="Highlight Color"
        />
      </label>
      <span className="w-px h-4 bg-black/20 mx-0.5" />
      <ToolBtn onClick={() => exec('removeFormat')} title="Clear Formatting">✕</ToolBtn>
    </div>
  );
}

function ToolBtn({ onClick, children, title }) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      className="w-6 h-6 flex items-center justify-center text-[11px] font-black rounded border border-black/30 bg-white hover:bg-black hover:text-white transition-colors"
    >
      {children}
    </button>
  );
}

// ── Participant / Orbiter Popup ─────────────────────────────────────────────
function CheckInPopup({ zip, onParticipant, onOrbiter, onClose }) {
  const [status, setStatus] = useState('idle'); // idle | checking | confirmed | cant_connect | not_in_zip
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleYes = async () => {
    setStatus('checking');
    const result = await isUserInZipCode(zip);
    setStatus(result);
    if (result === 'confirmed') {
      setTimeout(() => onParticipant(), 700);
    } else {
      timerRef.current = setTimeout(() => onClose(), 1200);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_black] p-6 max-w-xs w-full mx-4 animate-in fade-in zoom-in duration-150">
        <p className="font-black text-sm leading-snug mb-5 text-center">
          Check In to send this post as a Participant with Yes, select No to continue posting to this zip as an Orbiter
        </p>

        {status === 'idle' && (
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleYes}
              className="flex-1 py-2.5 rounded-xl font-black text-sm bg-green-500 text-white border-3 border-black shadow-[3px_3px_0px_black] hover:bg-green-600 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={onOrbiter}
              className="flex-1 py-2.5 rounded-xl font-black text-sm bg-red-500 text-white border-3 border-black shadow-[3px_3px_0px_black] hover:bg-red-600 transition-colors"
            >
              No
            </button>
          </div>
        )}

        {status === 'checking' && (
          <p className="text-center text-sm font-black animate-pulse">Checking location…</p>
        )}

        {status === 'confirmed' && (
          <p className="text-center text-sm font-black text-green-600">Confirmed ✅</p>
        )}
        {status === 'cant_connect' && (
          <p className="text-center text-sm font-black text-yellow-600">Can&apos;t Connect ⚠️</p>
        )}
        {status === 'not_in_zip' && (
          <p className="text-center text-sm font-black text-red-600">Not in Zipcode ❌</p>
        )}
      </div>
    </div>
  );
}

// ── Reactor List Modal ──────────────────────────────────────────────────────
function ReactorListModal({ reactions, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_black] p-5 max-w-xs w-full mx-4 animate-in fade-in zoom-in duration-150">
        <div className="flex justify-between items-center mb-3">
          <span className="font-black text-sm">Reactions</span>
          <button onClick={onClose} className="text-lg font-black leading-none hover:text-red-600">✕</button>
        </div>
        {reactions.length === 0 ? (
          <p className="text-xs text-gray-500 font-black text-center py-3">No reactions yet</p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
            {reactions.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="text-base leading-none">{r.emoji_text}</span>
                <span className="font-black text-xs">{r.profiles?.username || 'Orbiter'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── GeoPost Card ────────────────────────────────────────────────────────────
function GeoPostCard({ post, session, accentColor, reactions: allReactions }) {
  const postReactions = allReactions.filter(r => r.post_id === post.id);
  const [showReactorModal, setShowReactorModal] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Compute top-4 emoji by count
  const countMap = {};
  postReactions.forEach(r => {
    countMap[r.emoji_text] = (countMap[r.emoji_text] || 0) + 1;
  });
  const sorted = Object.entries(countMap).sort((a, b) => b[1] - a[1]);
  const top4 = sorted.slice(0, 4);

  const handleReact = async (emoji) => {
    setPickerOpen(false);
    try {
      await addPostReaction(post.id, emoji, session);
    } catch { /* duplicate handled in supabase.js */ }
  };

  const isParticipant = post.is_participant;
  const username = post.username || 'Orbiter';

  return (
    <div
      className="border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] p-4 mb-4"
      style={{ backgroundColor: post.content?.fillColor || '#fff' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full border-2 border-black bg-gray-200 flex items-center justify-center font-black text-xs">
          {username[0]?.toUpperCase() || 'O'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-black text-sm truncate">{username}</span>
            {isParticipant ? (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-green-500 text-white border border-black whitespace-nowrap">● PARTICIPANT</span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-red-500 text-white border border-black whitespace-nowrap">● ORBITER</span>
            )}
          </div>
          <div className="text-[10px] text-gray-500 font-bold">
            {post.zip_code} · {post.borough} · {new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Rich-text content */}
      <div
        className="text-sm leading-relaxed mb-3 min-h-[1.5rem] break-words"
        dangerouslySetInnerHTML={{ __html: post.content?.html || '' }}
      />

      {/* Image */}
      {post.image_url && (
        <div className="mb-3 rounded-xl overflow-hidden border-2 border-black">
          <img src={post.image_url} alt="" className="w-full object-cover max-h-64" loading="lazy" />
        </div>
      )}

      {/* Reaction bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {top4.map(([emoji, count]) => (
          <button
            key={emoji}
            onClick={() => handleReact(emoji)}
            className="flex items-center gap-0.5 px-2 py-1 rounded-full border-2 border-black text-xs font-black bg-white hover:scale-110 transition-transform shadow-[1px_1px_0px_black]"
          >
            {emoji} <span>{count}</span>
          </button>
        ))}
        {/* Add reaction */}
        <div className="relative">
          <button
            onClick={() => setPickerOpen(v => !v)}
            className="flex items-center justify-center w-7 h-7 rounded-full border-2 border-black bg-white text-sm font-black hover:scale-110 transition-transform shadow-[1px_1px_0px_black]"
            title="React"
          >
            +
          </button>
          {pickerOpen && (
            <QuickEmojiPicker onSelect={handleReact} onClose={() => setPickerOpen(false)} />
          )}
        </div>
        {/* Ellipsis — always visible */}
        <button
          onClick={() => setShowReactorModal(true)}
          className="flex items-center justify-center px-2 py-1 rounded-full border-2 border-black bg-white text-xs font-black hover:scale-110 transition-transform shadow-[1px_1px_0px_black]"
          title="See all reactions"
        >
          …
        </button>
      </div>

      {showReactorModal && (
        <ReactorListModal reactions={postReactions} onClose={() => setShowReactorModal(false)} />
      )}
    </div>
  );
}

// Small inline emoji picker for post reactions
const QUICK_EMOJIS = ['😂','❤️','🔥','😍','👏','🙌','💯','😭','🤩','😎','👀','🎉','💀','🤔','😤','🥹'];
function QuickEmojiPicker({ onSelect, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-1 left-0 z-50 bg-white border-2 border-black rounded-xl shadow-[4px_4px_0px_black] p-2 grid grid-cols-4 gap-1 w-36"
    >
      {QUICK_EMOJIS.map(e => (
        <button
          key={e}
          onClick={() => onSelect(e)}
          className="text-lg hover:scale-125 transition-transform"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// ── GeoPost Editor ──────────────────────────────────────────────────────────
function GeoPostEditor({ session, accentColor, onPosted }) {
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const [zip, setZip] = useState(ZIP_OPTIONS[0]?.zip || '10001');
  const [borough, setBorough] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [showPopup, setShowPopup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto-fill borough from zip selection
  useEffect(() => {
    const match = ZIP_OPTIONS.find(z => z.zip === zip);
    if (match) setBorough(match.borough);
  }, [zip]);

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressGeoImage(file);
    setImageFile(compressed);
    setImagePreview(URL.createObjectURL(compressed));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const getHtml = () => editorRef.current?.innerHTML || '';

  const handleSubmit = () => {
    const html = getHtml().trim();
    if (!html || html === '<br>') { setError('Post cannot be empty.'); return; }
    setError('');
    setShowPopup(true);
  };

  const doPost = async (isParticipant) => {
    setShowPopup(false);
    setSubmitting(true);
    setError('');
    try {
      const rawText = editorRef.current?.innerText || '';
      // Profanity gate
      if (containsProfanity(rawText)) {
        const confirmed = true; // still submit but mark not approved
        const html = getHtml();
        let imageUrl = null;
        if (imageFile) {
          imageUrl = isOciConfigured()
            ? await uploadToOracleCloud(imageFile)
            : await uploadGeoPostImage(imageFile, session);
        }
        await submitGeoPost({
          user_id: session?.user?.id ?? null,
          content: { html },
          image_url: imageUrl,
          zip_code: zip,
          borough,
          is_participant: isParticipant,
          post_approved: false,
        }, session);
        setError('Your post was flagged and is pending review.');
        setSubmitting(false);
        return;
      }

      const html = getHtml();
      let imageUrl = null;
      if (imageFile) {
        imageUrl = isOciConfigured()
          ? await uploadToOracleCloud(imageFile)
          : await uploadGeoPostImage(imageFile, session);
      }

      await submitGeoPost({
        user_id: session?.user?.id ?? null,
        content: { html },
        image_url: imageUrl,
        zip_code: zip,
        borough,
        is_participant: isParticipant,
        post_approved: true,
      }, session);

      // Clear editor
      if (editorRef.current) editorRef.current.innerHTML = '';
      removeImage();
      onPosted?.();
    } catch (err) {
      setError(err.message || 'Post failed.');
    }
    setSubmitting(false);
  };

  return (
    <div className="border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] bg-white mb-5 overflow-hidden">
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-black uppercase">Posting to Zip:</label>
          <select
            value={zip}
            onChange={e => setZip(e.target.value)}
            className="flex-1 max-w-[180px] text-xs font-bold border-2 border-black rounded-lg px-2 py-1 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black"
          >
            {ZIP_OPTIONS.map(z => (
              <option key={z.zip} value={z.zip}>{z.zip} — {z.name} ({z.borough})</option>
            ))}
          </select>
        </div>
      </div>

      <RichToolbar editorRef={editorRef} accentColor={accentColor} />

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="min-h-[80px] max-h-56 overflow-y-auto px-4 py-3 text-sm focus:outline-none"
        data-placeholder="What's happening in the city?"
        onFocus={e => { if (!e.currentTarget.innerHTML) e.currentTarget.style.borderColor = ''; }}
      />

      {imagePreview && (
        <div className="px-4 pb-2 relative">
          <img src={imagePreview} alt="preview" className="max-h-40 rounded-xl border-2 border-black object-cover w-full" />
          <button onClick={removeImage} className="absolute top-3 right-6 w-6 h-6 rounded-full bg-black text-white text-xs font-black flex items-center justify-center">✕</button>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 pb-3 pt-2 border-t border-black/10">
        <label className="cursor-pointer flex items-center gap-1 px-3 py-1.5 rounded-xl border-2 border-black text-xs font-black hover:bg-gray-100 transition-colors">
          📷 Image
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
        </label>
        <div className="flex-1" />
        {error && <span className="text-red-600 text-xs font-black">{error}</span>}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-4 py-1.5 rounded-xl font-black text-sm text-white border-3 border-black shadow-[3px_3px_0px_black] hover:scale-105 transition-all disabled:opacity-50"
          style={{ backgroundColor: accentColor }}
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>

      {showPopup && (
        <CheckInPopup
          zip={zip}
          onParticipant={() => doPost(true)}
          onOrbiter={() => doPost(false)}
          onClose={() => setShowPopup(false)}
        />
      )}
    </div>
  );
}

// ── Feed Filter Bar ─────────────────────────────────────────────────────────
function FeedFilterBar({ filter, onChange, accentColor }) {
  const [boroughVal, setBoroughVal] = useState(BOROUGHS[0]);
  const [zipVal, setZipVal] = useState(ZIP_OPTIONS[0]?.zip || '10001');

  return (
    <div className="flex items-center gap-1.5 mb-4 flex-wrap">
      {['nyc', 'borough', 'zip'].map(type => {
        const active = filter.type === type;
        return (
          <button
            key={type}
            onClick={() => onChange({ type, value: type === 'borough' ? boroughVal : type === 'zip' ? zipVal : undefined })}
            className="px-3 py-1.5 rounded-xl font-black text-xs border-2 border-black transition-all shadow-[2px_2px_0px_black]"
            style={active ? { backgroundColor: accentColor, color: '#fff' } : { backgroundColor: '#fff' }}
          >
            {type === 'nyc' ? '🗽 All NYC' : type === 'borough' ? '🏙 Borough' : '📍 Zip'}
          </button>
        );
      })}
      {filter.type === 'borough' && (
        <select
          value={boroughVal}
          onChange={e => { setBoroughVal(e.target.value); onChange({ type: 'borough', value: e.target.value }); }}
          className="text-xs font-bold border-2 border-black rounded-lg px-2 py-1 bg-white"
        >
          {BOROUGHS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      )}
      {filter.type === 'zip' && (
        <select
          value={zipVal}
          onChange={e => { setZipVal(e.target.value); onChange({ type: 'zip', value: e.target.value }); }}
          className="text-xs font-bold border-2 border-black rounded-lg px-2 py-1 bg-white"
        >
          {ZIP_OPTIONS.map(z => <option key={z.zip} value={z.zip}>{z.zip} — {z.name}</option>)}
        </select>
      )}
    </div>
  );
}

// ── Main GeoPostView ─────────────────────────────────────────────────────────
export default function GeoPostView({ session }) {
  const { resolvedTheme } = useSiteTheme();
  const accentColor = resolvedTheme?.accentColor || '#7C3AED';

  const [filter, setFilter] = useState({ type: 'nyc' });
  const [posts, setPosts] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const data = await fetchGeoPostFeed(filter);
    setPosts(data);
    if (data.length > 0) {
      const rxns = await fetchReactionsForPosts(data.map(p => p.id));
      setReactions(rxns);
    } else {
      setReactions([]);
    }
    setLoading(false);
  }, [filter, refreshKey]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--lp-page-bg,#FAFAF8)]">
      <div className="max-w-2xl mx-auto w-full px-3 py-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🌍</span>
          <h2 className="font-black text-xl">GeoPost</h2>
          <span className="text-xs font-bold text-gray-500 mt-0.5">NYC Community Feed</span>
        </div>

        {/* Editor */}
        <GeoPostEditor
          session={session}
          accentColor={accentColor}
          onPosted={() => setRefreshKey(v => v + 1)}
        />

        {/* Filter */}
        <FeedFilterBar filter={filter} onChange={setFilter} accentColor={accentColor} />

        {/* Feed */}
        {loading ? (
          <div className="text-center py-12 font-black text-gray-400 animate-pulse">Loading…</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🗽</div>
            <p className="font-black text-gray-500">Nothing here to see yet! Be the first!</p>
          </div>
        ) : (
          posts.map(post => (
            <GeoPostCard
              key={post.id}
              post={post}
              session={session}
              accentColor={accentColor}
              reactions={reactions}
            />
          ))
        )}
      </div>
    </div>
  );
}
