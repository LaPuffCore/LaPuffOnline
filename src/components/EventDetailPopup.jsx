import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend } from '../lib/favorites';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';

// RESTORED: Working Iframe Map Preview
function MiniMap({ lat, lng, address, city, borderColor }) {
  const [isHovered, setIsHovered] = useState(false);
  
  const mapUrl = (lat && lng)
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.005},${lng + 0.005},${lat + 0.005}&layer=mapnik&marker=${lat},${lng}`
    : `https://www.openstreetmap.org/export/embed.html?bbox=-74.01,40.70,-73.95,40.80&layer=mapnik`;

  const outUrl = (lat && lng)
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(address || city || 'New York')}`;

  return (
    <a 
      href={outUrl} 
      target="_blank" 
      rel="noopener noreferrer" 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group block relative w-full h-full rounded-2xl overflow-hidden border-2 border-black bg-[#e5e3df] shadow-[4px_4px_0px_black] transition-all duration-300 hover:scale-[1.02]"
      style={{ borderColor: isHovered ? borderColor : 'black' }}
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
      <div 
        className="absolute bottom-0 left-0 right-0 border-t-2 border-black p-1.5 flex items-center justify-between z-20 transition-colors duration-300"
        style={{ 
          backgroundColor: isHovered ? borderColor : 'white',
          borderColor: isHovered ? 'black' : 'black'
        }}
      >
        <p className={`text-[9px] font-black truncate uppercase tracking-tighter ${isHovered ? 'text-white' : 'text-black'}`}>
          {address || city || 'NYC GRID'}
        </p>
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
  const [isDateHovered, setIsDateHovered] = useState(false);
  
  const tags = generateAutoTags(event);
  const borderColor = event.hex_color || '#FF6B6B';

  useEffect(() => {
    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const syncFavorites = () => {
      setFav(isFavorite(event.id));
      setFavCount(getFavoriteCount(event.id));
      setTrend(getFavTrend(event.id));
    };
    
    syncFavorites();
    window.addEventListener('favoritesChanged', syncFavorites);
    
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
    };
    window.addEventListener('keydown', handleKey);
    
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('favoritesChanged', syncFavorites);
      window.removeEventListener('keydown', handleKey);
    };
  }, [event.id, onClose, onNext, onPrev]);

  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, getUserTZOffset()) : '';
  const displayDate = event.event_date 
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) 
    : '';

  return (
    // items-start + pt-10 ensures the card spawns at the top of the CURRENT viewport scroll
    <div className="fixed inset-0 z-[100000] flex items-start justify-center p-4 pt-10 overflow-y-auto custom-scrollbar bg-white/20 backdrop-blur-md">
      
      {/* Clickable Backdrop */}
      <div className="fixed inset-0 z-[-1]" onClick={onClose} />
      
      <div className="relative w-full max-w-xl flex items-center justify-center">
        
        {/* ARROWS: Positioned relative to the card container */}
        <div className="absolute inset-y-0 -left-16 lg:-left-24 flex items-center">
          <button 
            onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
            className={`w-12 h-12 lg:w-14 lg:h-14 flex items-center justify-center bg-white border-4 border-black rounded-full text-2xl shadow-[4px_4px_0px_black] hover:bg-black hover:text-white transition-all active:translate-y-0.5 active:shadow-none ${!onPrev ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          >
            ←
          </button>
        </div>

        <div className="absolute inset-y-0 -right-16 lg:-right-24 flex items-center">
          <button 
            onClick={(e) => { e.stopPropagation(); onNext?.(); }}
            className={`w-12 h-12 lg:w-14 lg:h-14 flex items-center justify-center bg-white border-4 border-black rounded-full text-2xl shadow-[4px_4px_0px_black] hover:bg-black hover:text-white transition-all active:translate-y-0.5 active:shadow-none ${!onNext ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          >
            →
          </button>
        </div>

        {/* MAIN CARD */}
        <div
          className="bg-white border-[6px] border-black rounded-[2rem] w-full shadow-[20px_20px_0px_rgba(0,0,0,0.2)] relative z-10 overflow-hidden flex flex-col mb-20"
          style={{ borderColor: borderColor }}
          onClick={e => e.stopPropagation()} 
        >
          {/* Close Button */}
          <button onClick={onClose} className="absolute top-4 right-4 z-50 w-10 h-10 bg-black text-white rounded-full font-black flex items-center justify-center border-2 border-white hover:bg-red-500 transition-colors">✕</button>

          {/* Image/Hero Section */}
          <div className="relative h-60 flex-shrink-0 bg-gray-100 border-b-4 border-black overflow-hidden">
            {(!imgError && event.photos?.length > 0) ? (
              <img 
                src={event.photos[0]} 
                alt="" 
                className="w-full h-full object-cover scale-[1.015]"
                onError={() => setImgError(true)} 
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-8xl opacity-20" style={{ backgroundColor: borderColor }}>
                {event.representative_emoji || '⚡'}
              </div>
            )}
          </div>

          <div className="p-6">
            <div className="flex justify-between items-start gap-4 mb-6">
              <div className="flex-1">
                <h2 className="text-3xl font-black leading-[0.95] mb-2 uppercase italic tracking-tighter">{event.event_name}</h2>
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{event.name || 'SYSTEM_OPERATOR'}</p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <button 
                  onClick={() => toggleFavorite(event.id) && setFav(!fav)} 
                  className={`w-14 h-14 rounded-xl border-4 border-black flex items-center justify-center text-3xl shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all ${fav ? 'bg-yellow-400' : 'bg-white'}`}
                >
                  {fav ? '⭐' : '☆'}
                </button>
                <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-md font-black text-[10px]">
                  {trend === 'up' ? <span className="text-green-400">▲</span> : trend === 'down' ? <span className="text-red-400">▼</span> : <span className="text-gray-400">—</span>} 
                  {favCount}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {/* Date/Time Link Block with Hover Color Fix */}
              <button
                onMouseEnter={() => setIsDateHovered(true)}
                onMouseLeave={() => setIsDateHovered(false)}
                onClick={() => navigate('/calendar', { state: { initialDate: event.event_date, initialView: 'weekly' } })}
                className="flex items-center gap-3 p-4 bg-gray-50 border-2 border-black rounded-xl shadow-[4px_4px_0px_black] transition-all hover:-translate-y-0.5 active:translate-y-0 active:shadow-none text-left overflow-hidden relative"
              >
                <div 
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-colors duration-200"
                  style={{ backgroundColor: isDateHovered ? borderColor : 'transparent', opacity: isDateHovered ? 1 : 0 }}
                />
                <span className={`text-3xl relative z-10 transition-transform duration-200 ${isDateHovered ? 'scale-110' : ''}`}>📅</span>
                <div className="relative z-10">
                  <p className={`text-sm font-black leading-tight transition-colors duration-200 ${isDateHovered ? 'text-white underline decoration-white' : 'text-black'}`}>{displayDate}</p>
                  <p className={`text-[10px] font-bold uppercase transition-colors duration-200 ${isDateHovered ? 'text-white/80' : 'text-gray-400'}`}>{displayTime}</p>
                </div>
              </button>
              
              <div className="h-[110px]">
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
    </div>
  );
}