import { createContext, useContext, useState, useEffect } from 'react';
import { getSession, signOut, signIn, signUp } from './supabaseAuth';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial check on load
    const session = getSession();
    if (session) {
      setUser(session.user);
      setLoading(false);
    } else {
      // No session: run the anonymous device handshake to sync/clean any stale anon contributions
      setLoading(false);
      import('./anonDevice').then(m => m.initAnonDeviceHandshake && m.initAnonDeviceHandshake()).catch(() => {});
    }
  }, []);

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};