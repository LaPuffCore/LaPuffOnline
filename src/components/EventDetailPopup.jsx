import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite, getFavoriteCount, getFavTrend } from '../lib/favorites';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal, TIMEZONES } from '../lib/timezones';

function MiniMap({ lat, lng, address, city }) {
  const mapsQuery = lat && lng ? `${lat},${lng}` : encodeURIComponent(`${address || ''} ${city || 'New York'} NY`);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  // Convert lat/lng to OSM tile x/y at zoom 15
  const zoom = 15;
  let tileUrl = null;
  let pinLeft = '50%';
  let pinTop = '50%';

  if (lat && lng) {
    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    const xTile = Math.floor(((lng + 180) / 360) * n);
    const yTile = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);

    // Use a 3x3 grid of tiles centered on the location tile for a wider view
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        tiles.push({ x: xTile + dx, y: yTile + dy, dx, dy });
      }
    }

    // Fractional position of pin within center tile
    const xFrac = ((lng + 180) / 360) * n - xTile;
    const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - yTile;
    pinLeft = `${((1 + xFrac) / 3) * 100}%`;
    pinTop = `${((1 + yFrac) / 3) * 100}%`;

    tileUrl = { xTile, yTile, zoom, tiles };
  }

  return (
    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="group block relative w-full h-full rounded-2xl overflow-hidden border-2 border-black cursor-pointer hover:border-blue-500 transition-all shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
      <div className="h-24 md:h-full min-h-[100px] bg-gray-200 relative overflow-hidden">
        {tileUrl ? (
          <>
            {/* 3x3 tile grid */}
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(3, 33.333%)', gridTemplateRows: 'repeat(3, 33.333%)' }}>
              {tileUrl.tiles.map(({ x, y, dx, dy }) => (
                <img
                  key={`${dx},${dy}`}
                  src={`https://tile.openstreetmap.org/${tileUrl.zoom}/${x}/${y}.png`}
                  alt=""
                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                  crossOrigin="anonymous"
                />
              ))}
            </div>
            {/* Pin centered on exact location */}
            <div
              className="absolute pointer-events-none z-10 -translate-x-1/2 -translate-y-full"
              style={{ left: pinLeft, top: pinTop }}
            >
              <span className="text-2xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">📍</span>
            </div>
            {/* Subtle vignette overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20 pointer-events-none z-10" />
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 gap-1">
            <span className="text-3xl">📍</span>
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-center px-2">
              {address || city || 'View on Maps'}
            </span>
          </div>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t-2 border-black p-2 flex items-center justify-between gap-2">
        <div className="truncate">
          <p className="text-[8px] font-black uppercase text-gray-400 leading-none mb-0.5">Location</p>
          <p className="text-[10px] md:text-xs font-black truncate">{address || city || 'New York'}</p>
        </div>
        <div className="flex-shrink-0 bg-black text-white px-2 py-1 rounded-lg text-[9px] font-black group-hover:bg-blue-600 transition-colors">
          MAPS ↗
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>

      {onPrev && (
        <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="fixed left-4 top-1/2 -translate-y-1/2 z-[60] w-12 h-20 bg-white/10 hover:bg-white/20 text-white hidden md:flex items-center justify-center rounded-2xl transition-all group">
          <span className="text-4xl font-light group-hover:-translate-x-1 transition-transform">＜</span>
        </button>
      )}

      {onNext && (
        <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="fixed right-4 top-1/2 -translate-y-1/2 z-[60] w-12 h-20 bg-white/10 hover:bg-white/20 text-white hidden md:flex items-center justify-center rounded-2xl transition-all group">
          <span className="text-4xl font-light group-hover:translate-x-1 transition-transform">＞</span>
        </button>
      )}

      <div
        className="bg-white border-[6px] md:border-[12px] border-black rounded-[2.5rem] w-full max-w-lg md:max-w-2xl my-8 shadow-[20px_20px_0px_rgba(0,0,0,0.3)] relative overflow-hidden"
        style={{ borderColor: borderColor }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-20 w-10 h-10 bg-black text-white rounded-full font-black hover:bg-red-500 flex items-center justify-center shadow-[4px_4px_0px_#333] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">✕</button>

        <div className="relative h-64 md:h-80 bg-gray-100 border-b-4 border-black">
          {showImage ? (
            <div className="w-full h-full overflow-hidden">
              <img src={event.photos[photoIdx]} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
              {event.photos.length > 1 && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                  {event.photos.map((_, i) => (
                    <button key={i} onClick={() => setPhotoIdx(i)}
                      className={`w-2.5 h-2.5 rounded-full border-2 border-black transition-all ${i === photoIdx ? 'bg-white w-5' : 'bg-white/40'}`} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-9xl select-none" style={{ backgroundColor: `${borderColor}22` }}>
              {event.representative_emoji || '🎉'}
            </div>
          )}
        </div>

        <div className="p-6 md:p-10">
          <div className="flex flex-col gap-4 mb-8">
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <h2 className="text-2xl md:text-4xl font-black leading-tight mb-1 line-clamp-2 uppercase italic">{event.event_name}</h2>
                <div className="flex items-center gap-2 md:gap-3">
                  <span className="md:hidden text-lg">{event.representative_emoji || '🎉'}</span>
                  {event.name && (
                    <p className="text-[10px] md:text-xs text-gray-400 font-black uppercase tracking-tighter">
                      Hosted by {event.name}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-center gap-1">
                <button onClick={handleFav} className={`w-12 h-12 md:w-16 md:h-16 rounded-2xl border-4 border-black flex items-center justify-center text-2xl md:text-4xl shadow-[4px_4px_0px_black] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${fav ? 'bg-yellow-400' : 'bg-white'}`}>
                  {fav ? '⭐' : '☆'}
                </button>
                <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-lg font-black text-[10px]">
                  <TrendIcon /> {favCount}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="bg-gray-50 border-2 border-black rounded-2xl p-4 flex items-center gap-4 shadow-[4px_4px_0px_black] min-h-[100px] md:min-h-[120px]">
              <span className="text-3xl md:text-4xl">📅</span>
              <div>
                <p className="text-sm md:text-base font-black leading-tight">{displayDate}</p>
                {displayTime && <p className="text-xs font-bold text-gray-500 mt-1 uppercase tracking-tight">{displayTime} {tzLabel}</p>}
              </div>
            </div>

            <div className="h-[100px] md:h-[120px]">
              {!event.location_data?.rsvp_link ? (
                <MiniMap
                  lat={event.location_data?.lat}
                  lng={event.location_data?.lng}
                  address={event.location_data?.address}
                  city={event.location_data?.city}
                />
              ) : (
                <div className="bg-blue-50 border-2 border-black rounded-2xl p-4 shadow-[4px_4px_0px_black] h-full flex flex-col justify-center">
                  <p className="text-[10px] font-black mb-1 opacity-50 uppercase">Access</p>
                  <a href={event.location_data.rsvp_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-xs font-black break-all uppercase">RSVP Required ↗</a>
                </div>
              )}
            </div>
          </div>

          {event.description && (
            <div className="mb-8">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-2 tracking-widest">About this event</p>
              <div className="text-sm md:text-base font-bold leading-relaxed bg-gray-50 border-2 border-black p-5 rounded-2xl shadow-[inset_4px_4px_0px_rgba(0,0,0,0.05)]">
                {event.description}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-10">
            {tags.map(tag => (
              <span key={tag} className={`text-[10px] font-black px-3 py-2 rounded-xl border-2 border-black shadow-[3px_3px_0px_black] ${TAG_COLORS[tag] || 'bg-white'} uppercase tracking-tighter`}>
                #{tag}
              </span>
            ))}
          </div>

          {event.relevant_links?.length > 0 && (
            <div className="border-t-[4px] border-black pt-8">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-4 tracking-widest">Connect</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {event.relevant_links.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-gray-50 border-2 border-black rounded-2xl hover:bg-black hover:text-white transition-all group shadow-[4px_4px_0px_black] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
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
  );
}