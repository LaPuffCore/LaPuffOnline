import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend } from '../lib/favorites';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal, TIMEZONES } from '../lib/timezones';

function MiniMap({ lat, lng, address, city }) {
  const mapsQuery = lat && lng ? `${lat},${lng}` : encodeURIComponent(`${address || ''} ${city || 'New York'} NY`);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  // Updated to use a standard MapLibre-friendly / OpenStreetMap static preview logic
  return (
    <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
      className="group block relative w-full rounded-2xl overflow-hidden border-2 border-black cursor-pointer hover:border-blue-500 transition-all shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
      <div className="h-32 bg-gray-200">
        {lat && lng ? (
          <img 
            src={`https://tile.openstreetmap.org/15/${Math.floor((lng + 180) / 360 * Math.pow(2, 15))}/${Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, 15))}.png`} 
            alt="Map Preview" className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all" crossOrigin="anonymous" 
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-100 text-4xl">📍</div>
        )}
      </div>
      
      <div className="bg-white border-t-2 border-black p-3 flex items-center justify-between gap-2">
        <div className="truncate">
          <p className="text-[10px] font-black uppercase text-gray-400 leading-none mb-1">Location</p>
          <p className="text-sm font-black truncate">{address || city || 'New York'}</p>
        </div>
        <div className="flex-shrink-0 bg-black text-white px-3 py-1.5 rounded-xl text-xs font-black group-hover:bg-blue-600 transition-colors">
          OPEN IN MAPS ↗
        </div>
      </div>
    </a>
  );
}

export default function EventDetailPopup({ event, onClose, onNext, onPrev }) {
  const [fav, setFav] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [trend, setTrend] = useState('neutral');
  const [photoIdx, setPhotoIdx] = useState(0);
  const [imgError, setImgError] = useState(false);
  
  const tags = generateAutoTags(event);
  const tzOffset = getUserTZOffset();
  const tzLabel = (TIMEZONES.find(t => t.offset === tzOffset) || TIMEZONES[0]).label;
  const borderColor = event.hex_color || '#FF6B6B';

  const isExpired = event.event_date && (Date.now() - new Date(event.event_date + 'T00:00:00').getTime()) > 7 * 86400000;
  const showImage = event.photos?.length > 0 && !imgError && !isExpired;

  useEffect(() => {
    setFav(isFavorite(event.id));
    setFavCount(getFavoriteCount(event.id));
    setTrend(getFavTrend(event.id));
    
    // Lock viewport scroll
    document.body.style.overflow = 'hidden';
    const onKey = e => { 
      if (e.key === 'Escape') onClose(); 
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [event.id, onClose, onNext, onPrev]);

  const handleFav = () => {
    const isNowFav = toggleFavorite(event.id);
    setFav(isNowFav);
    setFavCount(getFavoriteCount(event.id));
    setTrend(getFavTrend(event.id));
    window.dispatchEvent(new Event('favoritesChanged'));
  };

  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, tzOffset) : '';
  const displayDate = event.event_date 
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const TrendIcon = () => {
    if (trend === 'up') return <span className="text-green-500">▲</span>;
    if (trend === 'down') return <span className="text-red-500">▼</span>;
    return <span className="text-gray-400">—</span>;
  };

  return (
    /* Changed to items-start + overflow-y-auto to allow whole-popup scrolling (Points 2, 3, 7) */
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      
      {/* Side Navigation */}
      {onPrev && (
        <button 
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="fixed left-4 top-1/2 -translate-y-1/2 z-[60] w-12 h-20 bg-white/10 hover:bg-white/20 text-white flex items-center justify-center rounded-2xl transition-all group hidden md:flex"
        >
          <span className="text-4xl font-light group-hover:-translate-x-1 transition-transform">＜</span>
        </button>
      )}
      
      {onNext && (
        <button 
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="fixed right-4 top-1/2 -translate-y-1/2 z-[60] w-12 h-20 bg-white/10 hover:bg-white/20 text-white flex items-center justify-center rounded-2xl transition-all group hidden md:flex"
        >
          <span className="text-4xl font-light group-hover:translate-x-1 transition-transform">＞</span>
        </button>
      )}

      <div
        /* Points 3 & 5: max-w-2xl for web, removed overflow-y-auto from here */
        className="bg-white border-4 border-black rounded-[2.5rem] w-full max-w-lg md:max-w-2xl my-4 shadow-[12px_12px_0px_rgba(0,0,0,0.5)] relative"
        style={{ borderColor: borderColor, borderTopWidth: 12 }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-20 w-10 h-10 bg-black text-white rounded-full font-black hover:bg-red-500 flex items-center justify-center shadow-[4px_4px_0px_#333] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">✕</button>

        {/* Media Header */}
        <div className="relative h-64 md:h-80 bg-gray-100 border-b-4 border-black overflow-hidden">
          {showImage ? (
            <>
              <img src={event.photos[photoIdx]} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
              {event.photos.length > 1 && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                  {event.photos.map((_, i) => (
                    <button key={i} onClick={() => setPhotoIdx(i)} 
                      className={`w-3 h-3 rounded-full border-2 border-black transition-all ${i === photoIdx ? 'bg-white w-6' : 'bg-white/40'}`} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-9xl select-none" style={{ backgroundColor: `${borderColor}22` }}>
              {event.representative_emoji || '🎉'}
            </div>
          )}
        </div>

        <div className="p-6 md:p-10">
          {/* Point 1 & 6: Layout adjustments for mobile vs web */}
          <div className="flex flex-col md:flex-row items-start justify-between gap-6 mb-6">
            <div className="flex items-start gap-4 flex-1">
              {/* Point 6: Emoji hidden on mobile here, moved under favs */}
              <span className="hidden md:block text-5xl drop-shadow-md">{event.representative_emoji || '🎉'}</span>
              <div className="flex-1">
                {/* Point 6: Title max 2 lines */}
                <h2 className="text-2xl md:text-4xl font-black leading-tight mb-2 line-clamp-2">{event.event_name}</h2>
                {event.name && (
                   /* Point 6: Thinner, horizontal spanning one-line host */
                   <p className="text-[10px] md:text-xs text-gray-500 font-bold uppercase tracking-widest border-t border-gray-100 pt-2 inline-block w-full">
                     Hosted by {event.name}
                   </p>
                )}
              </div>
            </div>
            
            {/* Fav + Trend Section: Point 1 (Right align mobile) */}
            <div className="flex flex-row md:flex-col items-center self-end md:self-start gap-3">
              {/* Point 6: Emoji appears here on mobile only */}
              <span className="md:hidden text-4xl mr-2">{event.representative_emoji || '🎉'}</span>
              
              <div className="flex flex-col items-center gap-1">
                <button onClick={handleFav} className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl border-4 border-black flex items-center justify-center text-2xl md:text-3xl shadow-[4px_4px_0px_black] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${fav ? 'bg-yellow-400' : 'bg-white hover:bg-yellow-50'}`}>
                  {fav ? '⭐' : '☆'}
                </button>
                <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-lg font-black text-[10px]">
                  <TrendIcon /> {favCount}
                </div>
              </div>
            </div>
          </div>

          {/* Grid layout for Web (Point 5) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="space-y-3">
              <div className="bg-gray-50 border-2 border-black rounded-2xl p-4 flex items-center gap-4 shadow-[4px_4px_0px_black]">
                <span className="text-2xl">📅</span>
                <div>
                  <p className="text-sm font-black leading-none">{displayDate}</p>
                  {displayTime && <p className="text-xs font-bold text-gray-500 mt-1">{displayTime} {tzLabel}</p>}
                </div>
              </div>
              
              {event.location_data?.rsvp_link && (
                <div className="bg-blue-50 border-2 border-black rounded-2xl p-4 shadow-[4px_4px_0px_black]">
                  <p className="text-sm font-black mb-1">🔒 RSVP REQUIRED</p>
                  <a href={event.location_data.rsvp_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-xs font-bold break-all">Register Here ↗</a>
                </div>
              )}
            </div>

            <div className="md:pt-0">
               {/* Fused Location Map Component - Point 4 */}
              {!event.location_data?.rsvp_link && (
                <MiniMap 
                  lat={event.location_data?.lat} 
                  lng={event.location_data?.lng} 
                  address={event.location_data?.address} 
                  city={event.location_data?.city} 
                />
              )}
            </div>
          </div>

          {event.description && (
            <div className="mb-6">
              <p className="text-xs font-black uppercase text-gray-400 mb-2">Description</p>
              <p className="text-sm font-medium leading-relaxed bg-gray-50 border-2 border-black p-4 rounded-2xl italic shadow-[inset_2px_2px_0px_black]">
                "{event.description}"
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-8">
            {tags.map(tag => (
              <span key={tag} className={`text-[10px] font-black px-3 py-1.5 rounded-xl border-2 border-black shadow-[3px_3px_0px_black] ${TAG_COLORS[tag] || 'bg-white'}`}>
                #{tag.toUpperCase()}
              </span>
            ))}
          </div>

          {event.relevant_links?.length > 0 && (
            <div className="border-t-4 border-black pt-6">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-3">Relevant Links</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {event.relevant_links.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 bg-gray-50 border-2 border-black rounded-xl hover:bg-gray-100 transition-colors group">
                    <span className="text-xs font-bold truncate max-w-[85%]">🔗 {link.replace(/^https?:\/\//, '')}</span>
                    <span className="text-lg group-hover:translate-x-1 transition-transform">→</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}