import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend } from '../lib/favorites';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal, TIMEZONES } from '../lib/timezones';

function MiniMap({ lat, lng, address, city }) {
  // Direct OSM Tile Logic - No Auth Required
  const zoom = 15;
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
  
  const staticMapUrl = (lat && lng)
    ? `https://basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}.png`
    : `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${encodeURIComponent(address || city || 'NYC')}&z=14&l=map&size=450,200`;

  return (
    <div className="group relative w-full h-full rounded-2xl overflow-hidden border-2 border-black bg-[#e5e3df] shadow-[4px_4px_0px_black]">
      <img
        src={staticMapUrl}
        alt="Sector Grid"
        className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 transition-all duration-500"
        onError={(e) => { e.target.src = 'https://placehold.co/450x200?text=SIGNAL+LOST'; }}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none pb-4">
        <span className="text-xl">📍</span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t-2 border-black p-1.5 flex items-center justify-between">
        <p className="text-[9px] font-black truncate uppercase tracking-tighter">{address || city || 'NYC GRID'}</p>
        <span className="bg-black text-white px-1.5 py-0.5 rounded text-[7px] font-black uppercase">OSM</span>
      </div>
    </div>
  );
}

export default function EventDetailPopup({ event, onClose, onNext, onPrev }) {
  const [fav, setFav] = useState(false);
  const [imgError, setImgError] = useState(false);
  const tags = generateAutoTags(event);
  const borderColor = event.hex_color || '#FF6B6B';

  useEffect(() => {
    setFav(isFavorite(event.id));
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNext?.();
      if (e.key === 'ArrowLeft') onPrev?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [event.id, onClose, onNext, onPrev]);

  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, getUserTZOffset()) : '';
  const displayDate = event.event_date 
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) 
    : '';

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4">
      {/* INFINITE BLUR FIX: Covers every edge with safe bleed */}
      <div 
        className="fixed inset-[-100%] z-[-1] backdrop-blur-2xl bg-white/30 pointer-events-none" 
        style={{ width: '300vw', height: '300vh' }}
      />
      
      {/* Background click to close */}
      <div className="absolute inset-0 z-0" onClick={onClose} />

      {/* Navigation Arrows */}
      <button 
        onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
        className="hidden md:flex fixed left-8 z-50 w-16 h-16 items-center justify-center bg-white border-4 border-black rounded-full text-3xl shadow-[6px_6px_0px_black] hover:bg-black hover:text-white hover:-translate-x-1 active:translate-x-0 active:shadow-none transition-all"
      >
        ←
      </button>

      <button 
        onClick={(e) => { e.stopPropagation(); onNext?.(); }}
        className="hidden md:flex fixed right-8 z-50 w-16 h-16 items-center justify-center bg-white border-4 border-black rounded-full text-3xl shadow-[6px_6px_0px_black] hover:bg-black hover:text-white hover:translate-x-1 active:translate-x-0 active:shadow-none transition-all"
      >
        →
      </button>

      {/* Succinct Popup Card */}
      <div
        className="bg-white border-[6px] border-black rounded-[2rem] w-full max-w-xl shadow-[25px_25px_0px_rgba(0,0,0,0.2)] relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
        style={{ borderColor: borderColor }}
        onClick={e => e.stopPropagation()} 
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-50 w-10 h-10 bg-black text-white rounded-full font-black flex items-center justify-center border-2 border-white hover:bg-red-500 transition-colors">✕</button>

        <div className="relative h-56 flex-shrink-0 bg-gray-100 border-b-4 border-black overflow-hidden">
          {(!imgError && event.photos?.length > 0) ? (
            <img 
              src={event.photos[0]} 
              alt="" 
              className="w-full h-full object-cover scale-105" // Zoom fix for pixel clipping
              onError={() => setImgError(true)} 
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-8xl opacity-10" style={{ backgroundColor: borderColor }}>
              {event.representative_emoji || '⚡'}
            </div>
          )}
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-start gap-4 mb-6">
            <div className="flex-1">
              <h2 className="text-3xl font-black leading-[0.95] mb-2 uppercase italic tracking-tighter">{event.event_name}</h2>
              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{event.name || 'SYSTEM_OPERATOR'}</p>
            </div>
            <button 
              onClick={() => toggleFavorite(event.id) && setFav(!fav)} 
              className={`w-14 h-14 rounded-xl border-4 border-black flex items-center justify-center text-3xl shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all ${fav ? 'bg-yellow-400' : 'bg-white'}`}
            >
              {fav ? '⭐' : '☆'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 border-2 border-black rounded-xl p-4 flex items-center gap-3 shadow-[4px_4px_0px_black]">
              <span className="text-3xl">📅</span>
              <div>
                <p className="text-sm font-black leading-tight">{displayDate}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase">{displayTime}</p>
              </div>
            </div>
            
            <div className="h-[100px]">
              <MiniMap
                lat={event.location_data?.lat}
                lng={event.location_data?.lng}
                address={event.location_data?.address}
                city={event.location_data?.city}
              />
            </div>
          </div>

          {event.description && (
            <div className="mb-6">
              <p className="text-[9px] font-black uppercase text-gray-400 mb-2 tracking-widest">Protocol Intel</p>
              <div className="text-sm font-bold leading-relaxed bg-gray-50 border-2 border-black p-4 rounded-xl shadow-[inset_4px_4px_0px_rgba(0,0,0,0.05)]">
                {event.description}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-6">
            {tags.map(tag => (
              <span key={tag} className={`text-[9px] font-black px-3 py-1.5 rounded-lg border-2 border-black shadow-[2px_2px_0px_black] ${TAG_COLORS[tag] || 'bg-white'} uppercase tracking-tighter`}>
                #{tag}
              </span>
            ))}
          </div>

          {event.relevant_links?.length > 0 && (
            <div className="border-t-4 border-black pt-6">
              <div className="grid grid-cols-1 gap-2">
                {event.relevant_links.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-gray-50 border-2 border-black rounded-xl hover:bg-black hover:text-white transition-all group shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                    <span className="text-[10px] font-black truncate max-w-[85%] uppercase tracking-tighter">{link.replace(/^https?:\/\/(www\.)?/, '')}</span>
                    <span className="text-xl group-hover:translate-x-1 transition-transform">→</span>
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