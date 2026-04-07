import { Toaster } from "./components/ui/toaster" // Fixed @ alias
import { useState, useEffect } from 'react';
import { getApprovedEvents } from './lib/supabase';
import { SAMPLE_EVENTS } from './lib/sampleEvents';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from './lib/query-client' // Fixed @ alias
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from './lib/AuthContext'; // Fixed @ alias
// Add page imports here
import Home from './pages/Home';
import FavoritesPage from './pages/FavoritesPage';
import CalendarPage from './pages/CalendarPage';

// Shared events state wrapper
function AppWithEvents() {
  const [events, setEvents] = useState(SAMPLE_EVENTS);
  
  useEffect(() => {
    getApprovedEvents().then(dbEvents => {
      if (dbEvents && dbEvents.length > 0) {
        const ids = new Set(SAMPLE_EVENTS.map(e => e.id));
        setEvents([...SAMPLE_EVENTS, ...dbEvents.filter(e => !ids.has(e.id))]);
      }
    });
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Home events={events} />} />
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
      <QueryClientProvider client={queryClientInstance}>
        {/* IMPORTANT: Added basename so Router knows it lives in a subfolder */}
        <Router basename="/LaPuffOnline">
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App