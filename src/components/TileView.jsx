import { useState, useMemo, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import EventTile from './EventTile';
import EventDetailPopup from './EventDetailPopup';
import { isFavorite } from '../lib/favorites';
import { SAMPLE_MODE } from '../lib/sampleConfig';

// ============================================================
// SOURCE FILTER DEFAULT — 'all' while SAMPLE_MODE=true
// ============================================================
const DEFAULT_SOURCE = SAMPLE_MODE ? 'all' : 'user';

const TIMESPAN_OPTIONS = [
  { label: '1d', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '3mo', days: 90 },
  { label: '6mo', days: 180 },
];

const BOROUGHS = ['All', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const PRICES = ['all', 'free', '$', '$$', '$$$'];
const SOURCE_MODES = [
  { key: 'user', label: '👤 User', title: 'User submitted events only' },
  { key: 'auto', label: '🤖 Auto', title: 'Auto-scraped / sample events' },
  { key: 'all', label: '🌐 All', title: 'Show all events' },
];
const MAX_TAG_FILTERS = 3;
const PAGE_SIZE = 12;

export default function TileView({ events }) {
  const [search, setSearch] = useState('');
  const [timespanIdx, setTimespanIdx] = useState(4);
  const [showArchive, setShowArchive] = useState(false);
  const [borough, setBorough] = useState('All');
  const [emojiFilter, setEmojiFilter] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [rsvpOnly, setRsvpOnly] = useState(false);
  const [priceFilter, setPriceFilter] = useState('all');
  const [sourceMode, setSourceMode] = useState(DEFAULT_SOURCE);
  const [tagFilters, setTagFilters] = useState([]); // up to MAX_TAG_FILTERS
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [page, setPage] = useState(1);
  const [favVersion, setFavVersion] = useState(0);

  useEffect(() => {
    const handler = () => setFavVersion(v => v + 1);
    window.addEventListener('favoritesChanged', handler);
    return () => window.removeEventListener('favoritesChanged', handler);
  }, []);

  function resetPage() { setPage(1); }

  function addTagFilter(tag) {
    setTagFilters(prev => {
      if (prev.includes(tag)) return prev;
      return [...prev, tag].slice(0, MAX_TAG_FILTERS);
    });
    resetPage();
  }

  function removeTagFilter(tag) {
    setTagFilters(prev => prev.filter(t => t !== tag));
    resetPage();
  }

  const filtered = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const maxDate = new Date(now.getTime() + TIMESPAN_OPTIONS[timespanIdx].days * 86400000);

    let list = events.filter(e => {
      const ed = new Date(e.event_date + 'T00:00:00');
      if (showArchive) return ed < now;
      return ed >= now && ed <= maxDate;
    });

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.event_name || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.location_data?.city || '').toLowerCase().includes(q) ||
        (e.name || '').toLowerCase().includes(q)
      );
    }

    if (sourceMode === 'user') list = list.filter(e => !e._sample && !e._auto);
    else if (sourceMode === 'auto') list = list.filter(e => e._sample || e._auto);

    if (borough !== 'All') list = list.filter(e => (e.borough || e.location_data?.city || '').toLowerCase() === borough.toLowerCase());
    if (emojiFilter) list = list.filter(e => e.representative_emoji === emojiFilter);
    if (priceFilter !== 'all') list = list.filter(e => e.price_category === priceFilter);
    if (rsvpOnly) list = list.filter(e => !!e.location_data?.rsvp_link);
    if (favOnly) list = list.filter(e => isFavorite(e.id));

    // Tag filters
    if (tagFilters.length > 0) {
      list = list.filter(e => {
        const tags = generateAutoTags(e);
        return tagFilters.every(tf => tags.includes(tf));
      });
    }

    list.sort((a, b) => showArchive
      ? new Date(b.event_date) - new Date(a.event_date)
      : new Date(a.event_date) - new Date(b.event_date));

    return list;
  }, [events, search, timespanIdx, showArchive, borough, emojiFilter, priceFilter, rsvpOnly, favOnly, sourceMode, tagFilters, favVersion]);



  const filteredWithTags = filtered;

  const displayed = filteredWithTags.slice(0, page * PAGE_SIZE);
  const hasMore = displayed.length < filteredWithTags.length;

  // Popular emojis from events
  const popularEmojis = useMemo(() => {
    const counts = {};
    events.forEach(e => { if (e.representative_emoji) counts[e.representative_emoji] = (counts[e.representative_emoji] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
  }, [events]);

  return (
    <div className="w-full">
      {/* Filter bar */}
      <div className="bg-white border-b-3 border-black sticky top-0 z-30 px-4 py-3 space-y-2.5">
        {/* Search */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg">🔍</span>
            <input value={search} onChange={e => { setSearch(e.target.value); resetPage(); }}
              placeholder="Search events, venues, locations..."
              className="w-full border-3 border-black rounded-2xl pl-10 pr-4 py-2 font-medium text-sm focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]" />
          </div>
          <button onClick={() => { setShowArchive(v => !v); resetPage(); }}
            className={`w-11 h-11 border-3 border-black rounded-2xl flex items-center justify-center text-xl shadow-[3px_3px_0px_black] ${showArchive ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}>
            🕰️
          </button>
        </div>

        {/* Timespan */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-black whitespace-nowrap text-gray-500">📅</span>
          {TIMESPAN_OPTIONS.map((opt, i) => (
            <button key={opt.label} onClick={() => { setTimespanIdx(i); resetPage(); }}
              disabled={showArchive}
              className={`px-3 py-1 rounded-xl text-xs font-black border-2 border-black transition-colors ${timespanIdx === i && !showArchive ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50 disabled:opacity-40'}`}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Source mode */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-black text-gray-500">Source:</span>
          {SOURCE_MODES.map(s => (
            <button key={s.key} onClick={() => { setSourceMode(s.key); resetPage(); }} title={s.title}
              className={`px-2.5 py-1 rounded-xl text-xs font-black border-2 border-black transition-colors ${sourceMode === s.key ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* RSVP + tag filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setRsvpOnly(v => !v); resetPage(); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-black border-2 border-black transition-colors ${rsvpOnly ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}>
            🤫 RSVP only
          </button>
          {/* Active tag filter pills */}
          {tagFilters.map(tag => (
            <span key={tag} className="flex items-center gap-1 bg-[#7C3AED] text-white text-xs font-black px-2.5 py-1.5 rounded-full border-2 border-[#7C3AED]">
              {tag}
              <button onClick={() => removeTagFilter(tag)} className="ml-0.5 hover:text-red-200">✕</button>
            </span>
          ))}
        </div>

        {/* Price */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-black text-gray-500">💰</span>
          {PRICES.map(p => (
            <button key={p} onClick={() => { setPriceFilter(p); resetPage(); }}
              className={`px-2.5 py-1 rounded-xl text-xs font-black border-2 border-black transition-colors ${priceFilter === p ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}>
              {p === 'all' ? 'All' : p === 'free' ? 'FREE' : p}
            </button>
          ))}
        </div>

        {/* Emoji vibe filter */}
        {popularEmojis.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-black text-gray-500">Vibe:</span>
            {emojiFilter ? (
              <span className="flex items-center gap-1 bg-[#7C3AED] text-white text-xs font-black px-2.5 py-1 rounded-full">
                {emojiFilter}
                <button onClick={() => { setEmojiFilter(''); resetPage(); }} className="hover:text-red-200">✕</button>
              </span>
            ) : (
              <>
                {popularEmojis.map(e => (
                  <button key={e} onClick={() => { setEmojiFilter(e); resetPage(); }}
                    className="w-8 h-8 rounded-xl border-2 border-black text-lg flex items-center justify-center bg-white hover:bg-violet-50 transition-colors">
                    {e}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Borough + Favs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-black text-gray-500">Area:</span>
          {BOROUGHS.map(b => (
            <button key={b} onClick={() => { setBorough(b); resetPage(); }}
              className={`px-2 py-0.5 rounded-xl text-xs font-black border-2 border-black transition-colors ${borough === b ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}>
              {b}
            </button>
          ))}
          <button onClick={() => { setFavOnly(v => !v); resetPage(); }}
            className={`ml-auto px-3 py-1 rounded-xl text-xs font-black border-2 border-black flex items-center gap-1 transition-colors ${favOnly ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}>
            ⭐ Favs
          </button>
        </div>
      </div>

      {/* Count */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs font-black text-gray-500">
          {showArchive ? '🕰️ PAST' : '📅 UPCOMING'} · {filteredWithTags.length} events
          {tagFilters.length > 0 && <span className="text-[#7C3AED] ml-2">· filtered by: {tagFilters.join(' + ')}</span>}
        </p>
      </div>

      {/* Grid */}
      {filteredWithTags.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🎪</div>
          <p className="text-xl font-black">No events found!</p>
          <p className="text-gray-500 mt-2">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 px-4 pb-4">
          {displayed.map(event => (
            <EventTile key={event.id} event={event} onClick={() => setSelectedEvent(event)} onTagClick={addTagFilter} />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="text-center pb-8">
          <button onClick={() => setPage(p => p + 1)}
            className="bg-[#7C3AED] text-white font-black px-8 py-3 rounded-2xl text-sm hover:bg-[#6D28D9] transition-colors shadow-[4px_4px_0px_#333]">
            Show More ({filteredWithTags.length - displayed.length} more)
          </button>
        </div>
      )}

      {selectedEvent && <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}