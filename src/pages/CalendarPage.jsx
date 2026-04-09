import { useState, useEffect } from 'react';
import { getFavorites } from '../lib/favorites';
import EventDetailPopup from '../components/EventDetailPopup';
import { Link, useLocation } from 'react-router-dom';

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year, month) { return new Date(year, month, 1).getDay(); }

export default function CalendarPage({ events = [] }) {
  const today = new Date();
  const location = useLocation();
  const [view, setView] = useState('monthly');
  const [curDate, setCurDate] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [favorites, setFavorites] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Handle incoming navigation state from the EventDetailPopup
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

  const favEvents = events.filter(e => favorites.includes(e.id));

  function eventsForDate(date) {
    const key = date.toISOString().split('T')[0];
    return favEvents.filter(e => e.event_date === key);
  }

  function nav(dir) {
    const d = new Date(curDate);
    if (view === 'monthly') d.setMonth(d.getMonth() + dir);
    else if (view === 'weekly') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurDate(d);
  }

  // Click day on monthly → go to weekly view for that week
  function drillToWeek(date) {
    setCurDate(date);
    setView('weekly');
  }

  // Click day on weekly → go to daily view for that day
  function drillToDay(date) {
    setCurDate(date);
    setView('daily');
  }

  const year = curDate.getFullYear();
  const month = curDate.getMonth();

  function MonthGrid() {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDay(year, month);
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    const LIMIT = 3;

    return (
      <div className="grid grid-cols-7 gap-1">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-center text-xs font-black text-gray-400 py-2">{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`e${i}`} />;
          const evs = eventsForDate(date);
          const isToday = date.toDateString() === today.toDateString();
          return (
            <div key={date.toDateString()}
              onClick={() => drillToWeek(date)}
              className={`min-h-20 rounded-2xl p-1.5 border-2 cursor-pointer transition-all hover:border-[#7C3AED] hover:shadow-md
                ${isToday ? 'border-[#7C3AED] bg-violet-50' : 'border-gray-200'}
                ${evs.length > 0 ? 'ring-1 ring-[#7C3AED]/20' : ''}
              `}
            >
              <p className={`text-xs font-black mb-1 ${isToday ? 'text-[#7C3AED]' : 'text-gray-700'}`}>{date.getDate()}</p>
              <div className="space-y-0.5">
                {evs.slice(0, LIMIT).map(e => (
                  <div key={e.id}
                    onClick={ev => { ev.stopPropagation(); setSelectedEvent(e); }}
                    className="text-xs rounded-lg px-1 py-0.5 font-bold truncate cursor-pointer hover:opacity-80"
                    style={{ backgroundColor: (e.hex_color || '#7C3AED') + '33', color: e.hex_color || '#7C3AED' }}>
                    {e.representative_emoji} {e.event_name.substring(0, 12)}
                  </div>
                ))}
                {evs.length > LIMIT && (
                  <div className="text-xs text-center font-black text-[#7C3AED]">+{evs.length - LIMIT}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function WeekGrid() {
    const weekStart = new Date(curDate);
    weekStart.setDate(curDate.getDate() - curDate.getDay());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
    });
    const maxEvs = Math.max(...days.map(d => eventsForDate(d).length), 1);

    return (
      <div className="grid grid-cols-7 gap-2" style={{ minHeight: 300 }}>
        {days.map(date => {
          const evs = eventsForDate(date);
          const isToday = date.toDateString() === today.toDateString();
          const isCur = date.toDateString() === curDate.toDateString();
          return (
            <div key={date.toDateString()} className="flex flex-col">
              <div
                onClick={() => drillToDay(date)}
                className={`text-center text-xs font-black py-2 rounded-t-xl cursor-pointer transition-colors hover:bg-[#7C3AED] hover:text-white
                  ${isToday ? 'bg-[#7C3AED] text-white' : isCur ? 'bg-violet-100 text-[#7C3AED]' : 'bg-gray-100 text-gray-700'}`}>
                <div>{['Su','Mo','Tu','We','Th','Fr','Sa'][date.getDay()]}</div>
                <div className="text-lg leading-none">{date.getDate()}</div>
                {evs.length > 0 && <div className="text-xs opacity-70">{evs.length}ev</div>}
              </div>
              <div className="flex-1 border-2 border-gray-200 rounded-b-xl p-1 space-y-1 overflow-y-auto cursor-pointer"
                onClick={() => drillToDay(date)}
                style={{ minHeight: Math.max(60, evs.length * 30), background: isToday ? '#f5f3ff' : undefined }}>
                {evs.map(e => (
                  <div key={e.id} onClick={ev => { ev.stopPropagation(); setSelectedEvent(e); }}
                    className="text-xs rounded-xl px-1.5 py-1 font-bold cursor-pointer hover:opacity-80 truncate"
                    style={{ backgroundColor: (e.hex_color || '#7C3AED') + '33', color: e.hex_color || '#7C3AED' }}>
                    {e.representative_emoji} {e.event_name.substring(0, 16)}
                  </div>
                ))}
              </div>
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
          evs.map(e => (
            <div key={e.id} onClick={() => setSelectedEvent(e)}
              className="bg-white border-3 border-black rounded-3xl overflow-hidden cursor-pointer hover:scale-[1.01] transition-transform shadow-[4px_4px_0px_black]"
              style={{ borderLeftColor: e.hex_color || '#7C3AED', borderLeftWidth: 6 }}>
              <div className="p-4 flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0"
                  style={{ backgroundColor: (e.hex_color || '#7C3AED') + '22' }}>
                  {e.photos?.[0]
                    ? <img src={e.photos[0]} className="w-full h-full object-cover" alt="" onError={ev => ev.target.style.display='none'} />
                    : <div className="w-full h-full flex items-center justify-center text-3xl">{e.representative_emoji}</div>}
                </div>
                <div>
                  <h3 className="font-black text-base">{e.event_name}</h3>
                  <p className="text-sm text-gray-500">{e.location_data?.city || 'NYC'} · {e.price_category === 'free' ? 'FREE' : e.price_category}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  const headLabel = view === 'monthly'
    ? new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : view === 'weekly' ? (() => {
        const ws = new Date(curDate); ws.setDate(curDate.getDate() - curDate.getDay());
        const we = new Date(ws); we.setDate(ws.getDate() + 6);
        return `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      })()
    : curDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Link to="/" className="w-10 h-10 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg hover:bg-[#7C3AED] transition-colors shadow-[3px_3px_0px_#333]">←</Link>
          <h1 className="font-black text-2xl">📅 Favorites Calendar</h1>

          {/* View pills */}
          <div className="ml-auto flex items-center gap-2">
            {/* Breadcrumb for drill-down */}
            {view !== 'monthly' && (
              <button onClick={() => setView('monthly')} className="text-xs font-black text-[#7C3AED] hover:underline">Monthly</button>
            )}
            {view === 'daily' && <span className="text-xs text-gray-400">›</span>}
            {view === 'daily' && (
              <button onClick={() => setView('weekly')} className="text-xs font-black text-[#7C3AED] hover:underline">Weekly</button>
            )}
            <div className="bg-gray-100 border-3 border-black rounded-2xl p-1 flex shadow-[3px_3px_0px_black]">
              {['monthly','weekly','daily'].map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black capitalize transition-all ${view === v ? 'bg-[#7C3AED] text-white' : 'hover:bg-gray-200'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Nav */}
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => nav(-1)} className="w-9 h-9 bg-white border-3 border-black rounded-xl font-black hover:bg-[#7C3AED] hover:text-white transition-colors shadow-[2px_2px_0px_black]">←</button>
          <span className="font-black text-sm flex-1 text-center">{headLabel}</span>
          <button onClick={() => nav(1)} className="w-9 h-9 bg-white border-3 border-black rounded-xl font-black hover:bg-[#7C3AED] hover:text-white transition-colors shadow-[2px_2px_0px_black]">→</button>
        </div>

        <div className="bg-white border-3 border-black rounded-3xl shadow-[5px_5px_0px_black] p-4">
          {view === 'monthly' && <MonthGrid />}
          {view === 'weekly' && <WeekGrid />}
          {view === 'daily' && <DayView />}
        </div>

        {view === 'monthly' && <p className="text-xs text-gray-400 text-center mt-3 font-medium">Click a day to drill into week view → then day view</p>}
        {view === 'weekly' && <p className="text-xs text-gray-400 text-center mt-3 font-medium">Click a day column to drill into day view</p>}
      </div>
      {selectedEvent && <EventDetailPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}