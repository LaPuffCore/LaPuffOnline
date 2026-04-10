import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend, subscribeToFavoriteCount } from '../lib/favorites';
import { TrendIcon } from './EventTile';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';
import { useNavigate } from 'react-router-dom';
import { awardPoints, POINTS, isEligibleForPoints } from '../lib/pointsSystem';
import { getValidSession } from '../lib/supabaseAuth';

function MiniMap({ lat, lng, address, city, borderColor }) {
  const mapUrl = (lat && lng)
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.005},${lng + 0.005},${lat + 0.005}&layer=mapnik&marker=${lat},${lng}`
    : `https://maps.google.com/maps?q=${encodeURIComponent(address || city || 'New York')}&t=&z=14&ie=UTF8&iwloc=&output=embed`;

  const outUrl = (lat && lng)
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
    : `https://maps.google.com/maps?q=${encodeURIComponent(address || city || 'New York')}`;

  return (
    <a 
      href={outUrl} 
      target="_blank" 
      rel="noopener noreferrer" 
      className="group block relative w-full h-full rounded-2xl overflow-hidden border-[2.5px] border-black bg-[#e5e3df] shadow-[4px_4px_0px_black] transition-all duration-300 hover:scale-[1.02]"
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = borderColor;
        e.currentTarget.lastChild.style.borderColor = borderColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'black';
        e.currentTarget.lastChild.style.borderColor = 'black';
      }}
    >
      <iframe 
        src={mapUrl}
        width="100%" 
        height="100%" 
        frameBorder="0"
        scrolling="no"
        style={{ border: 0, filter: 'grayscale(0.6)' }} 
        className="group-hover:filter-none transition-all duration-500 pointer-events-none"
        title="Location Map"
      ></iframe>
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t-2 border-black p-1.5 flex items-center justify-between z-20 transition-colors duration-300">
        <p className="text-[9px] font-black truncate uppercase tracking-tighter">{address || city || 'NYC GRID'}</p>
        <span className="bg-black text-white px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest">MAP ↗</span>
      </div>
    </a>
  );
}

export default function EventDetailPopup({ event, onClose, onNext, onPrev }) {
  const navigate = useNavigate();
  const [fav, setFav] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [trend, setTrend] = useState('neutral');
  const [imgError, setImgError] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);

  const tags = generateAutoTags(event);
  const borderColor = event.hex_color || '#FF6B6B';

  // 7-day expiry logic matching EventTile exactly
  const isExpired = event.event_date && (Date.now() - new Date(event.event_date + 'T00:00:00').getTime()) > 7 * 86400000;
  const showImage = event.photos?.length > 0 && !imgError && !isExpired;

  useEffect(() => {
    // FRESH LOOK AT POSITIONING: 
    // We target the main scrollable element if it exists, otherwise fallback to window.
    // This handles the "Totalizing" scroll count by checking the actual displacement.
    const calculateOffset = () => {
      const scrollEl = document.querySelector('main.overflow-y-auto') || document.documentElement;
      setScrollOffset(scrollEl.scrollTop || window.pageYOffset);
    };

    calculateOffset();
    
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const syncFavorites = async () => {
      const currentFav = isFavorite(event.id);
      const count = await getFavoriteCount(event.id);
      const t = getFavTrend(event.id);
      setFav(currentFav);
      setFavCount(count);
      setTrend(t);
    };
    
    syncFavorites();
    window.addEventListener('favoritesChanged', syncFavorites);
    window.addEventListener('resize', calculateOffset); // Handle layout shifts
    
    // Listen for real-time count changes from other users/devices
    const unsubscribe = subscribeToFavoriteCount(event.id, (newCount) => {
      setFavCount(newCount);
      setTrend(getFavTrend(event.id));
    });
    
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
    };
    window.addEventListener('keydown', handleKey);
    
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('favoritesChanged', syncFavorites);
      window.removeEventListener('resize', calculateOffset);
      window.removeEventListener('keydown', handleKey);
      unsubscribe?.();
    };
  }, [event.id, onClose, onNext, onPrev]);

  const handleFavoriteClick = async (e) => {
    e.stopPropagation();
    const newFav = await toggleFavorite(event.id);
    setFav(isFavorite(event.id));
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

  const handleShare = async (e) => {
    e.stopPropagation();
    try {
      const shareUrl = `${window.location.origin}${window.location.pathname}?event=${event.id}`;
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // clipboard access denied — silently fail
    }
  };

  const handleDateClick = () => {
    navigate('/calendar', { 
      state: { 
        initialDate: event.event_date,
        initialView: 'weekly'
      } 
    });
  };

  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, getUserTZOffset()) : '';
  const displayDate = event.event_date 
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) 
    : '';

  return (
    <div 
      className="absolute inset-x-0 z-[100000] min-h-screen flex flex-col items-center p-2 sm:p-4"
      style={{ top: `${scrollOffset}px` }}
    >
      <div 
        className="fixed inset-0 z-[-1] backdrop-blur-xl bg-white/40 transform-gpu" 
        onClick={onClose}
      />
      
      <div className="w-full pt-8 sm:pt-16" />

      {/* ARROW WRAPPER */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 lg:gap-12 w-full max-w-5xl mb-12">
        
        <button 
          onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
          className={`hidden sm:flex w-14 h-14 lg:w-16 lg:h-16 flex-shrink-0 items-center justify-center bg-white border-4 border-black rounded-full text-2xl lg:text-3xl shadow-[6px_6px_0px_black] transition-all
            ${onPrev ? 'hover:bg-black hover:text-white hover:-translate-x-1 active:translate-x-0 cursor-pointer opacity-100' : 'opacity-20 grayscale cursor-not-allowed'}`}
        >
          ←
        </button>

        {/* Popup Card */}
        <div
          className="bg-white border-[4px] sm:border-[6px] border-black rounded-[1.5rem] sm:rounded-[2rem] w-full max-w-xl shadow-[15px_15px_0px_rgba(0,0,0,0.2)] sm:shadow-[25px_25px_0px_rgba(0,0,0,0.2)] relative z-10 overflow-hidden flex flex-col mx-2 sm:mx-0"
          style={{ borderColor: borderColor }}
          onClick={e => e.stopPropagation()} 
        >
          <button onClick={onClose} className="absolute top-3 right-3 sm:top-4 sm:right-4 z-50 w-8 h-8 sm:w-10 sm:h-10 bg-black text-white rounded-full font-black flex items-center justify-center border-[2.5px] border-white hover:bg-red-500 transition-colors text-xs sm:text-base">✕</button>

          <div className="relative h-48 sm:h-56 flex-shrink-0 bg-gray-100 border-b-4 border-black overflow-hidden">
            {showImage ? (
              <img 
                src={event.photos[0]} 
                alt="" 
                className="w-full h-full object-cover scale-[1.01]"
                onError={() => setImgError(true)} 
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-6xl sm:text-8xl" style={{ backgroundColor: borderColor }}>
                <span className="drop-shadow-lg">{event.representative_emoji || '⚡'}</span>
              </div>
            )}
            
            <div className="absolute inset-y-0 left-0 right-0 flex justify-between items-center px-2 sm:hidden pointer-events-none">
                <button onClick={onPrev} className={`pointer-events-auto w-10 h-10 bg-white/90 border-[2.5px] border-black rounded-full font-black ${!onPrev ? 'opacity-0' : ''}`}>←</button>
                <button onClick={onNext} className={`pointer-events-auto w-10 h-10 bg-white/90 border-[2.5px] border-black rounded-full font-black ${!onNext ? 'opacity-0' : ''}`}>→</button>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div className="flex justify-between items-start gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div className="flex-1">
                <h2 className="text-xl sm:text-3xl font-black leading-[1.1] sm:leading-[0.95] mb-2 uppercase italic tracking-tighter line-clamp-3">
                    {event.event_name}
                </h2>
                <p className="text-[9px] sm:text-[10px] text-gray-400 font-black uppercase tracking-widest">{event.name || 'SYSTEM_OPERATOR'}</p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <button 
                  onClick={handleFavoriteClick} 
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl border-[3px] sm:border-4 border-black flex items-center justify-center text-2xl sm:text-3xl shadow-[3px_3px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all ${fav ? 'bg-yellow-400' : 'bg-white'}`}
                >
                  {fav ? '⭐' : '☆'}
                </button>
                <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-md font-black text-[9px] sm:text-[10px]">
                  <TrendIcon trend={trend} size="sm" />
                  {favCount}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-6">
              <button 
                onClick={handleDateClick}
                className="bg-gray-50 border-[2.5px] border-black rounded-xl p-3 sm:p-4 flex items-center gap-3 shadow-[4px_4px_0px_black] transition-all hover:scale-[1.02] text-left group"
                onMouseEnter={(e) => e.currentTarget.style.borderColor = borderColor}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'black'}
              >
                <span className="text-2xl sm:text-3xl">📅</span>
                <div>
                  <p className="text-xs sm:text-sm font-black leading-tight">{displayDate}</p>
                  <p className="text-[9px] sm:text-[10px] font-bold text-gray-400 uppercase">{displayTime}</p>
                </div>
              </button>
              
              <div className="h-[100px]">
                <MiniMap
                  lat={event.location_data?.lat}
                  lng={event.location_data?.lng}
                  address={event.location_data?.address}
                  city={event.location_data?.city}
                  borderColor={borderColor}
                />
              </div>
            </div>

            {event.description && (
              <div className="mb-6">
                <p className="text-[9px] font-black uppercase text-gray-400 mb-2 tracking-widest">Protocol Intel</p>
                <div className="text-xs sm:text-sm font-bold leading-relaxed bg-gray-50 border-[2.5px] border-black p-3 sm:p-4 rounded-xl shadow-[inset_4px_4px_0px_rgba(0,0,0,0.05)]">
                  {event.description}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-6">
              {tags.map(tag => (
                <span key={tag} className={`text-[8px] sm:text-[9px] font-black px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border-[2.5px] border-black shadow-[2px_2px_0px_black] ${TAG_COLORS[tag] || 'bg-white'} uppercase tracking-tighter`}>
                  #{tag}
                </span>
              ))}
            </div>

            {event.relevant_links?.length > 0 && (
              <div className="border-t-4 border-black pt-6">
                <div className="grid grid-cols-1 gap-2">
                  {event.relevant_links.map((link, i) => (
                    <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 border-[2.5px] border-black rounded-xl hover:bg-black hover:text-white transition-all group shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                      <span className="text-[9px] sm:text-[10px] font-black truncate max-w-[85%] uppercase tracking-tighter">{link.replace(/^https?:\/\/(www\.)?/, '')}</span>
                      <span className="text-lg sm:text-xl group-hover:translate-x-1 transition-transform">→</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>

        <button 
          onClick={(e) => { e.stopPropagation(); onNext?.(); }}
          className={`hidden sm:flex w-14 h-14 lg:w-16 lg:h-16 flex-shrink-0 items-center justify-center bg-white border-4 border-black rounded-full text-2xl lg:text-3xl shadow-[6px_6px_0px_black] transition-all
            ${onNext ? 'hover:bg-black hover:text-white hover:translate-x-1 active:translate-x-0 cursor-pointer opacity-100' : 'opacity-20 grayscale cursor-not-allowed'}`}
        >
          →
        </button>
      </div>
    </div>
  );
}
