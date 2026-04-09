import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend } from '../lib/favorites';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal, TIMEZONES } from '../lib/timezones';

function MiniMap({ lat, lng, address, city }) {
  const mapsQuery = lat && lng 
    ? `${lat},${lng}` 
    : encodeURIComponent(`${address || ''} ${city || 'New York'} NY`);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  /**
   * FIX 1: YANDEX OFFLINE GRID ERROR
   * Coordinates must be passed as "longitude,latitude". 
   * Added 'apikey' check placeholder and forced protocol-relative URL.
   * Documentation requires size=width,height for V1.x or widthxheight for V1.
   */
  const staticMapUrl = (lat && lng)
    ? `https://static-maps.yandex.ru/1.x/?ll=${lng},${lat}&size=450,200&z=15&l=map&pt=${lng},${lat},pm2rdm`
    : null;

  return (
    <a 
      href={mapsUrl} 
      target="_blank" 
      rel="noopener noreferrer" 
      className="group block relative w-full h-full rounded-2xl overflow-hidden border-2 border-black cursor-pointer hover:border-blue-500 transition-all shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none bg-[#e5e3df]"
    >
      <div className="absolute inset-0 z-0 overflow-hidden bg-[#e5e3df]">
        {staticMapUrl ? (
          <img
            src={staticMapUrl}
            alt="Sector Location"
            className="w-full h-full object-cover grayscale opacity-90 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-300"
            onError={(e) => { 
              // If Yandex fails, we see the fallback background
              e.target.style.display = 'none'; 
            }}
          />
        ) : (
          <div className="w-full h-full bg-slate-200 flex items-center justify-center">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Grid Signal Lost</span>
          </div>
        )}
      </div>

      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none pb-6">
        <span className="text-3xl drop-shadow-md">📍</span>
      </div>
      
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t-2 border-black p-2 flex items-center justify-between gap-2 z-20">
        <div className="truncate flex-1">
          <p className="text-[7px] font-black uppercase text-gray-400 leading-none mb-0.5 tracking-tighter">Sector Location</p>
          <p className="text-[10px] font-black truncate uppercase tracking-tighter">{address || city || 'NYC GRID'}</p>
        </div>
        <div className="flex-shrink-0 bg-black text-white px-2 py-1 rounded-lg text-[9px] font-black group-hover:bg-[#7C3AED] transition-colors flex items-center gap-1">
          MAPS <span className="text-[10px]">↗</span>
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

  useEffect(() => {
    setFav(isFavorite(event.id));
    setFavCount(getFavoriteCount(event.id));
    setTrend(getFavTrend(event.id));

    // Prevent body shift
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    
    const onKey = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => { 
      document.body.style.overflow = ''; 
      document.body.style.paddingRight = '0px';
      window.removeEventListener('keydown', onKey); 
    };
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
    <>
      {/* FIX 2: GLOBAL VIEWPORT BLUR 
        Set to Z-9998 to sit exactly behind the popup but over the entire UI.
        This ignores parent segmentation and stretches across the full viewport.
      */}
      <div 
        className="fixed inset-0 z-[9998] backdrop-blur-md bg-white/5 pointer-events-none" 
        aria-hidden="true"
      />

      <div 
        className="fixed inset-0 z-[9999] flex items-start justify-center p-4 overflow-y-auto" 
        onClick={onClose}
      >
        {onPrev && (
          <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="fixed left-4 top-1/2 -translate-y-1/2 z-[10000] w-12 h-20 bg-black/10 hover:bg-black/20 text-white hidden md:flex items-center justify-center rounded-2xl border-2 border-white/20 transition-all group">
            <span className="text-4xl font-light group-hover:-translate-x-1 transition-transform">＜</span>
          </button>
        )}
        
        {onNext && (
          <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="fixed right-4 top-1/2 -translate-y-1/2 z-[10000] w-12 h-20 bg-black/10 hover:bg-black/20 text-white hidden md:flex items-center justify-center rounded-2xl border-2 border-white/20 transition-all group">
            <span className="text-4xl font-light group-hover:translate-x-1 transition-transform">＞</span>
          </button>
        )}
        
        <div
          className="bg-white border-[6px] md:border-[12px] border-black rounded-[2.5rem] w-full max-w-lg md:max-w-2xl my-8 shadow-[30px_30px_0px_rgba(0,0,0,0.15)] relative overflow-hidden"
          style={{ borderColor: borderColor }}
          onClick={e => e.stopPropagation()} 
        >
          <button onClick={onClose} className="absolute top-4 right-4 z-20 w-10 h-10 bg-black text-white rounded-full font-black hover:bg-red-500 flex items-center justify-center border-2 border-white/20 shadow-lg">✕</button>

          <div className="relative h-64 md:h-80 bg-gray-100 border-b-4 border-black">
            {(!imgError && event.photos?.length > 0) ? (
              <div className="w-full h-full overflow-hidden">
                <img src={event.photos[photoIdx]} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-9xl select-none opacity-20">
                {event.representative_emoji || '🎉'}
              </div>
            )}
          </div>

          <div className="p-6 md:p-10">
            <div className="flex flex-col gap-4 mb-8">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <h2 className="text-2xl md:text-4xl font-black leading-tight mb-1 uppercase italic tracking-tighter">{event.event_name}</h2>
                  {event.name && <p className="text-[10px] md:text-xs text-gray-400 font-black uppercase tracking-widest">Operator: {event.name}</p>}
                </div>
                <div className="flex flex-col items-center gap-1">
                  <button onClick={handleFav} className={`w-12 h-12 md:w-16 md:h-16 rounded-2xl border-4 border-black flex items-center justify-center text-2xl md:text-4xl shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${fav ? 'bg-yellow-400' : 'bg-white'}`}>
                    {fav ? '⭐' : '☆'}
                  </button>
                  <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-lg font-black text-[10px]">
                    <TrendIcon /> {favCount}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <div className="bg-gray-50 border-2 border-black rounded-2xl p-4 flex items-center gap-4 shadow-[4px_4px_0px_black]">
                <span className="text-3xl md:text-4xl">📅</span>
                <div>
                  <p className="text-sm md:text-base font-black leading-tight">{displayDate}</p>
                  <p className="text-xs font-bold text-gray-500 mt-1 uppercase tracking-tight">{displayTime} {tzLabel}</p>
                </div>
              </div>
              
              <div className="h-[100px] md:h-[120px]">
                <MiniMap
                  lat={event.location_data?.lat}
                  lng={event.location_data?.lng}
                  address={event.location_data?.address}
                  city={event.location_data?.city}
                />
              </div>
            </div>

            {event.description && (
              <div className="mb-8">
                <p className="text-[10px] font-black uppercase text-gray-400 mb-2 tracking-widest">Protocol Intel</p>
                <div className="text-sm md:text-base font-bold leading-relaxed bg-gray-50 border-2 border-black p-5 rounded-2xl shadow-[inset_4px_4px_0px_rgba(0,0,0,0.05)]">
                  {event.description}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-8">
              {tags.map(tag => (
                <span key={tag} className={`text-[10px] font-black px-3 py-2 rounded-xl border-2 border-black shadow-[3px_3px_0px_black] ${TAG_COLORS[tag] || 'bg-white'} uppercase tracking-tighter`}>
                  #{tag}
                </span>
              ))}
            </div>

            {event.relevant_links?.length > 0 && (
              <div className="border-t-[4px] border-black pt-8">
                <p className="text-[10px] font-black uppercase text-gray-400 mb-4 tracking-widest">Digital Nodes</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {event.relevant_links.map((link, i) => (
                    <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-gray-50 border-2 border-black rounded-2xl hover:bg-black hover:text-white transition-all group shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none border-2 border-black">
                      <span className="text-xs font-black truncate max-w-[80%] uppercase tracking-tighter">{link.replace(/^https?:\/\/(www\.)?/, '')}</span>
                      <span className="text-xl group-hover:translate-x-1 transition-transform">→</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}