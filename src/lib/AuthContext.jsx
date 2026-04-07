import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from './supabaseAuth'; // Using your existing supabaseAuth.js

// 1. Initialize the Context
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for login/logout events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loginWithGoogle = () => supabase.auth.signInWithOAuth({ provider: 'google' });
  const logout = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

// 2. EXPORT THE HOOK (The fix for your build error)
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};