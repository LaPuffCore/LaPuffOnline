const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';
const SESSION_KEY = 'lapuff_session';

// --- Session Management ---

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function saveSession(s) { 
  localStorage.setItem(SESSION_KEY, JSON.stringify(s)); 
}

export function clearSession() { 
  localStorage.removeItem(SESSION_KEY); 
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
      user: { ...data.user, username: session.user.username }, 
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

  return session;
}

// --- Auth Actions ---

export async function checkUsernameAvailable(username) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=username&limit=1`, {
    headers: { 'apikey': SUPABASE_KEY },
  });
  const data = await res.json();
  return !data?.length;
}

export async function signUp(email, password, username, bio, home_zip) {
  const available = await checkUsernameAvailable(username);
  if (!available) throw new Error('Username already taken.');

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const authData = await res.json();
  if (authData.error) throw new Error(authData.error.message || 'Sign up failed');

  const accessToken = authData.access_token;
  const userId = authData.user?.id;

  if (accessToken && userId) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        id: userId,
        username: username.trim(),
        bio: bio || '',
        home_zip: home_zip || '10001',
        clout_points: 0,
        updated_at: new Date().toISOString(),
      }),
    });
    
    const session = { 
      user: { ...authData.user, username }, 
      access_token: accessToken,
      refresh_token: authData.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + authData.expires_in
    };
    saveSession(session);
    return { user: authData.user, username };
  }

  return { pending: true };
}

export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();

  if (data.error) throw new Error(data.error.message || 'Sign in failed');

  let username = email.split('@')[0];
  const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}&select=username`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${data.access_token}` },
  });
  const profiles = await pRes.json();
  if (profiles?.[0]?.username) username = profiles[0].username;

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
  window.location.reload(); // Force context update
}

// THIS IS THE EXPORT VITE WAS LOOKING FOR
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: getSession() } }),
    signIn,
    signOut,
    signUp
  }
};