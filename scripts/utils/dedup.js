// utils/dedup.js
// Check existing external_ids in auto_events to prevent duplicate inserts.

/**
 * Fetch all external_ids from auto_events inserted in the last 45 days.
 * Returns a Set<string> for fast lookup.
 */
export async function getExistingExternalIds(supabaseUrl, headers) {
  try {
    const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/auto_events?select=external_id&created_at=gte.${cutoff}&external_id=not.is.null`,
      { headers }
    );
    if (!res.ok) {
      console.warn('Could not fetch existing IDs for dedup, will insert all');
      return new Set();
    }
    const rows = await res.json();
    return new Set(rows.map((r) => r.external_id).filter(Boolean));
  } catch (err) {
    console.warn('Dedup fetch error:', err.message);
    return new Set();
  }
}

/**
 * Filter out events whose external_id already exists in the DB.
 * Events with no external_id always pass through (hash-based IDs may be new).
 */
export function filterNewEvents(events, existingIds) {
  return events.filter((e) => {
    if (!e.external_id) return true;
    return !existingIds.has(e.external_id);
  });
}
