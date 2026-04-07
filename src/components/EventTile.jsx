import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend } from '../lib/favorites';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';
import { TAG_COLORS } from '../lib/tagColors';

export default function EventTile({ event, onClick, onTagClick }) {
  const [fav, setFav] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [trend, setTrend] = useState('neutral');
  const tags = generateAutoTags(event);
  const tzOffset = getUserTZOffset();

  useEffect(() => {
    setFav(isFavorite(event.id));
    setFavCount(getFavoriteCount(event.id));
    setTrend(getFavTrend(event.id));
  }, [event.id]);

  function handleFav(e) {
    e.stopPropagation();
    const added = toggleFavorite(event.id);
    setFav(added);
    setFavCount(getFavoriteCount(event.id));
    setTrend(getFavTrend(event.id));
    window.dispatchEvent(new Event('favoritesChanged'));
  }

  function handleTagClick(e, tag) {
    e.stopPropagation();
    if (onTagClick) onTagClick(tag);
  }

  // 7-day old image check
  const isOldEvent = event.event_date && (Date.now() - new Date(event.event_date + 'T00:00:00').getTime()) > 7 * 86400000;
  const imgSrc = !isOldEvent && !imgError ? event.photos?.[0] : null;
  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, tzOffset) : '';
  const displayDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const borderColor = event.hex_color || '#7C3AED';

  const TrendIcon = () => {
    if (trend === 'up') return (
      <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 16 16" fill="none">
        <path d="M2 12 L6 7 L9 10 L14 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10 4 L14 4 L14 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
    if (trend === 'down') return (
      <svg className="w-3.5 h-3.5 text-red-500" viewBox="0 0 16 16" fill="none">
        <path d="M2 4 L6 9 L9 6 L14 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10 12 L14 12 L14 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
    return <span className="w-3.5 h-3.5 text-blue-400 font-black text-xs leading-none flex items-center">—</span>;
  };

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-3xl cursor-pointer hover:scale-[1.02] hover:-translate-y-1 transition-all overflow-hidden"
      style={{ border: `3px solid ${borderColor}`, boxShadow: `5px 5px 0px black` }}
    >
      {/* Image */}
      <div className="h-40 relative overflow-hidden">
        {imgSrc ? (
          <img src={imgSrc} alt={event.event_name} className="w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl" style={{ backgroundColor: borderColor + '33' }}>
            {event.representative_emoji || '🎉'}
          </div>
        )}

        {/* Fav button + count + trend */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {favCount > 0 && (
            <div className="flex items-center gap-0.5 bg-black/70 rounded-full px-1.5 py-0.5">
              <TrendIcon />
              <span className="text-white text-xs font-black">{favCount}</span>
            </div>
          )}
          <button onClick={handleFav}
            className={`w-9 h-9 rounded-full border-2 border-black shadow-[2px_2px_0px_black] flex items-center justify-center text-lg transition-colors ${fav ? 'bg-yellow-400' : 'bg-white hover:bg-yellow-100'}`}>
            {fav ? '⭐' : '☆'}
          </button>
        </div>

        {/* Price */}
        <div className="absolute bottom-2 left-2 bg-black text-white text-xs font-black px-2 py-1 rounded-lg">
          {event.price_category === 'free' ? 'FREE' : event.price_category || '?'}
        </div>
        {/* Emoji badge */}
        <div className="absolute top-2 left-2 w-8 h-8 bg-white rounded-full border-2 border-black flex items-center justify-center text-sm shadow">
          {event.representative_emoji || '🎉'}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-black text-sm leading-tight line-clamp-2 mb-1">{event.event_name}</h3>
        <p className="text-xs text-gray-500 font-medium mb-1">📅 {displayDate}{displayTime ? ` · 🕐 ${displayTime}` : ''}</p>
        {event.location_data && (
          <p className="text-xs text-gray-400 mb-2 truncate">
            {event.location_data.rsvp_link ? '🔒 RSVP' : `📍 ${event.location_data.city || 'NYC'}`}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map(tag => (
            <button
              key={tag}
              onClick={e => handleTagClick(e, tag)}
              className={`text-xs font-bold px-2 py-0.5 rounded-full border border-transparent hover:border-black transition-colors ${TAG_COLORS[tag] || 'bg-gray-200 text-gray-700'}`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}