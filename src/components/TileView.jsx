import { useState, useMemo, useEffect, useRef } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import EmojiPicker from './EmojiPicker';
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
const MAX_EMOJI_FILTERS = 5;
const PAGE_SIZE = 12;

const ALL_TAGS = [
  'music', 'jazz', 'art', 'food', 'brunch', 'market', 'sports', 'workshop', 'lecture',
  'family', 'kids', 'outdoor', 'free', 'nightlife', 'culture', 'fashion', 'film',
  'dance', 'books', 'reading', 'poetry', 'comedy', 'nature', 'party', 'charity',
  'tech', 'wellness', 'theater', 'social', 'activism',
];

const SEARCH_RELATIONS = {
  reading: ['poetry', 'poem', 'poet', 'book', 'author', 'literary', 'literature', 'spoken word', 'open mic', 'prose', 'fiction', 'nonfiction', 'memoir', 'essay', 'novel', 'short story', 'verse', 'stanza', 'slam', 'zine', 'bookstore', 'library', 'reading', 'write', 'writer', 'writing', 'lyric', 'recital'],
  poetry: ['poem', 'poet', 'verse', 'spoken word', 'open mic', 'slam', 'reading', 'literary', 'lyric', 'stanza', 'haiku', 'prose', 'rhyme', 'writing'],
  books: ['literary', 'author', 'novel', 'reading', 'bookstore', 'library', 'fiction', 'nonfiction', 'memoir', 'essay', 'zine', 'printed matter', 'publish', 'book fair'],
  literature: ['book', 'poem', 'author', 'literary', 'reading', 'spoken word', 'prose', 'fiction', 'essay', 'novel'],
  writing: ['workshop', 'poem', 'author', 'literary', 'prose', 'essay', 'fiction', 'nonfiction', 'spoken word', 'open mic'],
  music: ['concert', 'live music', 'jazz', 'rock', 'hip hop', 'classical', 'dj', 'band', 'festival', 'electronic', 'symphony', 'quartet', 'candlelight', 'beats', 'perform', 'rap', 'r&b', 'pop', 'indie', 'folk', 'acoustic', 'rave', 'edm', 'karaoke', 'sing', 'choir', 'opera', 'recital', 'playlist', 'soundscape', 'vinyl', 'album', 'set', 'show'],
  concert: ['live music', 'band', 'perform', 'music', 'show', 'venue', 'rock', 'jazz', 'classical', 'pop', 'symphony'],
  jazz: ['jazz club', 'bebop', 'swing', 'quartet', 'blue note', 'village vanguard', 'blues', 'saxophone', 'trumpet', 'improvisation'],
  classical: ['symphony', 'orchestra', 'chamber', 'quartet', 'candlelight', 'opera', 'recital', 'philharmonic', 'concerto', 'sonata'],
  hiphop: ['rap', 'beats', 'dj', 'cypher', 'freestyle', 'mc', 'club', 'rave', 'edm'],
  art: ['gallery', 'exhibition', 'museum', 'painting', 'sculpture', 'photography', 'installation', 'drawing', 'opening', 'vernissage', 'collage', 'printmaking', 'ceramics', 'illustration', 'mural', 'biennial', 'studio'],
  gallery: ['art', 'exhibition', 'opening', 'vernissage', 'photography', 'painting', 'sculpture', 'installation', 'drawing'],
  museum: ['exhibition', 'art', 'gallery', 'collection', 'history', 'culture', 'science', 'natural history', 'whitney', 'moma', 'met', 'guggenheim', 'brooklyn museum'],
  exhibition: ['gallery', 'art', 'museum', 'opening', 'installation', 'photography', 'painting', 'sculpture'],
  photography: ['exhibition', 'gallery', 'art', 'photo', 'print', 'darkroom', 'portrait', 'landscape'],
  food: ['restaurant', 'dining', 'eat', 'tasting', 'market', 'cuisine', 'brunch', 'dinner', 'lunch', 'breakfast', 'pop-up', 'street food', 'cocktail', 'wine', 'beer', 'spirits', 'dessert', 'baking', 'cooking', 'chef', 'culinary', 'smorgasburg', 'night market', 'flea', 'vendors', 'taste', 'pizzeria', 'ramen', 'sushi', 'tapas', 'oyster', 'foodie', 'farm to table'],
  brunch: ['bottomless', 'mimosa', 'sunday', 'brunch party', 'food', 'drinks', 'weekend', 'eggs'],
  drinks: ['cocktail', 'wine', 'beer', 'spirits', 'bar', 'tasting', 'brewery', 'winery', 'happy hour', 'nightlife'],
  cocktail: ['bar', 'drinks', 'mixology', 'spirits', 'lounge', 'speakeasy', 'nightlife', 'happy hour'],
  wine: ['tasting', 'winery', 'vineyard', 'sommelier', 'food', 'pairing', 'bar'],
  market: ['flea market', 'bazaar', 'vendor', 'artisan', 'craft fair', 'pop-up', 'shopping', 'antique', 'vintage', 'makers', 'food market', 'smorgasburg'],
  dance: ['ballet', 'flamenco', 'salsa', 'merengue', 'choreography', 'performance', 'tango', 'swing', 'contemporary', 'ballroom', 'breaking', 'vogue', 'waacking', 'hip hop dance', 'club', 'nightlife'],
  ballet: ['dance', 'performance', 'contemporary', 'choreography', 'theater', 'stage'],
  salsa: ['dance', 'merengue', 'bachata', 'latin', 'club', 'music', 'party', 'social dance'],
  performance: ['theater', 'show', 'stage', 'dance', 'music', 'art', 'comedy', 'improv', 'spoken word'],
  theater: ['play', 'musical', 'broadway', 'off-broadway', 'show', 'performance', 'stage', 'acting', 'comedy', 'improv', 'opera'],
  sports: ['marathon', 'run', 'race', 'basketball', 'baseball', 'tournament', 'athletic', 'game', 'match', 'soccer', 'football', 'tennis', 'boxing', 'mma', 'swimming', 'cycling', 'fitness', 'gym', 'workout', 'league', 'championship', 'skating', 'climbing'],
  yoga: ['wellness', 'meditation', 'mindfulness', 'pilates', 'fitness', 'breathwork', 'holistic', 'retreat', 'sound bath', 'class'],
  wellness: ['meditation', 'mindfulness', 'yoga', 'pilates', 'therapy', 'mental health', 'self care', 'healing', 'spa', 'massage', 'breathwork', 'journaling', 'retreat', 'holistic', 'sound bath'],
  meditation: ['mindfulness', 'wellness', 'yoga', 'breathwork', 'retreat', 'sound bath', 'healing'],
  run: ['marathon', 'race', 'running', 'fitness', '5k', '10k', 'jogging', 'trail', 'park'],
  fitness: ['gym', 'workout', 'yoga', 'pilates', 'class', 'training', 'run', 'cycling', 'sports'],
  outdoor: ['park', 'boardwalk', 'garden', 'high line', 'waterfront', 'plaza', 'open air', 'prospect', 'astoria', 'flushing meadows', 'hiking', 'trail', 'beach', 'rooftop', 'terrace', 'pier', 'lawn', 'meadow'],
  park: ['outdoor', 'nature', 'green', 'prospect park', 'central park', 'garden', 'hiking', 'picnic', 'run', 'lawn'],
  nature: ['garden', 'botanical', 'flower', 'plant', 'bloom', 'zoo', 'wildlife', 'animal', 'birdwatching', 'ecology', 'hiking', 'trail', 'park', 'outdoor'],
  garden: ['botanical', 'flower', 'plant', 'bloom', 'nature', 'outdoor', 'park', 'green'],
  hiking: ['trail', 'outdoor', 'park', 'nature', 'walk', 'climb', 'scenic'],
  social: ['networking', 'mixer', 'meetup', 'community', 'get-together', 'gathering', 'friends', 'connection', 'speed dating', 'party'],
  networking: ['social', 'mixer', 'meetup', 'community', 'professional', 'career', 'business', 'startup', 'tech'],
  community: ['social', 'local', 'neighborhood', 'volunteer', 'activism', 'culture', 'heritage', 'gathering'],
  party: ['celebration', 'birthday', 'anniversary', 'rooftop', 'late night', 'social', 'mixer', 'happy hour', 'soiree', 'gala', 'club', 'nightlife'],
  workshop: ['class', 'course', 'lesson', 'tutorial', 'learn', 'hands-on', 'craft', 'diy', 'skill', 'seminar', 'training', 'bootcamp', 'masterclass'],
  lecture: ['talk', 'panel', 'discussion', 'q&a', 'conversation', 'keynote', 'symposium', 'conference', 'forum', 'speaker', 'presentation', 'ted'],
  tech: ['startup', 'hackathon', 'developer', 'coding', 'ai', 'crypto', 'blockchain', 'product', 'launch', 'demo', 'innovation', 'digital', 'webinar', 'app'],
  film: ['movie', 'cinema', 'screening', 'documentary', 'animation', 'theater', 'premiere', 'short film', 'indie', 'feature', 'drive-in', 'outdoor cinema'],
  movie: ['film', 'cinema', 'screening', 'documentary', 'theater', 'premiere'],
  screening: ['film', 'movie', 'cinema', 'documentary', 'short film', 'premiere', 'theater'],
  fashion: ['style', 'design', 'runway', 'designer', 'clothing', 'apparel', 'nyfw', 'streetwear', 'vintage', 'thrift', 'swap', 'textile', 'couture', 'sneaker', 'accessories'],
  nightlife: ['bar', 'club', 'lounge', 'speakeasy', 'afterparty', 'late night', 'cocktail', 'drinks', 'dance', 'rave', 'dj', 'bottle service'],
  club: ['nightlife', 'dance', 'dj', 'rave', 'lounge', 'bar', 'late night', 'music'],
  culture: ['heritage', 'latino', 'asian', 'harlem', 'lunar', 'parade', 'community', 'tradition', 'diversity', 'festival', 'afro', 'caribbean', 'south asian', 'chinese new year', 'diwali', 'pride', 'juneteenth', 'kwanzaa'],
  pride: ['lgbtq', 'queer', 'community', 'parade', 'celebration', 'culture', 'party'],
  comedy: ['stand-up', 'laugh', 'humor', 'comic', 'joke', 'improv', 'sketch', 'roast', 'open mic', 'satire'],
  charity: ['fundraiser', 'benefit', 'nonprofit', 'gala', 'auction', 'donation', 'cause', 'awareness', 'volunteer'],
  activism: ['protest', 'rally', 'march', 'advocacy', 'rights', 'justice', 'movement', 'organize', 'vote', 'civic'],
  family: ['kids', 'children', 'egg hunt', 'easter', 'spring break', 'youth', 'all ages', 'kid-friendly', 'toddler', 'parent', 'school', 'playground', 'storytime'],
  kids: ['children', 'youth', 'toddler', 'baby', 'family', 'all ages', 'school', 'teen', 'junior'],
};

function expandSearchQuery(query) {
  const words = query.toLowerCase().trim().split(/\s+/);
  const expanded = new Set(words);
  words.forEach(word => {
    if (SEARCH_RELATIONS[word]) {
      SEARCH_RELATIONS[word].forEach(r => expanded.add(r));
    }
    if (word.length >= 4) {
      Object.entries(SEARCH_RELATIONS).forEach(([key, synonyms]) => {
        if (key.includes(word) || word.includes(key)) {
          expanded.add(key);
          synonyms.forEach(s => expanded.add(s));
        }
      });
    }
  });
  return Array.from(expanded);
}

export default function TileView({ events }) {
  const [search, setSearch] = useState('');
  const [timespanIdx, setTimespanIdx] = useState(4);
  const [showArchive, setShowArchive] = useState(false);
  const [borough, setBorough] = useState('All');
  const [emojiFilters, setEmojiFilters] = useState([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [rsvpOnly, setRsvpOnly] = useState(false);
  const [priceFilter, setPriceFilter] = useState('all');
  const [sourceMode, setSourceMode] = useState(DEFAULT_SOURCE);
  const [tagFilters, setTagFilters] = useState([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [page, setPage] = useState(1);
  const [favVersion, setFavVersion] = useState(0);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const tagDropdownRef = useRef(null);
  const emojiPickerRef = useRef(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    const handler = () => setFavVersion(v => v + 1);
    window.addEventListener('favoritesChanged', handler);
    return () => {
      window.removeEventListener('favoritesChanged', handler);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  useEffect(() => {
    function handler(e) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target)) {
        setTagDropdownOpen(false);
      }
    }
    if (tagDropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tagDropdownOpen]);

  useEffect(() => {
    function handler(e) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setEmojiPickerOpen(false);
      }
    }
    if (emojiPickerOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiPickerOpen]);

  function resetPage() { setPage(1); }

  function addTagFilter(tag) {
    setTagFilters(prev => {
      if (prev.includes(tag)) return prev;
      return [...prev, tag].slice(0, MAX_TAG_FILTERS);
    });
    setTagDropdownOpen(false);
    resetPage();
  }

  function removeTagFilter(tag) {
    setTagFilters(prev => prev.filter(t => t !== tag));
    resetPage();
  }

  function toggleEmojiFilter(emoji) {
    setEmojiFilters(prev => {
      if (prev.includes(emoji)) return prev.filter(e => e !== emoji);
      if (prev.length >= MAX_EMOJI_FILTERS) return prev;
      return [...prev, emoji];
    });
    resetPage();
  }

  function removeEmojiFilter(emoji) {
    setEmojiFilters(prev => prev.filter(e => e !== emoji));
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

    if (search.trim()) {
      const terms = expandSearchQuery(search.trim());
      list = list.filter(e => {
        const haystack = [
          e.event_name || '',
          e.description || '',
          e.location_data?.city || '',
          e.name || '',
          e.location_data?.address || '',
          e.borough || '',
          generateAutoTags(e).join(' '),
        ].join(' ').toLowerCase();
        return terms.some(term => haystack.includes(term));
      });
    }

    if (sourceMode === 'user') list = list.filter(e => !e._sample && !e._auto);
    else if (sourceMode === 'auto') list = list.filter(e => e._sample || e._auto);

    if (borough !== 'All') list = list.filter(e => (e.borough || e.location_data?.city || '').toLowerCase() === borough.toLowerCase());

    if (emojiFilters.length > 0) {
      list = list.filter(e => emojiFilters.includes(e.representative_emoji));
    }

    if (priceFilter !== 'all') list = list.filter(e => e.price_category === priceFilter);
    if (rsvpOnly) list = list.filter(e => !!e.location_data?.rsvp_link);
    if (favOnly) list = list.filter(e => isFavorite(e.id));

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
  }, [events, search, timespanIdx, showArchive, borough, emojiFilters, priceFilter, rsvpOnly, favOnly, sourceMode, tagFilters, favVersion]);

  // NAVIGATION LOGIC: Calculate index within the current filtered list
  const currentEventIndex = useMemo(() => {
    if (!selectedEvent) return -1;
    return filtered.findIndex(e => e.id === selectedEvent.id);
  }, [selectedEvent, filtered]);

  const handleNext = currentEventIndex < filtered.length - 1 
    ? () => setSelectedEvent(filtered[currentEventIndex + 1]) 
    : null;

  const handlePrev = currentEventIndex > 0 
    ? () => setSelectedEvent(filtered[currentEventIndex - 1]) 
    : null;

  const displayed = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = displayed.length < filtered.length;

  const popularEmojis = useMemo(() => {
    const counts = {};
    events.forEach(e => { if (e.representative_emoji) counts[e.representative_emoji] = (counts[e.representative_emoji] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const limit = isMobile ? 7 : 8;
    return sorted.slice(0, limit);
  }, [events, isMobile]);

  const availableTags = ALL_TAGS.filter(t => !tagFilters.includes(t));
  const hasActiveMoreFilters = priceFilter !== 'all' || emojiFilters.length > 0 || borough !== 'All';

  return (
    <div className="w-full sm:scale-100 scale-[0.98] origin-top transition-transform">
      {/* Filter bar */}
      <div className="bg-white border-b-3 border-black sticky top-0 z-30 px-4 py-3 md:space-y-2.5 space-y-2 rounded-b-[24px] shadow-md">

        {/* ROW 1: Search + archive toggle */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg">🔍</span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); resetPage(); }}
              placeholder="Search events, venues..."
              className="w-full border-3 border-black rounded-2xl pl-10 pr-4 py-2 font-medium text-sm focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]"
            />
          </div>
          <button
            onClick={() => { setShowArchive(v => !v); resetPage(); }}
            className={`w-11 h-11 border-3 border-black rounded-2xl flex items-center justify-center text-xl shadow-[3px_3px_0px_black] ${showArchive ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
          >
            🕰️
          </button>
        </div>

        {/* ROW 2: Timespan + Favorites */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-1">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-xs font-black whitespace-nowrap text-gray-400 uppercase tracking-tighter">Date</span>
            {TIMESPAN_OPTIONS.map((opt, i) => (
              <button
                key={opt.label}
                onClick={() => { setTimespanIdx(i); resetPage(); }}
                disabled={showArchive}
                className={`px-3 py-1 rounded-xl text-xs font-black border-2 border-black whitespace-nowrap transition-colors ${timespanIdx === i && !showArchive ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50 disabled:opacity-40'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {!isMobile && (
            <button
              onClick={() => { setFavOnly(v => !v); resetPage(); }}
              className={`px-3 py-1 rounded-xl text-xs font-black border-2 border-black flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${favOnly ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
            >
              ⭐ Favorites
            </button>
          )}
        </div>

        {/* ROW 3: Source mode (+ Mobile-only Favorites) */}
        <div className="flex items-center gap-2 w-full">
          <div className={`flex items-center gap-1.5 ${isMobile ? 'flex-1' : ''} overflow-x-auto no-scrollbar`}>
            <span className="text-xs font-black text-gray-400 uppercase tracking-tighter mr-1">Source</span>
            {SOURCE_MODES.map(s => (
              <button
                key={s.key}
                onClick={() => { setSourceMode(s.key); resetPage(); }}
                title={s.title}
                className={`px-2.5 py-1 rounded-xl text-xs font-black border-2 border-black transition-colors ${isMobile ? 'flex-1 text-center' : ''} whitespace-nowrap ${sourceMode === s.key ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
              >
                {s.label}
              </button>
            ))}
            
            {isMobile && (
              <button
                onClick={() => { setFavOnly(v => !v); resetPage(); }}
                className={`px-3 py-1 rounded-xl text-xs font-black border-2 border-black flex items-center justify-center gap-1 transition-colors whitespace-nowrap flex-1 ${favOnly ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
              >
                ⭐ Favs
              </button>
            )}
          </div>
        </div>

        {/* ROW 4: RSVP + Tag filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setRsvpOnly(v => !v); resetPage(); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-black border-2 border-black transition-colors ${rsvpOnly ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
          >
            🤫 RSVP only
          </button>

          {tagFilters.map(tag => (
            <span
              key={tag}
              className="flex items-center gap-1 bg-[#7C3AED] text-white text-xs font-black px-2.5 py-1.5 rounded-full border-2 border-[#7C3AED]"
            >
              {tag}
              <button onClick={() => removeTagFilter(tag)} className="ml-0.5 hover:text-red-200">✕</button>
            </span>
          ))}

          {tagFilters.length < MAX_TAG_FILTERS && (
            <div ref={tagDropdownRef} className="relative">
              <button
                onClick={() => setTagDropdownOpen(v => !v)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-black border-2 border-black transition-colors ${tagDropdownOpen ? 'bg-violet-100 border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
              >
                + tag
                <span className="text-[10px]">{tagDropdownOpen ? '▲' : '▼'}</span>
              </button>
              {tagDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white border-3 border-black rounded-2xl shadow-[4px_4px_0px_black] p-2 w-56 max-h-64 overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {availableTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => addTagFilter(tag)}
                        className="px-2.5 py-1 rounded-xl text-xs font-black border-2 border-black bg-white hover:bg-[#7C3AED] hover:text-white hover:border-[#7C3AED] transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ROW 5: More Filters Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMoreFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-black border-2 border-black transition-colors ${showMoreFilters ? 'bg-violet-100 border-[#7C3AED] text-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
          >
            {showMoreFilters ? '▲' : '▼'} more
            {hasActiveMoreFilters && !showMoreFilters && (
              <span className="ml-1 w-2 h-2 rounded-full bg-[#7C3AED] inline-block" />
            )}
          </button>
          {!showMoreFilters && hasActiveMoreFilters && (
            <div className="flex items-center gap-1.5 flex-wrap overflow-hidden">
              {priceFilter !== 'all' && (
                <span className="flex items-center gap-1 bg-[#7C3AED] text-white text-[10px] font-black px-2 py-1 rounded-full whitespace-nowrap">
                  💰 {priceFilter === 'free' ? 'FREE' : priceFilter}
                  <button onClick={() => { setPriceFilter('all'); resetPage(); }} className="hover:text-red-200">✕</button>
                </span>
              )}
              {borough !== 'All' && (
                <span className="flex items-center gap-1 bg-[#7C3AED] text-white text-[10px] font-black px-2 py-1 rounded-full whitespace-nowrap">
                  📍 {isMobile && borough === 'Staten Island' ? 'Staten' : borough}
                  <button onClick={() => { setBorough('All'); resetPage(); }} className="hover:text-red-200">✕</button>
                </span>
              )}
              {emojiFilters.map(em => (
                <span key={em} className="flex items-center gap-1 bg-[#7C3AED] text-white text-[10px] font-black px-2 py-1 rounded-full">
                  {em}
                  <button onClick={() => removeEmojiFilter(em)} className="hover:text-red-200">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* EXPANDABLE SECTION */}
        {showMoreFilters && (
          <div className="md:space-y-2.5 space-y-2 pt-1.5 border-t-2 border-dashed border-violet-100">

            {/* Price */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black text-gray-400">💰</span>
              {PRICES.map(p => (
                <button
                  key={p}
                  onClick={() => { setPriceFilter(p); resetPage(); }}
                  className={`px-2.5 py-1 rounded-xl text-xs font-black border-2 border-black transition-colors ${priceFilter === p ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
                >
                  {p === 'all' ? 'All' : p === 'free' ? 'FREE' : p}
                </button>
              ))}
            </div>

            {/* Vibe emoji filter */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-black text-gray-400">Vibe:</span>
              {emojiFilters.map(em => (
                <button
                  key={em}
                  onClick={() => removeEmojiFilter(em)}
                  className="w-8 h-8 rounded-xl border-2 border-[#7C3AED] text-lg flex items-center justify-center bg-[#7C3AED] hover:bg-violet-700 transition-colors"
                >
                  {em}
                </button>
              ))}

              {popularEmojis
                .filter(e => !emojiFilters.includes(e))
                .slice(0, Math.max(0, (isMobile ? 7 : 8) - emojiFilters.length))
                .map(em => (
                  <button
                    key={em}
                    onClick={() => { toggleEmojiFilter(em); }}
                    className="w-8 h-8 rounded-xl border-2 border-black text-lg flex items-center justify-center bg-white hover:bg-violet-50 transition-colors"
                  >
                    {em}
                  </button>
                ))}

              {emojiFilters.length < MAX_EMOJI_FILTERS && (
                <div ref={emojiPickerRef} className="relative">
                  <button
                    onClick={() => setEmojiPickerOpen(v => !v)}
                    className={`w-8 h-8 rounded-xl border-2 border-black text-sm flex items-center justify-center bg-white hover:bg-violet-50 transition-colors font-black ${emojiPickerOpen ? 'bg-violet-100 border-[#7C3AED]' : ''}`}
                  >
                    {emojiPickerOpen ? '▲' : '▼'}
                  </button>
                  {emojiPickerOpen && (
                    <div className="absolute top-full right-0 mt-1 z-50">
                      <EmojiPicker
                        value=""
                        onChange={emoji => {
                          if (emoji) toggleEmojiFilter(emoji);
                          setEmojiPickerOpen(false);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Borough */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-black text-gray-400">Area:</span>
              {BOROUGHS.map(b => (
                <button
                  key={b}
                  onClick={() => { setBorough(b); resetPage(); }}
                  className={`px-2 py-0.5 rounded-xl text-xs font-black border-2 border-black transition-colors ${borough === b ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white hover:bg-violet-50'}`}
                >
                  {isMobile && b === 'Staten Island' ? 'Staten' : b}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Count */}
      <div className={`px-4 pb-1 ${isMobile ? 'pt-5' : 'pt-3'}`}>
        <p className="text-xs font-black text-gray-500">
          {showArchive ? '🕰️ PAST' : '📅 UPCOMING'} · {filtered.length} events
        </p>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🎪</div>
          <p className="text-xl font-black">No events found!</p>
        </div>
      ) : (
        <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${isMobile ? 'gap-2 px-3 pb-4' : 'gap-4 px-4 pb-4'}`}>
          {displayed.map(event => (
            <div key={event.id} className={`${isMobile ? 'scale-[0.92] -mx-1 -my-2 origin-center' : ''}`}>
               <EventTile
                event={event}
                onClick={() => setSelectedEvent(event)}
                onTagClick={addTagFilter}
                isMobile={isMobile}
                className={isMobile ? 'text-xs p-2 leading-tight' : ''}
              />
              <style jsx global>{`
                ${isMobile ? `
                  /* Select the primary name/title text within the tile */
                  .tile-title, 
                  .event-tile h3, 
                  .event-tile .text-sm.font-black,
                  .event-tile [class*="text-"][class*="font-black"] {
                    display: -webkit-box !important;
                    -webkit-line-clamp: 2 !important;
                    -webkit-box-orient: vertical !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    word-break: break-word !important;
                    line-height: 1.2 !important;
                    max-height: 2.4em !important; /* Strictly enforces 2 lines of space */
                    margin-bottom: 2px !important;
                  }
                  .tile-info {
                    font-size: 0.7rem;
                    line-height: 1;
                  }
                ` : ''}
              `}</style>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="text-center pb-8 mt-4">
          <button
            onClick={() => setPage(p => p + 1)}
            className="bg-[#7C3AED] text-white font-black px-8 py-3 rounded-2xl text-sm hover:bg-[#6D28D9] transition-colors shadow-[4px_4px_0px_#333]"
          >
            Show More
          </button>
        </div>
      )}

      {selectedEvent && (
        <EventDetailPopup 
          event={selectedEvent} 
          onClose={() => setSelectedEvent(null)} 
          onNext={handleNext}
          onPrev={handlePrev}
        />
      )}
    </div>
  );
}