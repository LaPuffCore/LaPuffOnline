import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend } from '../lib/favorites';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal, TIMEZONES } from '../lib/timezones';

function MiniMap({ lat, lng, address, city }) {
  // OPENSTREETMAP (OSM) - STADIA PROXY (No Keys required)
  const mapCenter = (lat && lng) ? `${lat},${lng}` : encodeURIComponent(`${address || ''} ${city || ''}`);
  const staticMapUrl = `https://api.stadiamaps.com/static/v1/fallback?center=${mapCenter}&zoom=14&size=450x200&layer=osm_bright&format=png`;
  const externalMapUrl = `https://www.openstreetmap.org/search?query=${mapCenter}`;

  return (
    <a 
      href={externalMapUrl} 
      target="_blank" 
      rel="noopener noreferrer" 
      className="group block relative w-full h-full rounded-2xl overflow-hidden border-2 border-black bg-[#f8f4f0] shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
    >
      <div className="absolute inset-0 z-0 bg-[#e5e3df]">
        <img
          src={staticMapUrl}
          alt="OSM Node"
          className="w-full h-full object-cover grayscale opacity-90 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-300"
          onError={(e) => { 
            e.target.style.display = 'none'; 
            e.target.parentNode.innerHTML = '<div class="w-full h-full flex items-center justify-center bg-slate-100"><span class="text-[8px] font-black text-slate-400 uppercase tracking-widest">MAP SIGNAL OFFLINE</span></div>';
          }}
        />
      </div>
      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none pb-4">
        <span className="text-2xl drop-shadow-md">📍</span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t-2 border-black p-2 flex items-center justify-between z-20">
        <p className="text-[10px] font-black truncate uppercase tracking-tighter">{address || city || 'NYC GRID'}</p>
        <div className="bg-black text-white px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter">OSM ↗</div>
      </div>
    </a>
  );
}

export default function EventDetailPopup({ event, onClose, onNext, onPrev }) {
  const [fav, setFav] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [trend, setTrend] = useState('neutral');
  const [imgError, setImgError] = useState(false);

  const tags = generateAutoTags(event);
  const tzOffset = getUserTZOffset();
  const tzLabel = (TIMEZONES.find(t => t.offset === tzOffset) || TIMEZONES[0]).label;
  const borderColor = event.hex_color || '#FF6B6B';

  useEffect(() => {
    setFav(isFavorite(event.id));
    setFavCount(getFavoriteCount(event.id));
    setTrend(getFavTrend(event.id));

    const onKey = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const TrendIcon = () => (
    trend === 'up' ? <span className="text-green-500">▲</span> :
    trend === 'down' ? <span className="text-red-500">▼</span> :
    <span className="text-gray-400">—</span>
  );

  return (
    /* CONTAINER: fixed inset-0 + overflow-y-auto allows the page to scroll 
       naturally when content exceeds the viewport height.
    */
    <div className="fixed inset-0 z-[99999] overflow-y-auto flex flex-col items-center py-12 px-4">
      
      {/* INFINITE BLUR FIX: 
          Using 'absolute inset-0' inside the scrollable container. 
          As the content grows, this element grows with it, ensuring the 
          blur never "ends" or leaves white gaps at the bottom.
      */}
      <div 
        className="absolute inset-0 z-[-1] backdrop-blur-3xl bg-white/20 pointer-events-none" 
        style={{ minHeight: '100%' }}
      />
      
      {/* Click-out listener overlay */}
      <div className="fixed inset-0 z-[-2]" onClick={onClose} />

      <div
        className="bg-white border-[8px] md:border-[12px] border-black rounded-[2.5rem] w-full max-w-2xl shadow-[40px_40px_0px_rgba(0,0,0,0.2)] relative overflow-visible flex-shrink-0"
        style={{ borderColor: borderColor }}
        onClick={e => e.stopPropagation()} 
      >
        <button onClick={onClose} className="absolute -top-6 -right-6 z-50 w-14 h-14 bg-black text-white rounded-full font-black hover:bg-red-500 flex items-center justify-center border-4 border-white shadow-xl transition-all active:scale-90">✕</button>

        <div className="relative h-64 md:h-80 bg-gray-100 border-b-8 border-black rounded-t-[1.8rem] overflow-hidden">
          {(!imgError && event.photos?.length > 0) ? (
            <img src={event.photos[0]} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-9xl opacity-20" style={{ backgroundColor: `${borderColor}22` }}>
              {event.representative_emoji || '🎉'}
            </div>
          )}
        </div>

        <div className="p-8 md:p-12">
          <div className="flex justify-between items-start gap-4 mb-8">
            <div className="flex-1">
              <h2 className="text-3xl md:text-5xl font-black leading-[0.9] mb-4 uppercase italic tracking-tighter">{event.event_name}</h2>
              <p className="text-[10px] md:text-xs text-gray-400 font-black uppercase tracking-widest">Operator: {event.name || 'EDGE_NYC'}</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button onClick={handleFav} className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl border-4 border-black flex items-center justify-center text-3xl md:text-5xl shadow-[8px_8px_0px_black] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all ${fav ? 'bg-yellow-400' : 'bg-white'}`}>
                {fav ? '⭐' : '☆'}
              </button>
              <div className="flex items-center gap-1 bg-black text-white px-3 py-1 rounded-lg font-black text-[12px] mt-1">
                <TrendIcon /> {favCount}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            <div className="bg-gray-50 border-4 border-black rounded-[2rem] p-6 flex items-center gap-4 shadow-[8px_8px_0px_black]">
              <span className="text-5xl">📅</span>
              <div>
                <p className="text-lg md:text-xl font-black leading-tight">{displayDate}</p>
                <p className="text-xs font-bold text-gray-500 mt-1 uppercase tracking-widest">{displayTime} {tzLabel}</p>
              </div>
            </div>
            
            <div className="h-[140px]">
              <MiniMap
                lat={event.location_data?.lat}
                lng={event.location_data?.lng}
                address={event.location_data?.address}
                city={event.location_data?.city}
              />
            </div>
          </div>

          {event.description && (
            <div className="mb-10">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-2 tracking-widest">Protocol Intel</p>
              <div className="text-base md:text-lg font-bold leading-relaxed bg-gray-50 border-4 border-black p-8 rounded-[2rem] shadow-[inset_8px_8px_0px_rgba(0,0,0,0.05)]">
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
            <div className="border-t-[8px] border-black pt-8">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-4 tracking-widest">Digital Nodes</p>
              <div className="grid grid-cols-1 gap-4">
                {event.relevant_links.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-6 bg-gray-50 border-4 border-black rounded-[2rem] hover:bg-black hover:text-white transition-all group shadow-[8px_8px_0px_black] active:translate-x-1 active:translate-y-1 active:shadow-none">
                    <span className="text-xs md:text-sm font-black truncate max-w-[80%] uppercase tracking-tighter">{link.replace(/^https?:\/\/(www\.)?/, '')}</span>
                    <span className="text-3xl group-hover:translate-x-2 transition-transform">→</span>
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