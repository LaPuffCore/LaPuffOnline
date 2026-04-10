// @ts-nocheck
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';
const SESSION_KEY = 'lapuff_session';

// 1. EXPORT THE ACTUAL CLIENT
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function syncSupabaseClientSession(session) {
  if (!session?.access_token || !session?.refresh_token) return;

  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  if (error) {
    console.warn('Supabase client session sync failed:', error.message);
  }
}

// --- Session Management ---

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

/** @param {any} s */
function saveSession(s) { 
  localStorage.setItem(SESSION_KEY, JSON.stringify(s)); 
  syncSupabaseClientSession(s).catch((error) => {
    console.warn('Failed to persist Supabase auth session:', error?.message || error);
  });
}

export function clearSession() { 
  localStorage.removeItem(SESSION_KEY); 
  supabase.auth.signOut().catch(() => {});
}

export function getCurrentUser() { 
  return getSession()?.user || null; 
}

export async function refreshSession() {
  const session = getSession();
  if (!session?.refresh_token) {
    clearSession();
    return null;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const updatedSession = {
      user: { ...data.user, username: session.user?.username || data.user.email.split('@')[0] }, 
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
    };

    saveSession(updatedSession);
    return updatedSession;
  } catch (error) {
    console.warn('Session refresh failed:', error);
    clearSession();
    return null;
  }
}

export async function getValidSession() {
  const session = getSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now < 300) {
    return await refreshSession();
  }

  await syncSupabaseClientSession(session);
  return session;
}

// --- Auth Actions ---

/** * @param {string} email 
 * @param {string} password 
 * @param {string} username 
 * @param {string} bio 
 * @param {string} home_zip 
 * @param {string} referred_by // Added for the Expansion Protocol
 */
export async function signUp(email, password, username, bio, home_zip, referred_by) {
  // Check username uniqueness
  const { data: existing } = await supabase
    .from('profiles')
    .select('username')
    .eq('username', username)
    .single();

  if (existing) throw new Error('Username already taken.');

  // Use Supabase Client for signUp to properly handle metadata and options
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username.trim(),
        bio: bio || '',
        home_zip: home_zip || '10001',
        referred_by: referred_by || null // THE HANDSHAKE
      }
    }
  });

  if (error) throw new Error(error.message);

  // If auto-confirm is off (standard), we wait for email
  if (data.user && !data.session) {
    return { pending: true };
  }

  // If auto-confirm is on (local dev / certain configs)
  if (data.session) {
    const session = { 
      user: { ...data.user, username }, 
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.session.expires_in
    };
    saveSession(session);
    return { user: data.user, username };
  }

  return { pending: true };
}

/** * @param {string} email 
 * @param {string} password 
 */
export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();

  if (data.error) throw new Error(data.error.message);

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', data.user.id)
    .single();

  const username = profile?.username || email.split('@')[0];

  const session = { 
    user: { ...data.user, username }, 
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in
  };
  saveSession(session);
  return { user: data.user, username };
}

export async function signOut() {
  const session = getSession();
  if (session?.access_token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  clearSession();
  window.location.reload();
}