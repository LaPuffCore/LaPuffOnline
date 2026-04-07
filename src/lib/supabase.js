// @ts-nocheck
const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';

const baseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

/**
 * @returns {Promise<Array<any>>}
 */
export async function getApprovedEvents() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/events?is_approved=eq.true&select=*&order=event_date.asc`,
      { headers: baseHeaders }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/**
 * @param {Object} data 
 */
export async function submitEvent(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: 'POST',
    headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Submission failed');
  }
  return true;
}

/**
 * @param {File} file 
 */
export async function uploadEventPhoto(file) {
  const ext = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/event-photos/${fileName}`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': file.type,
      },
      body: file,
    }
  );
  if (!res.ok) throw new Error('Photo upload failed');
  return `${SUPABASE_URL}/storage/v1/object/public/event-photos/${fileName}`;
}

export async function sendSubmissionEmail() {
  try {
    await fetch('https://formsubmit.co/ajax/justinlapuff@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: 'New Event Submission - LaPuff Online NYC',
        message: 'An event was submitted on LaPuff Online NYC Events.',
        _template: 'basic',
      }),
    });
  } catch { /* silent */ }
}