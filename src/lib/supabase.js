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
    lat: event.lat || null,
    lng: event.lng || null,
    borough: event.borough || null,
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
      `${SUPABASE_URL}/rest/v1/events_with_counts?is_approved=eq.true${sampleFilter}&select=*&order=event_date.asc`,
      { headers: baseHeaders }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/**
 * Fetch auto-scraped events from the auto_events table.
 * Returns events in a ±30d past / +6mo future window so both
 * the default (upcoming) view and archive mode work correctly.
 * Adds _auto:true so TileView sourceMode filter recognises them immediately.
 *
 * @returns {Promise<Array<any>>}
 */
export async function getAutoEvents() {
  try {
    // Fetch all approved auto events — no lower bound so archive mode works fully.
    // The scraper already limits what gets stored (30d past → 6mo future window).
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/auto_events?is_approved=eq.true&select=*&order=event_date.asc`,
      { headers: baseHeaders }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    // Map each row so it slots into the existing TileView source filter
    // (sourceMode==='auto' checks e._auto) and the EventDetailPopup
    // (name field shows the originating site, source_url appears as a link).
    return rows.map((row) => ({
      ...row,
      _auto: true,
      // Show source site as the "organizer" label in EventDetailPopup
      name: row.name || (row.source_site
        ? row.source_site.charAt(0).toUpperCase() + row.source_site.slice(1)
        : 'Auto'),
      // Inject source_url into relevant_links so the popup renders it
      relevant_links: Array.from(
        new Set([...(row.relevant_links || []), ...(row.source_url ? [row.source_url] : [])])
      ),
    }));
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

  if (insertRes.ok) return true;

  // Fallback: attempt one-by-one inserts so one bad row does not block all.
  // This also gives precise diagnostics in the browser console.
  let allInserted = true;
  const bulkError = await insertRes.text().catch(() => 'unknown bulk insert error');
  console.warn('Bulk sample sync failed, retrying row-by-row:', bulkError);

  for (const row of toInsert) {
    const rowRes = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: 'POST',
      headers: { ...baseHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify([row]),
    });

    if (!rowRes.ok) {
      allInserted = false;
      const rowError = await rowRes.text().catch(() => 'unknown row insert error');
      console.warn(`Sample event insert failed for "${row.event_name}":`, rowError);
    }
  }

  return allInserted;
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
    `${SUPABASE_URL}/storage/v1/object/event-images/${fileName}`,
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
  return `${SUPABASE_URL}/storage/v1/object/public/event-images/${fileName}`;
}

// ─── GeoPost helpers ──────────────────────────────────────────────────────────

/**
 * Fetch posts from geopost_feed view.
 * filter: { type: 'nyc' | 'borough' | 'zip', value?: string }
 */
function getTimeFilterSince(tf) {
  if (!tf || tf === 'all') return null;
  const now = new Date();
  const map = { '1d': 1, '7d': 7, '1mo': 30, '3mo': 90, '6mo': 180 };
  const days = map[tf];
  if (!days) return null;
  const since = new Date(now.getTime() - days * 86400000);
  return since.toISOString();
}

export async function fetchGeoPostFeed({
  type = 'all',
  value = null,
  timeFilter = 'all',
  statusFilter = 'all',
  sortByTop = false,
} = {}) {
  const order = sortByTop ? 'total_reactions.desc,created_at.desc' : 'created_at.desc';
  let url = `${SUPABASE_URL}/rest/v1/geopost_feed?select=*&order=${order}`;

  if (type === 'borough' && value) {
    url += `&borough=eq.${encodeURIComponent(value)}`;
  } else if (type === 'zip' && value) {
    url += `&zip_code=eq.${encodeURIComponent(value)}`;
  }
  // digital scope: null borough + null zip_code + scope=digital
  if (type === 'all') {
    // no extra filter — all scopes visible in All view
  }

  const since = getTimeFilterSince(timeFilter);
  if (since) url += `&created_at=gte.${encodeURIComponent(since)}`;

  if (statusFilter === 'participant') url += '&is_participant=eq.true';
  else if (statusFilter === 'orbiter')   url += '&is_participant=eq.false&user_id=not.is.null';
  else if (statusFilter === 'anonymous') url += '&user_id=is.null';

  const res = await fetch(url, { headers: baseHeaders });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Insert a new geopost.
 * payload: { content, image_url, zip_code, borough, is_participant, post_approved, user_id? }
 * Returns the inserted row.
 */
export async function submitGeoPost(payload, session = null) {
  const headers = {
    ...baseHeaders,
    'Prefer': 'return=representation',
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/geoposts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'GeoPost submission failed');
  }
  const rows = await res.json();
  return rows[0];
}

/**
 * Add an emoji reaction to a post.
 * Requires a signed-in session to award points (trigger fires).
 * Anonymous calls pass session=null — reaction stored but no points.
 */
export async function addPostReaction(postId, emojiText, session = null) {
  const headers = { ...baseHeaders };
  const userId = session?.user?.id ?? null;
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  const body = { post_id: postId, emoji_text: emojiText, user_id: userId };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/post_reactions`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  // 409 = duplicate (already reacted with same emoji) — treat as success
  if (!res.ok && res.status !== 409) {
    throw new Error('Reaction failed');
  }
}

/**
 * Remove an emoji reaction.
 */
export async function removePostReaction(postId, emojiText, session = null) {
  const headers = { ...baseHeaders };
  const userId = session?.user?.id ?? null;
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  await fetch(
    `${SUPABASE_URL}/rest/v1/post_reactions?post_id=eq.${postId}&emoji_text=eq.${encodeURIComponent(emojiText)}&user_id=eq.${userId}`,
    { method: 'DELETE', headers }
  );
}

/**
 * Fetch all reactions for a post.
 * Returns array of { id, post_id, user_id, emoji_text, created_at }
 */
export async function fetchPostReactions(postId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/post_reactions?post_id=eq.${postId}&select=*`,
    { headers: baseHeaders }
  );
  if (!res.ok) return [];
  return res.json();
}

/**
 * Fetch reactions for multiple posts at once (batch).
 * Returns array of reactions with username joined via profiles.
 */
export async function fetchReactionsForPosts(postIds) {
  if (!postIds.length) return [];
  const ids = postIds.map(id => `"${id}"`).join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/post_reactions?post_id=in.(${ids})&select=post_id,emoji_text,user_id,profiles(username)`,
    { headers: baseHeaders }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function fetchCommentsForPost(postId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/post_comments?post_id=eq.${postId}&select=*&order=created_at.asc`,
    { headers: baseHeaders }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function submitPostComment(payload, session = null) {
  const headers = {
    ...baseHeaders,
    Prefer: 'return=representation',
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/post_comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Comment submission failed');
  }
  const rows = await res.json();
  return rows[0];
}

export async function fetchCommentReactions(commentIds) {
  if (!commentIds.length) return [];
  const ids = commentIds.map(id => `"${id}"`).join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/comment_reactions?comment_id=in.(${ids})&select=comment_id,emoji,user_id,profiles(username)`,
    { headers: baseHeaders }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function upsertCommentReaction(commentId, emoji, session = null) {
  const headers = {
    ...baseHeaders,
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  const userId = session?.user?.id ?? null;
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/comment_reactions?on_conflict=comment_id,user_id`, {
    method: 'POST',
    headers,
    body: JSON.stringify([{ comment_id: commentId, emoji, user_id: userId }]),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Comment reaction failed');
  }
}

export async function removeCommentReaction(commentId, session = null) {
  const headers = { ...baseHeaders };
  const userId = session?.user?.id ?? null;
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  await fetch(
    `${SUPABASE_URL}/rest/v1/comment_reactions?comment_id=eq.${commentId}&user_id=eq.${userId}`,
    { method: 'DELETE', headers }
  );
}

export async function fetchProfileForGeoPost(userId, session = null) {
  if (!userId) return null;
  const headers = { ...baseHeaders };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=username,home_zip,last_participant_status&limit=1`,
    { headers }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

export async function syncSampleGeoPostsToSupabase(samplePosts = [], session = null) {
  if (!samplePosts.length) return true;
  const headers = {
    ...baseHeaders,
    Prefer: 'resolution=ignore-duplicates,return=minimal',
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const payload = samplePosts.map((p) => ({
    id: p.id,
    user_id: p.user_id || null,
    content: p.content,
    image_url: p.image_url || null,
    zip_code: p.zip_code || null,
    borough: p.borough || null,
    is_participant: !!p.is_participant,
    post_approved: true,
    post_fill: p.post_fill || null,
    post_outline: p.post_outline || null,
    scope: p.scope || 'digital',
    post_shadow: p.post_shadow || null,
    created_at: p.created_at,
  }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/geoposts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function syncSampleGeoCommentsToSupabase(sampleComments = [], session = null) {
  if (!sampleComments.length) return true;
  const headers = {
    ...baseHeaders,
    Prefer: 'resolution=ignore-duplicates,return=minimal',
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const payload = sampleComments.map((c) => ({
    id: c.id,
    post_id: c.post_id,
    parent_id: c.parent_id || null,
    user_id: c.user_id || null,
    username: c.username || 'anonymous',
    content: c.content,
    is_participant: !!c.is_participant,
    borough: c.borough || null,
    zip_code: c.zip_code || null,
    created_at: c.created_at,
  }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/post_comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return res.ok;
}

/**
 * Upload a geopost image to Supabase storage.
 * (Placeholder: uses same event-images bucket. Replace with Oracle Cloud when ready.)
 */
export async function uploadGeoPostImage(file, session = null) {
  const ext = file.name.split('.').pop();
  const fileName = `geopost-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': session?.access_token ? `Bearer ${session.access_token}` : `Bearer ${SUPABASE_KEY}`,
    'Content-Type': file.type,
  };
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/event-images/${fileName}`,
    { method: 'POST', headers, body: file }
  );
  if (!res.ok) throw new Error('Image upload failed');
  return `${SUPABASE_URL}/storage/v1/object/public/event-images/${fileName}`;
}

// ─── End GeoPost helpers ──────────────────────────────────────────────────────

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

/**
 * Record a verified check-in to the event_attendance table.
 * Only called for authenticated users (RLS blocks anonymous inserts server-side too).
 * Uses ON CONFLICT DO NOTHING on (user_id, event_id, checkin_type) to prevent duplicates.
 */
export async function recordAttendance(session, eventId, checkinType = 'main') {
  if (!session?.access_token || !session?.user?.id || !eventId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/event_attendance`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: session.user.id,
        event_id: eventId,
        checkin_type: checkinType,
        status: 'verified',
        verified_at: new Date().toISOString(),
      }),
    });
  } catch { /* non-critical — attendance count is best-effort */ }
}