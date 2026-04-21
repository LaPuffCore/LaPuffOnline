import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EventDetailPopup from '../components/EventDetailPopup';
import { getFavorites, mergeFavoriteEventsWithCache, hydrateFavoriteEventCache } from '../lib/favorites';
import { getUserTZOffset, utcToLocal } from '../lib/timezones';
import { generateAutoTags } from '../lib/autoTags';
import { TAG_COLORS } from '../lib/tagColors';
import { getTileAccentColor, useSiteTheme } from '../lib/theme';

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year, month) { return new Date(year, month, 1).getDay(); }
function getMonthShort(date) { return date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(); }

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
  const { resolvedTheme } = useSiteTheme();
  // Inherit tileAccentOverride + theme exactly like EventTile/EventDetailPopup
  const borderColor = getTileAccentColor(event.hex_color, resolvedTheme);
  const tags = generateAutoTags(event);
  const displayTime = event.event_time_utc ? utcToLocal(event.event_time_utc, getUserTZOffset()) : '';
  const displayDate = event.event_date
    ? new Date(`${event.event_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'Date TBD';

  return (
    <div className="border-[2.5px] border-t-0 border-black rounded-b-[1.6rem] bg-gray-50 px-3 pb-3 pt-6 md:px-4 md:pb-4 md:pt-7 shadow-[inset_0_1px_0_rgba(0,0,0,0.05)]">
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
  const { resolvedTheme } = useSiteTheme();

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

  useEffect(() => {
    hydrateFavoriteEventCache(events);
  }, [events]);

  const favEvents = useMemo(() => {
    const merged = mergeFavoriteEventsWithCache(events);
    const favSet = new Set(favorites.map(String));
    return merged.filter((e) => favSet.has(String(e.id)));
  }, [events, favorites]);

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
    while (cells.length < 42) cells.push(null);

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="hidden md:grid grid-cols-7 gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="text-center text-xs font-black text-gray-400 py-1.5">{d}</div>
          ))}
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-7 grid-rows-6 gap-1 md:gap-2">
          {cells.map((date, i) => {
            if (!date) {
              return <div key={`empty-${i}`} className="rounded-2xl border border-transparent" />;
            }
            const evs = eventsForDate(date);
            const isToday = date.toDateString() === today.toDateString();
            const showEvents = evs.slice(0, isMobile ? 3 : 3);
            const hasMore = evs.length > 3;

            return (
              <div
                key={date.toDateString()}
                onClick={() => drillToWeek(date)}
                className={`rounded-2xl border-2 cursor-pointer transition-all min-h-0 overflow-hidden p-1 md:p-2 hover:border-[#7C3AED] hover:shadow-md ${isToday ? 'border-[#7C3AED] bg-violet-50' : 'border-gray-200 bg-white'} ${evs.length > 0 ? 'ring-1 ring-[#7C3AED]/20' : ''}`}
                style={{ minHeight: isMobile ? '62px' : undefined }}
              >
                <div className="flex h-full min-h-0 flex-col">
                  <div className="mb-1 flex items-start justify-between">
                    <div className="flex flex-col">
                      {isMobile && (
                        <span className={`text-[8px] font-black leading-none ${isToday ? 'text-[#7C3AED]' : 'text-gray-400'}`}>
                          {getMonthShort(date)}
                        </span>
                      )}
                      <p className={`${isMobile ? 'text-sm' : 'text-xs'} font-black leading-none ${isToday ? 'text-[#7C3AED]' : 'text-gray-700'}`}>{date.getDate()}</p>
                    </div>
                  </div>

                  <div className={`flex-1 min-h-0 ${isMobile ? 'space-y-1' : 'space-y-1.5 md:min-h-0'}`}>
                    {showEvents.map((e) => {
                      const tileColor = getTileAccentColor(e.hex_color, resolvedTheme);
                      return (
                      <button
                        key={e.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (isMobile) { drillToWeek(date); } else { setSelectedEvent(e); }
                        }}
                        className={isMobile ? 'flex h-5 w-full items-center rounded-lg px-1' : 'w-full text-left text-[9px] md:text-[10px] rounded-lg px-1.5 py-1 font-bold cursor-pointer hover:opacity-85 leading-tight line-clamp-2'}
                        style={{ backgroundColor: `${tileColor}33`, color: tileColor }}
                      >
                        {isMobile ? (
                          <>
                            <span className="text-[10px] leading-none">{e.representative_emoji || '🎉'}</span>
                            <span className="ml-auto h-2 w-2 rounded-full border border-black/10 flex-shrink-0" style={{ backgroundColor: tileColor }} />
                          </>
                        ) : (
                          <>
                            <span className="mr-1">{e.representative_emoji || '🎉'}</span>
                            {e.event_name}
                          </>
                        )}
                      </button>
                      );
                    })}

                    {hasMore && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          drillToDay(date);
                        }}
                        className={`w-full text-center font-black text-[#7C3AED] bg-violet-100/70 border border-[#7C3AED]/25 rounded-md hover:bg-violet-200/80 ${isMobile ? 'py-0.5 text-[9px]' : 'py-0.5 text-[9px] md:text-[10px]'}`}
                      >
                        {isMobile ? `+${evs.length - 3}` : '[...]'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
      <div className="space-y-3 md:space-y-4 h-full overflow-y-auto pr-1">
        {days.map((date) => {
          const evs = eventsForDate(date);
          const visible = evs.slice(0, limit);
          const hasMore = evs.length > limit;
          const isToday = date.toDateString() === today.toDateString();
          const isPopulated = evs.length > 0;

          return (
            <div key={date.toDateString()} className="grid grid-cols-[64px_1fr] md:grid-cols-[84px_1fr] border-2 border-black rounded-[1.4rem] bg-white shadow-[3px_3px_0px_black] overflow-hidden min-h-[98px] md:min-h-[116px]">
              <button
                onClick={() => drillToDay(date)}
                className={`border-r-2 border-black px-2 py-3 text-left transition-colors ${isToday ? 'bg-violet-200 text-[#4c1d95]' : isPopulated ? 'bg-violet-50 text-black' : 'bg-gray-100 text-gray-500'}`}
              >
                <span className={`block font-black leading-none uppercase tracking-widest ${isPopulated ? 'text-[10px] md:text-xs' : 'text-[9px] md:text-[10px]'}`}>{getMonthShort(date)}</span>
                <span className={`mt-1 block font-black leading-none ${isPopulated ? 'text-[2rem] md:text-[2.5rem]' : 'text-[1.6rem] md:text-[2rem]'}`}>{date.getDate()}</span>
              </button>

              {evs.length === 0 ? (
                <div className="px-2.5 md:px-3 py-2.5" />
              ) : (
                <div className="px-2.5 md:px-3 py-2.5 flex gap-2 md:gap-3 overflow-x-auto items-center">
                  {visible.map((e) => {
                    const tags = generateAutoTags(e).slice(0, 2);
                    const time = e.event_time_utc ? utcToLocal(e.event_time_utc, getUserTZOffset()) : '';
                    const loc = e.location_data?.city || 'NYC';
                    const tileColor = getTileAccentColor(e.hex_color, resolvedTheme);
                    return (
                      <button
                        key={e.id}
                        onClick={() => setSelectedEvent(e)}
                        className="min-w-[190px] md:min-w-[235px] max-w-[190px] md:max-w-[235px] text-left rounded-xl border-2 bg-gray-50 p-2.5 md:p-3 shadow-[2px_2px_0px_black] hover:bg-opacity-80 transition-colors"
                        style={{ borderColor: tileColor }}
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
                      className="min-w-[60px] md:min-w-[72px] rounded-xl border-2 border-[#7C3AED] bg-violet-100 text-[#7C3AED] font-black text-lg md:text-xl flex items-center justify-center hover:bg-violet-200 self-stretch"
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
      <div className="space-y-4 h-full overflow-y-auto pr-1 pt-1">
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
                className="relative overflow-visible transition-transform pb-1"
              >
                <div
                  className="relative z-10 bg-white border-3 border-black rounded-3xl shadow-[4px_4px_0px_black]"
                  style={{ borderLeftColor: getTileAccentColor(e.hex_color, resolvedTheme), borderLeftWidth: 6 }}
                >
                  <div className="p-4 flex items-center gap-3 md:gap-4">
                    <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl overflow-hidden flex-shrink-0" style={{ backgroundColor: `${getTileAccentColor(e.hex_color, resolvedTheme)}22` }}>
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
                </div>

                {expanded && (
                  <div className="relative z-0 -mt-5 px-2 md:px-3">
                    <DayEventDetails event={e} />
                  </div>
                )}
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
    <div className="h-[100dvh] overflow-hidden lp-page-bg lp-theme-scope">
      <div className="max-w-7xl mx-auto h-full px-3 md:px-4 py-4 md:py-5 flex flex-col min-h-0">
        <div className="grid grid-cols-[72px_minmax(0,1fr)_72px] md:grid-cols-[88px_minmax(0,1fr)_88px] items-start md:items-center mb-3 md:mb-4 gap-2 md:gap-4">
          <Link to="/" className="w-[72px] md:w-[88px] flex flex-col items-center justify-start text-black hover:text-[#7C3AED] transition-colors">
            <div className="w-10 h-10 md:w-11 md:h-11 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg shadow-[3px_3px_0px_#333]">←</div>
            <span className="mt-1 text-[10px] md:text-xs font-black uppercase tracking-wide leading-tight text-center break-words">Home</span>
          </Link>

          <div className="border-3 border-black bg-white rounded-2xl px-3 md:px-5 py-3 md:py-3.5 shadow-[4px_4px_0px_black] text-center justify-self-stretch">
            <h1 className="font-black text-lg md:text-2xl leading-none">📅 Favorites Calendar</h1>
            <p className="text-gray-500 text-xs md:text-sm mt-1 font-bold">{favEvents.length} favorited events</p>
          </div>

          <Link to="/favorites" className="w-[72px] md:w-[88px] flex flex-col items-center justify-start text-black hover:text-[#7C3AED] transition-colors">
            <div className="w-10 h-10 md:w-11 md:h-11 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg shadow-[3px_3px_0px_#333]">→</div>
            <span className="mt-1 text-[10px] md:text-xs font-black uppercase tracking-wide leading-tight text-center break-words">Favorites</span>
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

        <div className="flex items-center gap-2 mb-3 md:mb-4">
          <button onClick={() => nav(-1)} className="w-9 h-9 bg-white border-3 border-black rounded-xl font-black hover:bg-[#7C3AED] hover:text-white transition-colors shadow-[2px_2px_0px_black]">←</button>
          <span className="font-black text-xs md:text-sm flex-1 text-center">{headLabel}</span>
          <button onClick={() => nav(1)} className="w-9 h-9 bg-white border-3 border-black rounded-xl font-black hover:bg-[#7C3AED] hover:text-white transition-colors shadow-[2px_2px_0px_black]">→</button>
        </div>

        <div className={`border-3 border-black rounded-3xl shadow-[5px_5px_0px_black] p-2.5 md:p-4 flex-1 min-h-0 ${view === 'monthly' ? 'overflow-hidden' : 'overflow-hidden'}`} style={{ backgroundColor: resolvedTheme.calendarBackgroundColor }}>
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
