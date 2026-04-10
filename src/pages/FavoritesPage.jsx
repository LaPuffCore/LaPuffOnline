import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EventDetailPopup from '../components/EventDetailPopup';
import { TrendIcon } from '../components/EventTile';
import {
  getFavorites,
  toggleFavorite,
  getFavoriteCount,
  getFavTrend,
  subscribeToFavoriteCount,
} from '../lib/favorites';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';

function formatDayTitle(dateKey) {
  if (!dateKey) return 'Undated';
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function sortByDateThenName(a, b) {
  const ad = a.event_date || '9999-12-31';
  const bd = b.event_date || '9999-12-31';
  if (ad !== bd) return ad.localeCompare(bd);
  return (a.event_name || '').localeCompare(b.event_name || '');
}

function DateSeparator({ title }) {
  return (
    <div className="flex items-center gap-3 py-1 md:py-2">
      <div className="h-px bg-gray-300 flex-1" />
      <p className="text-gray-500 text-[11px] md:text-xs font-extrabold tracking-wide uppercase text-center">
        {title}
      </p>
      <div className="h-px bg-gray-300 flex-1" />
    </div>
  );
}

function FavoriteCard({ event, tzOffset, onOpen, onUnfavorite }) {
  const [imgError, setImgError] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [trend, setTrend] = useState('neutral');

  const borderColor = event.hex_color || '#7C3AED';
  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, tzOffset) : '';
  const displayDate = event.event_date
    ? new Date(`${event.event_date}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : 'Date TBD';

  useEffect(() => {
    let mounted = true;

    const sync = async () => {
      const count = await getFavoriteCount(event.id);
      const t = getFavTrend(event.id);
      if (!mounted) return;
      setFavCount(count);
      setTrend(t);
    };

    sync();
    window.addEventListener('favoritesChanged', sync);
    const unsubscribe = subscribeToFavoriteCount(event.id, (next) => {
      if (!mounted) return;
      setFavCount(next);
      setTrend(getFavTrend(event.id));
    });

    return () => {
      mounted = false;
      window.removeEventListener('favoritesChanged', sync);
      unsubscribe?.();
    };
  }, [event.id]);

  const showImage = event.photos?.[0] && !imgError;

  return (
    <article
      onClick={() => onOpen(event)}
      className="group w-full md:w-72 bg-white border-3 border-black rounded-3xl cursor-pointer transition-transform duration-200 hover:scale-[1.02] hover:-translate-y-0.5 shadow-[5px_5px_0px_black] overflow-visible"
      style={{ borderTopColor: borderColor, borderTopWidth: 6 }}
    >
      <div className="h-40 md:h-44 relative overflow-hidden bg-gray-100 border-b-2 border-black rounded-t-[1.2rem]">
        {showImage ? (
          <img
            src={event.photos[0]}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-6xl md:text-7xl"
            style={{ backgroundColor: `${borderColor}33` }}
          >
            {event.representative_emoji || '🎉'}
          </div>
        )}

        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          <div className="flex items-center gap-1 bg-black/85 text-white rounded-full px-2 py-1 border border-white/10">
            <TrendIcon trend={trend} size="sm" />
            {favCount > 0 && <span className="text-[11px] font-black">{favCount}</span>}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnfavorite(event.id);
            }}
            className="w-8 h-8 md:w-9 md:h-9 bg-yellow-400 border-2 md:border-[2.5px] border-black rounded-full flex items-center justify-center text-base md:text-lg shadow-[2px_2px_0px_black] hover:bg-red-200 transition-colors"
            aria-label="Remove favorite"
          >
            ⭐
          </button>
        </div>

        <div className="absolute bottom-2 left-2 bg-black text-white text-[10px] font-black px-2 py-0.5 rounded-lg uppercase">
          {event.price_category === 'free' ? 'FREE' : event.price_category || 'N/A'}
        </div>
      </div>

      <div className="p-3.5 md:p-4">
        <h3 className="font-black text-[13px] md:text-sm leading-tight mb-2 line-clamp-2 min-h-[2.3rem]">
          {event.event_name}
        </h3>
        <p className="text-[11px] md:text-xs text-gray-600 font-bold">📅 {displayDate}</p>
        {displayTime && <p className="text-[11px] md:text-xs text-gray-600 font-bold">🕐 {displayTime}</p>}
        <p className="text-[11px] md:text-xs text-gray-500 mt-1 truncate">
          {event.location_data?.rsvp_link ? '🔒 RSVP Event' : `📍 ${event.location_data?.city || 'NYC'}`}
        </p>
      </div>
    </article>
  );
}

export default function FavoritesPage({ events = [] }) {
  const [favorites, setFavorites] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const tzOffset = getUserTZOffset();

  useEffect(() => {
    setFavorites(getFavorites());
    const handler = () => setFavorites(getFavorites());
    window.addEventListener('favoritesChanged', handler);
    return () => window.removeEventListener('favoritesChanged', handler);
  }, []);

  const favEvents = useMemo(
    () => events.filter((e) => favorites.includes(String(e.id))).sort(sortByDateThenName),
    [events, favorites]
  );

  const groupedByDate = useMemo(() => {
    const map = new Map();
    for (const e of favEvents) {
      const key = e.event_date || 'undated';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [favEvents]);

  async function handleUnfavorite(eventId) {
    await toggleFavorite(eventId);
    setFavorites(getFavorites());
    window.dispatchEvent(new Event('favoritesChanged'));
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="max-w-7xl mx-auto px-3 md:px-4 py-5 md:py-6 overflow-visible">
        <div className="flex items-start justify-between mb-6 md:mb-7 gap-3 md:gap-4">
          <Link
            to="/"
            className="flex flex-col items-center gap-1 text-black hover:text-[#7C3AED] transition-colors"
          >
            <div className="w-10 h-10 md:w-11 md:h-11 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg shadow-[3px_3px_0px_#333]">
              ←
            </div>
            <span className="text-[10px] md:text-xs font-black uppercase tracking-wide">Home</span>
          </Link>

          <div className="flex-1 border-3 border-black bg-white rounded-2xl px-4 md:px-5 py-3 md:py-3.5 shadow-[4px_4px_0px_black] text-center mx-1 md:mx-3">
            <h1 className="font-black text-lg md:text-2xl leading-none">⭐ My Favorites</h1>
            <p className="text-gray-500 text-xs md:text-sm mt-1 font-bold">{favEvents.length} saved events</p>
          </div>

          <Link
            to="/calendar"
            className="flex flex-col items-center gap-1 text-black hover:text-[#7C3AED] transition-colors"
          >
            <div className="w-10 h-10 md:w-11 md:h-11 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg shadow-[3px_3px_0px_#333]">
              →
            </div>
            <span className="text-[10px] md:text-xs font-black uppercase tracking-wide">Calendar</span>
          </Link>
        </div>

        {favEvents.length === 0 ? (
          <div className="text-center py-16 md:py-20">
            <div className="text-6xl md:text-7xl mb-4">⭐</div>
            <p className="text-xl md:text-2xl font-black">No favorites yet!</p>
            <p className="text-gray-500 mt-2 text-sm md:text-base">Star events in Tiles to save them here</p>
            <Link
              to="/"
              className="mt-6 inline-block bg-[#7C3AED] text-white font-black px-7 md:px-8 py-3 rounded-2xl hover:bg-[#6D28D9] transition-colors shadow-[4px_4px_0px_#333]"
            >
              Browse Events
            </Link>
          </div>
        ) : (
          <div className="space-y-6 md:space-y-8 overflow-visible pb-6">
            {groupedByDate.map(([dateKey, dateEvents]) => (
              <section key={dateKey} className="space-y-3 md:space-y-4 overflow-visible">
                <DateSeparator title={formatDayTitle(dateKey)} />

                <div className="md:hidden space-y-3">
                  {dateEvents.map((event) => (
                    <FavoriteCard
                      key={event.id}
                      event={event}
                      tzOffset={tzOffset}
                      onOpen={setSelectedEvent}
                      onUnfavorite={handleUnfavorite}
                    />
                  ))}
                </div>

                <div className="hidden md:flex md:flex-wrap gap-5 overflow-visible">
                  {dateEvents.map((event) => (
                    <FavoriteCard
                      key={event.id}
                      event={event}
                      tzOffset={tzOffset}
                      onOpen={setSelectedEvent}
                      onUnfavorite={handleUnfavorite}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {selectedEvent && (
        <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
