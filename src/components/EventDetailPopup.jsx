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
   * FIX 1: GRID SIGNAL LOST / YANDEX ERROR
   * Forced longitude,latitude order and switched to comma-separated size.
   * Added 'lang=en_US' to ensure the service responds to the request correctly.
   */
  const staticMapUrl = (lat && lng)
    ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=15&l=map&size=450,200&pt=${lng},${lat},pm2rdm`
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
              // This triggers "Grid Signal Lost" if the API 403s or 404s
              e.target.style.display = 'none'; 
              e.target.parentNode.classList.add('flex', 'items-center', 'justify-center');
              e.target.parentNode.innerHTML = '<span class="text-[8px] font-black text-slate-400 uppercase tracking-widest">Grid Signal Lost</span>';
            }}
          />
        ) : (
          <div className="w-full h-full bg-slate-200 flex items-center justify-center">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">No Signal</span>
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
      {/* FIX 2: SEAMLESS BLUR 
        Moved to the absolute top of the stack and used 'fixed inset-[-10%]' 
        to bleed over edges and prevent any segmented "white blocks" or lines.
      */}
      <div 
        className="fixed inset-[-10%] z-[9998] backdrop-blur-xl bg-white/10 pointer-events-none transition-opacity duration-300" 
        style={{ width: '120vw', height: '120vh' }}
      />

      <div 
        className="fixed inset-0 z-[9999] flex items-start justify-center p-4 overflow-y-auto" 
        onClick={onClose}
      >
        {onPrev && (
          <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="fixed left-6 top-1/2 -translate-y-1/2 z-[10000] w-14 h-24 bg-black/20 hover:bg-black/40 text-white hidden md:flex items-center justify-center rounded-3xl border-2 border-white/30 transition-all group backdrop-blur-md">
            <span className="text-4xl font-light group-hover:-translate-x-1 transition-transform">＜</span>
          </button>
        )}
        
        {onNext && (
          <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="fixed right-6 top-1/2 -translate-y-1/2 z-[10000] w-14 h-24 bg-black/20 hover:bg-black/40 text-white hidden md:flex items-center justify-center rounded-3xl border-2 border-white/30 transition-all group backdrop-blur-md">
            <span className="text-4xl font-light group-hover:translate-x-1 transition-transform">＞</span>
          </button>
        )}
        
        <div
          className="bg-white border-[6px] md:border-[12px] border-black rounded-[2.5rem] w-full max-w-lg md:max-w-2xl my-8 shadow-[40px_40px_0px_rgba(0,0,0,0.2)] relative overflow-hidden"
          style={{ borderColor: borderColor }}
          onClick={e => e.stopPropagation()} 
        >
          <button onClick={onClose} className="absolute top-6 right-6 z-20 w-12 h-12 bg-black text-white rounded-full font-black hover:bg-red-500 flex items-center justify-center border-2 border-white/20 shadow-xl transition-transform active:scale-90">✕</button>

          <div className="relative h-64 md:h-80 bg-gray-100 border-b-4 border-black">
            {(!imgError && event.photos?.length > 0) ? (
              <div className="w-full h-full overflow-hidden">
                <img src={event.photos[photoIdx]} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-9xl select-none opacity-20" style={{ backgroundColor: `${borderColor}11` }}>
                {event.representative_emoji || '🎉'}
              </div>
            )}
          </div>

          <div className="p-6 md:p-10">
            <div className="flex flex-col gap-4 mb-8">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <h2 className="text-2xl md:text-5xl font-black leading-[0.9] mb-2 uppercase italic tracking-tighter">{event.event_name}</h2>
                  {event.name && <p className="text-[10px] md:text-xs text-gray-400 font-black uppercase tracking-widest">Operator: {event.name}</p>}
                </div>
                <div className="flex flex-col items-center gap-1">
                  <button onClick={handleFav} className={`w-14 h-14 md:w-20 md:h-20 rounded-2xl border-4 border-black flex items-center justify-center text-3xl md:text-5xl shadow-[6px_6px_0px_black] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all ${fav ? 'bg-yellow-400' : 'bg-white'}`}>
                    {fav ? '⭐' : '☆'}
                  </button>
                  <div className="flex items-center gap-1 bg-black text-white px-3 py-1 rounded-lg font-black text-[12px] mt-1">
                    <TrendIcon /> {favCount}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-gray-50 border-2 border-black rounded-2xl p-5 flex items-center gap-4 shadow-[6px_6px_0px_black]">
                <span className="text-4xl">📅</span>
                <div>
                  <p className="text-sm md:text-lg font-black leading-tight">{displayDate}</p>
                  <p className="text-xs font-bold text-gray-500 mt-1 uppercase tracking-widest">{displayTime} {tzLabel}</p>
                </div>
              </div>
              
              <div className="h-[120px] md:h-[140px]">
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
                <div className="text-sm md:text-base font-bold leading-relaxed bg-gray-50 border-4 border-black p-6 rounded-2xl shadow-[inset_6px_6px_0px_rgba(0,0,0,0.05)]">
                  {event.description}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-10">
              {tags.map(tag => (
                <span key={tag} className={`text-[11px] font-black px-4 py-2 rounded-xl border-2 border-black shadow-[4px_4px_0px_black] ${TAG_COLORS[tag] || 'bg-white'} uppercase tracking-tighter`}>
                  #{tag}
                </span>
              ))}
            </div>

            {event.relevant_links?.length > 0 && (
              <div className="border-t-[6px] border-black pt-8">
                <p className="text-[10px] font-black uppercase text-gray-400 mb-4 tracking-widest">Digital Nodes</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {event.relevant_links.map((link, i) => (
                    <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-5 bg-gray-50 border-2 border-black rounded-2xl hover:bg-black hover:text-white transition-all group shadow-[6px_6px_0px_black] active:translate-x-1 active:translate-y-1 active:shadow-none">
                      <span className="text-xs font-black truncate max-w-[80%] uppercase tracking-tighter">{link.replace(/^https?:\/\/(www\.)?/, '')}</span>
                      <span className="text-2xl group-hover:translate-x-2 transition-transform">→</span>
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