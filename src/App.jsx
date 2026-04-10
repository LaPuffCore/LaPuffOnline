import { Toaster } from "./components/ui/toaster" // Fixed @ alias
import { useState, useEffect } from 'react';
import { getApprovedEvents, syncSampleEvents } from './lib/supabase';
import { SAMPLE_EVENTS } from './lib/sampleEvents';
import {
  SAMPLE_MODE,
  SYNC_SAMPLE_EVENTS_TO_SUPABASE,
  CLEAR_SUPABASE_SAMPLES_ON_DISABLE,
} from './lib/sampleConfig';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from './lib/query-client' // Fixed @ alias
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from './lib/AuthContext'; // Fixed @ alias
import { ThemeProvider } from './lib/theme';
import { hydrateFavoriteEventCache } from './lib/favorites';
// Add page imports here
import Home from './pages/Home';
import FavoritesPage from './pages/FavoritesPage';
import CalendarPage from './pages/CalendarPage';

const EVENTS_CACHE_KEY = 'lapuff_cached_events';

function getInitialEvents() {
  if (SAMPLE_MODE && SAMPLE_EVENTS.length) return SAMPLE_EVENTS;
  try {
    const cached = JSON.parse(sessionStorage.getItem(EVENTS_CACHE_KEY) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

// Shared events state wrapper
function AppWithEvents() {
  const [events, setEvents] = useState(getInitialEvents);
  const [eventsLoading, setEventsLoading] = useState(true);
  
  useEffect(() => {
    let mounted = true;

    async function loadEvents() {
      try {
        const syncPromise = SYNC_SAMPLE_EVENTS_TO_SUPABASE
          ? syncSampleEvents(
              SAMPLE_EVENTS,
              SAMPLE_MODE,
              CLEAR_SUPABASE_SAMPLES_ON_DISABLE
            )
          : Promise.resolve(true);

        let dbEvents = await getApprovedEvents({ sampleOnly: SAMPLE_MODE });

        if (SAMPLE_MODE && (!dbEvents || dbEvents.length === 0)) {
          await syncPromise;
          dbEvents = await getApprovedEvents({ sampleOnly: SAMPLE_MODE });
        } else {
          syncPromise.catch(() => {});
        }

        if (!mounted) return;

        if (dbEvents && dbEvents.length > 0) {
          setEvents(dbEvents);
          try {
            sessionStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify(dbEvents));
          } catch {}
          setEventsLoading(false);
          return;
        }

        // Safety fallback while developing if DB is unreachable.
        if (SAMPLE_MODE) setEvents(SAMPLE_EVENTS);
        setEventsLoading(false);
      } catch {
        if (!mounted) return;
        if (SAMPLE_MODE) setEvents(SAMPLE_EVENTS);
        setEventsLoading(false);
      }
    }

    loadEvents();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    hydrateFavoriteEventCache(events);
  }, [events]);

  return (
    <Routes>
      <Route path="/" element={<Home events={events} eventsLoading={eventsLoading} />} />
      <Route path="/favorites" element={<FavoritesPage events={events} />} />
      <Route path="/calendar" element={<CalendarPage events={events} />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
}

const AuthenticatedApp = () => {
  const { user, loading } = useAuth();

  // Standard loading state while checking Supabase session
  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return <AppWithEvents />;
};

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClientInstance}>
          {/* IMPORTANT: Added basename so Router knows it lives in a subfolder */}
          <Router basename="/LaPuffOnline">
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}

export default App