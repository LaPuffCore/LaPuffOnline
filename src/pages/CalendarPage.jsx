import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EventDetailPopup from '../components/EventDetailPopup';
import { getFavorites } from '../lib/favorites';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';
import { generateAutoTags } from '../lib/autoTags';
import { TAG_COLORS } from '../lib/tagColors';

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year, month) { return new Date(year, month, 1).getDay(); }

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
      className="group block relative w-full h-full rounded-2xl overflow-hidden border-[2.5px] border-black bg-[#e5e3df] shadow-[4px_4px_0px_black] transition-all duration-300 hover:scale-[1.01]"
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = borderColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'black';
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
      />
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t-2 border-black p-1.5 flex items-center justify-between z-20 transition-colors duration-300">
        <p className="text-[9px] font-black truncate uppercase tracking-tighter">{address || city || 'NYC GRID'}</p>
        <span className="bg-black text-white px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest">MAP ↗</span>
      </div>
    </a>
  );
}

function DayEventDetails({ event }) {
  const borderColor = event.hex_color || '#7C3AED';
  const tags = generateAutoTags(event);
  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, getUserTZOffset()) : '';
  const displayDate = event.event_date
    ? new Date(`${event.event_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'Date TBD';

  return (
    <div className="mt-2 border-2 border-t-0 border-black rounded-b-2xl bg-gray-50 p-3 md:p-4 shadow-[inset_0_1px_0_rgba(0,0,0,0.05)]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4">
        <div className="bg-white border-2 border-black rounded-xl p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Time + Date</p>
          <p className="text-sm font-black">📅 {displayDate}</p>
          {displayTime && <p className="text-sm font-black mt-1">🕐 {displayTime}</p>}
          <p className="text-xs font-bold text-gray-600 mt-2">
            {event.location_data?.rsvp_link ? '🔒 RSVP REQUIRED' : `📍 ${event.location_data?.city || 'NYC'}`}
          </p>
        </div>

        <div className="h-[120px] md:h-[130px]">
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
        <div className="mb-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">Description</p>
          <div className="bg-white border-2 border-black rounded-xl p-3 text-xs md:text-sm font-bold leading-relaxed">
            {event.description}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 md:gap-2 mb-4">
        {tags.map((tag) => (
          <span key={tag} className={`text-[9px] font-black px-2 py-1 rounded-lg border-2 border-black ${TAG_COLORS[tag] || 'bg-white'} uppercase`}>
            #{tag}
          </span>
        ))}
      </div>

      {event.relevant_links?.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Links</p>
          {event.relevant_links.map((link, i) => (
            <a
              key={i}
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-white border-2 border-black rounded-xl px-3 py-2.5 text-[11px] md:text-xs font-black truncate hover:bg-black hover:text-white transition-colors"
            >
              {link.replace(/^https?:\/\/(www\.)?/, '')}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CalendarPage({ events = [] }) {
  const today = new Date();
  const location = useLocation();
  const [view, setView] = useState('monthly');
  const [curDate, setCurDate] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [favorites, setFavorites] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [expandedEvents, setExpandedEvents] = useState({});
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (location.state?.initialDate) {
      const parts = location.state.initialDate.split('-');
      const targetDate = new Date(parts[0], parts[1] - 1, parts[2]);
      setCurDate(targetDate);
    }
    if (location.state?.initialView) {
      setView(location.state.initialView);
    }
  }, [location.state]);

  useEffect(() => {
    setFavorites(getFavorites());
    const handler = () => setFavorites(getFavorites());
    window.addEventListener('favoritesChanged', handler);
    return () => window.removeEventListener('favoritesChanged', handler);
  }, []);

  const favEvents = useMemo(() => events.filter((e) => favorites.includes(String(e.id))), [events, favorites]);

  function eventsForDate(date) {
    const key = date.toISOString().split('T')[0];
    return favEvents.filter((e) => e.event_date === key);
  }

  function nav(dir) {
    const d = new Date(curDate);
    if (view === 'monthly') d.setMonth(d.getMonth() + dir);
    else if (view === 'weekly') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurDate(d);
    setExpandedEvents({});
  }

  function drillToWeek(date) {
    setCurDate(date);
    setView('weekly');
    setExpandedEvents({});
  }

  function drillToDay(date) {
    setCurDate(date);
    setView('daily');
    setExpandedEvents({});
  }

  const year = curDate.getFullYear();
  const month = curDate.getMonth();

  function MonthGrid() {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDay(year, month);
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

    return (
      <div className="grid grid-cols-7 gap-1 md:gap-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center text-[10px] md:text-xs font-black text-gray-400 py-2">{d}</div>
        ))}

        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />;
          const evs = eventsForDate(date);
          const isToday = date.toDateString() === today.toDateString();
          const showEvents = evs.slice(0, 3);
          const hasMore = evs.length > 3;

          return (
            <div
              key={date.toDateString()}
              onClick={() => drillToWeek(date)}
              className={`rounded-2xl p-1.5 md:p-2 border-2 cursor-pointer transition-all hover:border-[#7C3AED] hover:shadow-md min-h-20 md:min-h-[12rem]
              ${isToday ? 'border-[#7C3AED] bg-violet-50' : 'border-gray-200'}
              ${evs.length > 0 ? 'ring-1 ring-[#7C3AED]/20' : ''}`}
            >
              <p className={`text-xs font-black mb-1 ${isToday ? 'text-[#7C3AED]' : 'text-gray-700'}`}>{date.getDate()}</p>

              <div className="space-y-1 md:space-y-1.5 md:min-h-[9rem]">
                {showEvents.map((e) => (
                  <button
                    key={e.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedEvent(e);
                    }}
                    className="w-full text-left text-[9px] md:text-[10px] rounded-lg px-1.5 py-1 font-bold cursor-pointer hover:opacity-85 leading-tight line-clamp-2"
                    style={{ backgroundColor: `${e.hex_color || '#7C3AED'}33`, color: e.hex_color || '#7C3AED' }}
                  >
                    <span className="mr-1">{e.representative_emoji || '🎉'}</span>
                    {e.event_name}
                  </button>
                ))}

                {hasMore && (
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      drillToDay(date);
                    }}
                    className="w-full text-center text-[9px] md:text-[10px] font-black text-[#7C3AED] bg-violet-100/70 border border-[#7C3AED]/25 rounded-md py-0.5 hover:bg-violet-200/80"
                  >
                    [...]
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function WeekList() {
    const weekStart = new Date(curDate);
    weekStart.setDate(curDate.getDate() - curDate.getDay());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });

    const limit = isMobile ? 2 : 3;

    return (
      <div className="space-y-3 md:space-y-4">
        {days.map((date) => {
          const evs = eventsForDate(date);
          const visible = evs.slice(0, limit);
          const hasMore = evs.length > limit;
          const isToday = date.toDateString() === today.toDateString();

          return (
            <div key={date.toDateString()} className="border-2 border-black rounded-2xl bg-white shadow-[3px_3px_0px_black] overflow-hidden">
              <button
                onClick={() => drillToDay(date)}
                className={`w-full text-left px-3 md:px-4 py-2 border-b-2 border-black font-black text-xs md:text-sm flex items-center justify-between ${isToday ? 'bg-violet-200 text-[#4c1d95]' : 'bg-gray-100 text-gray-700'}`}
              >
                <span>
                  {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </span>
                <span className="text-[10px] md:text-xs">{evs.length} event{evs.length === 1 ? '' : 's'}</span>
              </button>

              {evs.length === 0 ? (
                <div className="px-3 md:px-4 py-3 text-[11px] md:text-xs text-gray-400 font-bold">No favorites this day</div>
              ) : (
                <div className="px-2.5 md:px-3 py-2.5 flex gap-2 md:gap-3 overflow-x-auto">
                  {visible.map((e) => {
                    const tags = generateAutoTags(e).slice(0, 2);
                    const time = e.event_time_utc ? utcToLocal(e.event_time_utc, getUserTZOffset()) : '';
                    const loc = e.location_data?.city || 'NYC';
                    return (
                      <button
                        key={e.id}
                        onClick={() => setSelectedEvent(e)}
                        className="min-w-[190px] md:min-w-[235px] max-w-[190px] md:max-w-[235px] text-left rounded-xl border-2 border-black bg-gray-50 p-2.5 md:p-3 shadow-[2px_2px_0px_black] hover:bg-violet-50 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-2xl md:text-3xl leading-none">{e.representative_emoji || '🎉'}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] md:text-xs font-black leading-tight line-clamp-2">{e.event_name}</p>
                            {time && <p className="text-[10px] md:text-[11px] font-bold text-gray-600 mt-1">🕐 {time}</p>}
                            <p className="text-[10px] md:text-[11px] font-bold text-gray-600 truncate">📍 {loc}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {tags.map((tag) => (
                            <span key={tag} className={`text-[8px] font-black px-1.5 py-0.5 rounded-md border border-black ${TAG_COLORS[tag] || 'bg-white'} uppercase`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}

                  {hasMore && (
                    <button
                      onClick={() => drillToDay(date)}
                      className="min-w-[60px] md:min-w-[72px] rounded-xl border-2 border-[#7C3AED] bg-violet-100 text-[#7C3AED] font-black text-lg md:text-xl flex items-center justify-center hover:bg-violet-200"
                      aria-label="Open day with more events"
                    >
                      [...]
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function DayView() {
    const evs = eventsForDate(curDate);
    return (
      <div className="space-y-3">
        {evs.length === 0 ? (
          <div className="text-center py-10 text-gray-400 font-medium">No favorites on this day</div>
        ) : (
          evs.map((e) => {
            const expanded = !!expandedEvents[e.id];
            const displayTime = e.event_time_utc ? utcToLocal(e.event_time_utc, getUserTZOffset()) : '';
            const displayDate = e.event_date
              ? new Date(`${e.event_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              : '';
            return (
              <div
                key={e.id}
                className="bg-white border-3 border-black rounded-3xl overflow-hidden transition-transform shadow-[4px_4px_0px_black]"
                style={{ borderLeftColor: e.hex_color || '#7C3AED', borderLeftWidth: 6 }}
              >
                <div className="p-4 flex items-center gap-3 md:gap-4">
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl overflow-hidden flex-shrink-0" style={{ backgroundColor: `${e.hex_color || '#7C3AED'}22` }}>
                    {e.photos?.[0]
                      ? <img src={e.photos[0]} className="w-full h-full object-cover" alt="" onError={(ev) => { ev.currentTarget.style.display = 'none'; }} />
                      : <div className="w-full h-full flex items-center justify-center text-3xl">{e.representative_emoji || '🎉'}</div>}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="font-black text-sm md:text-base leading-tight line-clamp-2">{e.event_name}</h3>
                    <p className="text-[11px] md:text-sm text-gray-500 font-bold">
                      {displayDate}{displayTime ? ` · ${displayTime}` : ''}
                    </p>
                  </div>

                  <button
                    onClick={() => setExpandedEvents((prev) => ({ ...prev, [e.id]: !prev[e.id] }))}
                    className="w-9 h-9 border-2 border-black rounded-xl bg-gray-100 hover:bg-violet-100 flex items-center justify-center text-base font-black shadow-[2px_2px_0px_black]"
                    aria-label="Toggle details"
                  >
                    {expanded ? '⌃' : '⌄'}
                  </button>
                </div>

                {expanded && <DayEventDetails event={e} />}
              </div>
            );
          })
        )}
      </div>
    );
  }

  const headLabel = view === 'monthly'
    ? new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : view === 'weekly'
      ? (() => {
          const ws = new Date(curDate);
          ws.setDate(curDate.getDate() - curDate.getDay());
          const we = new Date(ws);
          we.setDate(ws.getDate() + 6);
          return `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        })()
      : curDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="max-w-7xl mx-auto px-3 md:px-4 py-5 md:py-6">
        <div className="flex items-start md:items-center justify-between mb-3 md:mb-4 gap-3 md:gap-4">
          <Link to="/" className="flex flex-col items-center gap-1 text-black hover:text-[#7C3AED] transition-colors">
            <div className="w-10 h-10 md:w-11 md:h-11 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg shadow-[3px_3px_0px_#333]">←</div>
            <span className="text-[10px] md:text-xs font-black uppercase tracking-wide">Home</span>
          </Link>

          <div className="flex-1 border-3 border-black bg-white rounded-2xl px-4 md:px-5 py-3 md:py-3.5 shadow-[4px_4px_0px_black] text-center mx-1 md:mx-3">
            <h1 className="font-black text-lg md:text-2xl leading-none">📅 Favorites Calendar</h1>
            <p className="text-gray-500 text-xs md:text-sm mt-1 font-bold">{favEvents.length} favorited events</p>
          </div>

          <Link to="/favorites" className="flex flex-col items-center gap-1 text-black hover:text-[#7C3AED] transition-colors">
            <div className="w-10 h-10 md:w-11 md:h-11 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg shadow-[3px_3px_0px_#333]">→</div>
            <span className="text-[10px] md:text-xs font-black uppercase tracking-wide">My Favorites</span>
          </Link>
        </div>

        <div className="flex justify-center mb-4">
          <div className="bg-gray-100 border-3 border-black rounded-2xl p-1 flex shadow-[3px_3px_0px_black]">
            {['monthly', 'weekly', 'daily'].map((v) => (
              <button
                key={v}
                onClick={() => { setView(v); setExpandedEvents({}); }}
                className={`px-3 md:px-4 py-1.5 md:py-2 rounded-xl text-xs md:text-sm font-black capitalize transition-all ${view === v ? 'bg-[#7C3AED] text-white' : 'hover:bg-gray-200'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => nav(-1)} className="w-9 h-9 bg-white border-3 border-black rounded-xl font-black hover:bg-[#7C3AED] hover:text-white transition-colors shadow-[2px_2px_0px_black]">←</button>
          <span className="font-black text-xs md:text-sm flex-1 text-center">{headLabel}</span>
          <button onClick={() => nav(1)} className="w-9 h-9 bg-white border-3 border-black rounded-xl font-black hover:bg-[#7C3AED] hover:text-white transition-colors shadow-[2px_2px_0px_black]">→</button>
        </div>

        <div className="bg-white border-3 border-black rounded-3xl shadow-[5px_5px_0px_black] p-3 md:p-4">
          {view === 'monthly' && <MonthGrid />}
          {view === 'weekly' && <WeekList />}
          {view === 'daily' && <DayView />}
        </div>

        {view === 'monthly' && <p className="text-xs text-gray-400 text-center mt-3 font-medium">Tap/click a day to drill into week view.</p>}
        {view === 'weekly' && <p className="text-xs text-gray-400 text-center mt-3 font-medium">Use [...] to jump to that day.</p>}
      </div>

      {selectedEvent && <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
