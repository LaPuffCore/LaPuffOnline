// @ts-nocheck
const SUPABASE_URL = 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tLCmZUz3bgISgxs4KVq28g_x36Xo6Cp';

const baseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const SAMPLE_ZIP_CODE = 'SAMPLE';

function toSampleEventRow(event) {
  return {
    name: event.name,
    event_name: event.event_name,
    price_category: event.price_category,
    location_data: event.location_data,
    event_date: event.event_date,
    event_time_utc: event.event_time_utc,
    relevant_links: event.relevant_links || [],
    description: event.description || '',
    photos: event.photos || [],
    representative_emoji: event.representative_emoji || '🎉',
    hex_color: event.hex_color || '#7C3AED',
    is_approved: true,
    zip_code: SAMPLE_ZIP_CODE,
  };
}

function sampleKey(eventName, eventDate) {
  return `${eventName}__${eventDate}`;
}

/**
 * @returns {Promise<Array<any>>}
 */
export async function getApprovedEvents(options = {}) {
  const { sampleOnly = false } = options;
  try {
    const sampleFilter = sampleOnly ? `&zip_code=eq.${SAMPLE_ZIP_CODE}` : '';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/events?is_approved=eq.true${sampleFilter}&select=*&order=event_date.asc`,
      { headers: baseHeaders }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function syncSampleEvents(sampleEvents = [], enabled = true, clearOnDisable = true) {
  if (!enabled) {
    if (!clearOnDisable) return true;
    const del = await fetch(`${SUPABASE_URL}/rest/v1/events?zip_code=eq.${SAMPLE_ZIP_CODE}`, {
      method: 'DELETE',
      headers: { ...baseHeaders, Prefer: 'return=minimal' },
    });
    return del.ok;
  }

  if (!sampleEvents.length) return true;

  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/events?zip_code=eq.${SAMPLE_ZIP_CODE}&select=event_name,event_date`,
    { headers: baseHeaders }
  );
  if (!existingRes.ok) return false;

  const existing = await existingRes.json();
  const existingKeys = new Set(existing.map((e) => sampleKey(e.event_name, e.event_date)));

  const toInsert = sampleEvents
    .map(toSampleEventRow)
    .filter((e) => !existingKeys.has(sampleKey(e.event_name, e.event_date)));

  if (!toInsert.length) return true;

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: 'POST',
    headers: { ...baseHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(toInsert),
  });

  return insertRes.ok;
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