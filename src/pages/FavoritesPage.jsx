import { useState, useEffect } from 'react';
import { getFavorites, toggleFavorite, isFavorite } from '../lib/favorites';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';
import EventDetailPopup from '../components/EventDetailPopup';
import { Link } from 'react-router-dom';

export default function FavoritesPage({ events = [] }) {
  const [favorites, setFavorites] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const tzOffset = getUserTZOffset();

  useEffect(() => {
    setFavorites(getFavorites());
    const handler = () => setFavorites(getFavorites());
    window.addEventListener('favoritesChanged', handler);
    return () => window.removeEventListener('favoritesChanged', handler);
  }, []);

  const favEvents = events.filter(e => favorites.includes(e.id));

  function handleUnfav(e, eventId) {
    e.stopPropagation();
    toggleFavorite(eventId);
    setFavorites(getFavorites());
    window.dispatchEvent(new Event('favoritesChanged'));
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="w-10 h-10 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg hover:bg-[#7C3AED] transition-colors shadow-[3px_3px_0px_#333]">
            ←
          </Link>
          <div>
            <h1 className="font-black text-2xl">⭐ My Favorites</h1>
            <p className="text-gray-500 text-sm">{favEvents.length} saved events</p>
          </div>
        </div>

        {favEvents.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-7xl mb-4">⭐</div>
            <p className="text-2xl font-black">No favorites yet!</p>
            <p className="text-gray-500 mt-2">Star events in the Tiles view to save them here</p>
            <Link to="/" className="mt-6 inline-block bg-[#7C3AED] text-white font-black px-8 py-3 rounded-2xl hover:bg-[#6D28D9] transition-colors shadow-[4px_4px_0px_#333]">
              Browse Events
            </Link>
          </div>
        ) : (
          <div className="flex gap-5 overflow-x-auto pb-4" style={{ scrollSnapType: 'x mandatory' }}>
            {favEvents.map(event => {
              const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, tzOffset) : '';
              const displayDate = event.event_date
                ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : '';
              return (
                <div
                  key={event.id}
                  onClick={() => setSelectedEvent(event)}
                  className="flex-shrink-0 w-72 bg-white border-3 border-black rounded-3xl overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform shadow-[5px_5px_0px_black]"
                  style={{ borderTopColor: event.hex_color || '#7C3AED', borderTopWidth: 6, scrollSnapAlign: 'start' }}
                >
                  <div className="h-44 relative overflow-hidden bg-gray-100">
                    {event.photos?.[0] ? (
                      <img src={event.photos[0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-6xl"
                        style={{ backgroundColor: (event.hex_color || '#7C3AED') + '22' }}>
                        {event.representative_emoji || '🎉'}
                      </div>
                    )}
                    <button
                      onClick={e => handleUnfav(e, event.id)}
                      className="absolute top-2 right-2 w-9 h-9 bg-yellow-400 border-3 border-black rounded-full flex items-center justify-center text-lg shadow-[2px_2px_0px_black] hover:bg-red-200 transition-colors"
                    >⭐</button>
                    <div className="absolute bottom-2 left-2 bg-black text-white text-xs font-black px-2 py-1 rounded-lg">
                      {event.price_category === 'free' ? 'FREE' : event.price_category || '?'}
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-black text-sm leading-tight mb-2 line-clamp-2">{event.event_name}</h3>
                    <p className="text-xs text-gray-500 font-medium">📅 {displayDate}</p>
                    {displayTime && <p className="text-xs text-gray-500 font-medium">🕐 {displayTime}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      {event.location_data?.rsvp_link ? '🔒 RSVP Event' : `📍 ${event.location_data?.city || 'NYC'}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {selectedEvent && <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}