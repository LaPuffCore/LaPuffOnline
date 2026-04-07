import { useState, useEffect } from 'react';
import { generateAutoTags } from '../lib/autoTags';
import { toggleFavorite, isFavorite } from '../lib/favorites';
import { TAG_COLORS } from '../lib/tagColors';
import { getUserTZOffset, utcToLocal, TIMEZONES } from '../lib/timezones';



// Mini map: if we have coordinates use OSM tile, otherwise address link
function MiniMap({ lat, lng, address, city }) {
  const mapsQuery = lat && lng ? `${lat},${lng}` : encodeURIComponent(`${address || ''} ${city || 'New York'} NY`);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  if (lat && lng) {
    const zoom = 15;
    const tileX = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
    const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    return (
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
        className="block relative w-full h-32 rounded-2xl overflow-hidden border-2 border-black cursor-pointer hover:opacity-90 transition-opacity">
        <img src={`https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`} alt="Map"
          className="w-full h-full object-cover" crossOrigin="anonymous" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-3xl" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.9))' }}>📍</div>
        </div>
        <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-2 py-0.5 rounded-lg font-bold">Open Maps ↗</div>
      </a>
    );
  }

  // No coordinates — show address card that links to maps
  if (!address && !city) return null;
  return (
    <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 w-full h-14 rounded-2xl overflow-hidden border-2 border-black bg-gray-100 hover:bg-gray-200 transition-colors px-4 cursor-pointer">
      <span className="text-2xl">📍</span>
      <div>
        <p className="text-sm font-black leading-tight">{address || city}</p>
        <p className="text-xs text-gray-500">Open in Maps ↗</p>
      </div>
    </a>
  );
}

export default function EventDetailPopup({ event, onClose }) {
  const [fav, setFav] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [imgError, setImgError] = useState(false);
  const tags = generateAutoTags(event);
  const tzOffset = getUserTZOffset();
  const tzLabel = (TIMEZONES.find(t => t.offset === tzOffset) || TIMEZONES[0]).label;

  // Check if image is older than 7 days
  const isOlderThan7Days = event.event_date && (() => {
    const ed = new Date(event.event_date + 'T00:00:00');
    return (Date.now() - ed.getTime()) > 7 * 86400000;
  })();

  const showImage = event.photos?.length > 0 && !imgError && !isOlderThan7Days;
  const borderColor = event.hex_color || '#FF6B6B';

  useEffect(() => {
    setFav(isFavorite(event.id));
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [event.id, onClose]);

  function handleFav() {
    const added = toggleFavorite(event.id);
    setFav(added);
    window.dispatchEvent(new Event('favoritesChanged'));
  }

  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, tzOffset) : '';
  const displayDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const hasCoords = event.location_data?.lat && event.location_data?.lng;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border-4 border-black rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[10px_10px_0px_black] relative"
        style={{ borderColor: borderColor, borderTopWidth: 8 }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose}
          className="absolute top-3 right-3 z-10 w-10 h-10 bg-black text-white rounded-full font-black text-lg hover:bg-red-500 transition-colors flex items-center justify-center shadow-[2px_2px_0px_#333]">
          ✕
        </button>

        {/* Photo / fallback */}
        {showImage ? (
          <div className="relative h-56 bg-gray-100">
            <img src={event.photos[photoIdx]} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
            {event.photos.length > 1 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                {event.photos.map((_, i) => (
                  <button key={i} onClick={() => setPhotoIdx(i)}
                    className={`w-2 h-2 rounded-full border border-white ${i === photoIdx ? 'bg-white' : 'bg-white/50'}`} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-7xl" style={{ backgroundColor: borderColor + '22' }}>
            {event.representative_emoji || '🎉'}
          </div>
        )}

        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-3xl">{event.representative_emoji || '🎉'}</span>
              <div>
                <h2 className="text-xl font-black leading-tight">{event.event_name}</h2>
                {event.name && <p className="text-sm text-gray-500">by {event.name}</p>}
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button onClick={handleFav}
                className={`w-10 h-10 rounded-full border-3 border-black flex items-center justify-center text-xl shadow-[2px_2px_0px_black] ${fav ? 'bg-yellow-400' : 'bg-white hover:bg-yellow-100'}`}>
                {fav ? '⭐' : '☆'}
              </button>
              <span className="text-xs font-black px-2 py-0.5 rounded-full bg-black text-white">
                {event.price_category === 'free' ? 'FREE' : event.price_category || '?'}
              </span>
            </div>
          </div>

          <div className="bg-gray-50 border-2 border-black rounded-2xl p-3 mb-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-bold"><span>📅</span><span>{displayDate}</span></div>
            {displayTime && <div className="flex items-center gap-2 text-sm font-bold"><span>🕐</span><span>{displayTime} {tzLabel}</span></div>}
          </div>

          <div className="bg-gray-50 border-2 border-black rounded-2xl p-3 mb-3">
            {event.location_data?.rsvp_link ? (
              <div>
                <p className="text-sm font-black mb-1">🔒 Private / RSVP Event</p>
                <a href={event.location_data.rsvp_link} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 underline text-sm font-medium break-all">{event.location_data.rsvp_link}</a>
              </div>
            ) : (
              <div>
                <p className="text-sm font-black">📍 {event.location_data?.city || 'New York'}</p>
                {event.location_data?.address && <p className="text-xs text-gray-600 mt-1">{event.location_data.address}</p>}
                {event.location_data?.zipcode && <p className="text-xs text-gray-400">ZIP: {event.location_data.zipcode}</p>}
              </div>
            )}
          </div>

          {/* Mini map */}
          {(hasCoords || event.location_data?.address || event.location_data?.city) && !event.location_data?.rsvp_link && (
            <div className="mb-3">
              <MiniMap
                lat={event.location_data?.lat}
                lng={event.location_data?.lng}
                address={event.location_data?.address}
                city={event.location_data?.city}
              />
            </div>
          )}

          {event.description && <p className="text-sm leading-relaxed mb-4 font-medium">{event.description}</p>}

          <div className="flex flex-wrap gap-1 mb-4">
            {tags.map(tag => (
              <span key={tag} className={`text-xs font-bold px-2 py-1 rounded-full border border-black ${TAG_COLORS[tag] || 'bg-gray-200 text-gray-700'}`}>
                {tag}
              </span>
            ))}
          </div>

          {event.relevant_links?.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase mb-2">Links</p>
              <div className="space-y-1">
                {event.relevant_links.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                    className="block text-sm text-blue-600 underline truncate hover:text-blue-800">
                    🔗 {link}
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