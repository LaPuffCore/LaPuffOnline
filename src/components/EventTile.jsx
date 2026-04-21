import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { isEventHappeningNow, isAftersWindow, isEventLive } from '../lib/eventUtils';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend, subscribeToFavoriteCount } from '../lib/favorites';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';
import { TAG_COLORS } from '../lib/tagColors';
import { awardPoints, POINTS, isEligibleForPoints } from '../lib/pointsSystem';
import { getValidSession } from '../lib/supabaseAuth';
import { getTileAccentColor, useSiteTheme } from '../lib/theme';

// ─── SHARED TREND ICON ─────────────────────────────────────────────────────
// Used in EventTile, EventDetailPopup, and TileView filters for consistency.
export function TrendIcon({ trend, size = 'sm' }) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const textSizeClass = size === 'sm' ? 'text-[10px]' : 'text-xs';
  
  if (trend === 'up') return (
    <svg className={`${sizeClass} text-green-400`} viewBox="0 0 16 16" fill="none">
      <path d="M2 12 L6 7 L9 10 L14 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 4 L14 4 L14 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (trend === 'down') return (
    <svg className={`${sizeClass} text-red-400`} viewBox="0 0 16 16" fill="none">
      <path d="M2 4 L6 9 L9 6 L14 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 12 L14 12 L14 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  return <span className={`font-black text-blue-400 ${textSizeClass}`}>—</span>;
}

export default function EventTile({ event, onClick, onTagClick }) {
  const { resolvedTheme } = useSiteTheme();
  const [fav, setFav] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [trend, setTrend] = useState('neutral');
  const [hovered, setHovered] = useState(false);
  
  const bodyTextColor = resolvedTheme?.bodyTextColor || '#374151';

  const tags = generateAutoTags(event);
  const tzOffset = getUserTZOffset();
  const baseBorderColor = getTileAccentColor(event.hex_color, resolvedTheme);
  const borderColor = hovered ? (resolvedTheme?.accentColor || '#7C3AED') : baseBorderColor;

  // Normalization: 7-day expiry logic matches Popup exactly
  const isExpired = event.event_date && (Date.now() - new Date(event.event_date + 'T00:00:00').getTime()) > 7 * 86400000;
  const happeningNow = isEventHappeningNow(event);
  const eventLive = isEventLive(event);
  const aftersNow = isAftersWindow(event);
  const showImage = event.photos?.length > 0 && !imgError && !isExpired;

  useEffect(() => {
    let mounted = true;
    
    const syncState = async () => {
      const currentFav = isFavorite(event.id);
      const count = await getFavoriteCount(event.id);
      const t = getFavTrend(event.id);
      if (!mounted) return;
      setFav(currentFav);
      setFavCount(count);
      setTrend(t);
    };
    
    syncState();
    
    // Listen for local favorites toggle (one-way broadcast from toggleFavorite)
    window.addEventListener('favoritesChanged', syncState);
    
    // Listen for real-time count changes from other users/devices
    const unsubscribe = subscribeToFavoriteCount(event.id, (newCount) => {
      if (!mounted) return;
      setFavCount(newCount);
      setTrend(getFavTrend(event.id));
    });
    
    return () => {
      mounted = false;
      window.removeEventListener('favoritesChanged', syncState);
      unsubscribe?.();
    };
  }, [event.id]);

  const handleFav = async (e) => {
    e.stopPropagation();
    const newFav = await toggleFavorite(event.id, event);
    setFav(newFav);
    const count = await getFavoriteCount(event.id);
    const t = getFavTrend(event.id);
    setFavCount(count);
    setTrend(t);
    if (newFav) {
      const session = await getValidSession();
      if (isEligibleForPoints(session)) {
        awardPoints(session, POINTS.EVENT_FAVORITED, 'Event Favorited');
      }
    }
  };

  const handleTagClick = (e, tag) => {
    e.stopPropagation();
    if (onTagClick) onTagClick(tag);
  };

  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, tzOffset) : '';
  const displayDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="lp-tile-card group bg-white rounded-[2rem] cursor-pointer hover:scale-[1.02] hover:-translate-y-1 transition-all duration-200 overflow-hidden isolate"
      style={{ border: `3px solid ${borderColor}`, boxShadow: `6px 6px 0px ${resolvedTheme.tileShadowColor || '#000000'}` }}
    >
      {/* Media Header: Height normalized for mobile density */}
      <div className="h-40 sm:h-44 relative overflow-hidden bg-gray-50 border-b-2 border-black [transform:translateZ(0)]">
        {showImage ? (
          <div className="absolute -inset-[2px] overflow-hidden [transform:translateZ(0)]">
            <img 
              src={event.photos[0]} 
              alt="" 
              className="absolute inset-0 w-full h-full object-cover scale-[0.97] transition-transform duration-700 ease-out group-hover:scale-[1.05] will-change-transform [transform-origin:center_center] [transform:translateZ(0)] [backface-visibility:hidden]" 
              onError={() => setImgError(true)} 
            />
          </div>
        ) : (
          <div className="absolute -inset-[2px] w-full h-full flex items-center justify-center text-7xl select-none [transform:translateZ(0)]" style={{ backgroundColor: borderColor + '22' }}>
            {event.representative_emoji || '🎉'}
          </div>
        )}

        {/* Floating Overlays */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {/* Always show trend + count badge next to the star */}
          <div className="flex items-center gap-1 bg-black/80 backdrop-blur-md rounded-full px-2 py-1 border border-white/10">
            <TrendIcon trend={trend} size="sm" />
            {favCount > 0 && <span className="text-white text-[11px] font-black">{favCount}</span>}
          </div>
          <button onClick={handleFav}
            className={`w-9 h-9 rounded-full border-[2.5px] border-black shadow-[2px_2px_0px_black] flex items-center justify-center text-lg transition-transform active:scale-90 ${fav ? 'bg-yellow-400' : 'bg-white hover:bg-yellow-50'}`}>
            {fav ? '⭐' : '☆'}
          </button>
        </div>

        <div className="absolute bottom-2 left-2 bg-black text-white text-[10px] font-black px-2 py-0.5 rounded-md border border-white/10 uppercase">
          {event.price_category || 'FREE'}
        </div>

        {event._auto && (
          <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md border border-white/10 uppercase tracking-wider">
            🤖 AUTO
          </div>
        )}

        <div className="absolute top-2 left-2 w-9 h-9 bg-white rounded-full border-[2.5px] border-black flex items-center justify-center text-base shadow-[2px_2px_0px_black] select-none">
          {event.representative_emoji || '🎉'}
        </div>

        {eventLive && (
          <div className="absolute top-2 left-12 flex items-center gap-1 bg-green-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-[2px_2px_0px_rgba(0,0,0,0.4)] animate-pulse select-none">
            <span className="w-1.5 h-1.5 bg-white rounded-full inline-block flex-shrink-0"/>
            LIVE
          </div>
        )}
        {aftersNow && (
          <div className="absolute top-2 left-12 flex items-center gap-1 bg-purple-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-[2px_2px_0px_rgba(0,0,0,0.4)] animate-pulse select-none">
            <span className="w-1.5 h-1.5 bg-white rounded-full inline-block flex-shrink-0"/>
            AFTERS
          </div>
        )}
        {/* Attendance count overlay — bottom-right of image when live */}
        {happeningNow && event.attendance_count > 0 && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow select-none">
            <span>👥</span>
            <span>{event.attendance_count}</span>
          </div>
        )}
      </div>

      {/* Info Section: Normalizing vertical lines */}
      <div className="p-4">
        {/* min-h ensures the date/tags stay aligned across tiles */}
        <h3 className="font-black text-[13px] sm:text-sm leading-tight line-clamp-2 mb-2 min-h-[2.5rem]">
          {event.event_name}
        </h3>
        
        <div className="flex flex-col gap-1 mb-3">
          <div className="flex items-center justify-between text-[11px] font-bold">
            <span style={{ color: bodyTextColor }}>📅 {displayDate}</span>
            {displayTime && <span style={{ color: bodyTextColor, opacity: 0.75 }}>🕐 {displayTime}</span>}
          </div>
          <div className="text-[11px] font-bold truncate" style={{ color: bodyTextColor, opacity: 0.7 }}>
             {event.location_data?.rsvp_link ? '🔒 RSVP REQUIRED' : `📍 ${event.location_data?.city || 'NYC'}`}
          </div>
        </div>

        {/* Tag row limited to 3 to prevent line wrapping height shifts */}
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map(tag => (
            <button
              key={tag}
              onClick={e => handleTagClick(e, tag)}
              className={`text-[9px] font-black px-2 py-0.5 rounded-full border-[2.5px] border-black shadow-[1px_1px_0px_black] transition-colors ${TAG_COLORS[tag] || 'bg-gray-100'}`}
            >
              {tag.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
