// utils/dedup.js
// Check existing auto_events to prevent duplicate inserts (by external_id, source_url, or title+date).

/**
 * Fetch existing external_ids AND source_urls from auto_events.
 * Returns { idSet, urlSet, titleDateSet } for fast dedup lookups.
 */
export async function getExistingExternalIds(supabaseUrl, headers) {
  try {
    // Fetch all future + recent past events for dedup (no need to check very old records)
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await fetch(
      `${supabaseUrl}/rest/v1/auto_events?select=external_id,source_url,event_name,event_date&event_date=gte.${cutoff}&external_id=not.is.null`,
      { headers }
    );
    if (!res.ok) {
      console.warn('Could not fetch existing records for dedup — will insert all');
      return { idSet: new Set(), urlSet: new Set(), titleDateSet: new Set() };
    }
    const rows = await res.json();
    const idSet = new Set(rows.map((r) => r.external_id).filter(Boolean));
    const urlSet = new Set(rows.map((r) => r.source_url).filter(Boolean));
    const titleDateSet = new Set(
      rows
        .filter((r) => r.event_name && r.event_date)
        .map((r) => `${r.event_name.toLowerCase().trim()}|${r.event_date}`)
    );
    return { idSet, urlSet, titleDateSet };
  } catch (err) {
    console.warn('Dedup fetch error:', err.message);
    return { idSet: new Set(), urlSet: new Set(), titleDateSet: new Set() };
  }
}

/**
 * Filter out events that already exist in the DB by external_id, source_url, or event_name+date.
 */
export function filterNewEvents(events, existingDedup) {
  // Support legacy callers that pass a plain Set
  if (existingDedup instanceof Set) {
    return events.filter((e) => !e.external_id || !existingDedup.has(e.external_id));
  }
  const { idSet, urlSet, titleDateSet } = existingDedup;
  return events.filter((e) => {
    if (e.external_id && idSet.has(e.external_id)) return false;
    if (e.source_url && urlSet.has(e.source_url)) return false;
    const key = `${(e.event_name || '').toLowerCase().trim()}|${e.event_date}`;
    if (titleDateSet.has(key)) return false;
    return true;
  });
}

