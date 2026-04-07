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

/**
 * Refreshes the access token using the refresh_token.
 * This prevents the user from being logged out mid-session.
 */
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

/**
 * Gets a valid session. If the token is expired or expiring in < 5 mins, 
 * it triggers a refresh automatically.
 */
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
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
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
    
    saveSession({ 
      user: { ...authData.user, username }, 
      access_token: accessToken,
      refresh_token: authData.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + authData.expires_in
    });
    return { user: authData.user, username };
  }

  localStorage.setItem('lapuff_pending_profile', JSON.stringify({
    username: username.trim(), bio: bio || '', home_zip: home_zip || '10001',
  }));
  return { pending: true };
}

export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();

  if (data.error) {
    const msg = data.error?.message || '';
    if (msg.toLowerCase().includes('email not confirmed')) {
      throw new Error('Please confirm your email before logging in.');
    }
    throw new Error(msg || 'Sign in failed');
  }

  let username = email.split('@')[0];
  try {
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}&select=username`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${data.access_token}` },
    });
    const profiles = await pRes.json();
    if (profiles?.[0]?.username) {
      username = profiles[0].username;
    } else {
      const pending = JSON.parse(localStorage.getItem('lapuff_pending_profile') || '{}');
      if (pending.username) {
        await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${data.access_token}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            id: data.user.id,
            username: pending.username,
            bio: pending.bio || '',
            home_zip: pending.home_zip || '10001',
            clout_points: 0,
            updated_at: new Date().toISOString(),
          }),
        });
        username = pending.username;
        localStorage.removeItem('lapuff_pending_profile');
      }
    }
  } catch {}

  saveSession({ 
    user: { ...data.user, username }, 
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in
  });
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
}

// --- Clout / Points ---

export async function addClout(amount) {
  const session = await getValidSession(); // Automatically refreshes if needed
  if (!session?.access_token) throw new Error('Log in to earn clout!');
  
  const userId = session.user.id;
  const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=clout_points`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${session.access_token}` },
  });
  const profiles = await pRes.json();
  const current = profiles?.[0]?.clout_points || 0;
  
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ clout_points: current + amount, updated_at: new Date().toISOString() }),
  });
}