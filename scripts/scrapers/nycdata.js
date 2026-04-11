// scrapers/nycdata.js
// NYC Open Data — NYC Permitted Events (dataset tvpp-9vvx).
// This is a fully open government API with no authentication required.
// Returns hundreds of upcoming public events across all 5 boroughs.
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, sleep } from '../utils/normalize.js';
import { getBorough } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'nycdata';
const API_BASE = 'https://data.cityofnewyork.us/resource';

// Skip purely internal/maintenance event types
const SKIP_TYPES = new Set([
  'Athletic Field',
  'Athletic Field-Tier 2',
  'Athletic Field-Tier 3',
  'Baseball-Babe Ruth',
  'Baseball-Little League',
  'Baseball-Pony',
  'Baseball Regulation',
  'Softball (Little league)',
]);

function normalizeBorough(raw) {
  if (!raw) return 'Manhattan';
  const b = raw.toLowerCase();
  if (b.includes('brooklyn')) return 'Brooklyn';
  if (b.includes('bronx')) return 'Bronx';
  if (b.includes('queens')) return 'Queens';
  if (b.includes('staten')) return 'Staten Island';
  return 'Manhattan';
}

function normalizePermittedEvent(row) {
  try {
    const name = (row.event_name || '').trim();
    if (!name || name.toLowerCase() === 'miscellaneous') return null;
    if (SKIP_TYPES.has(row.event_type)) return null;

    const dateStr = row.start_date_time;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    const borough = normalizeBorough(row.event_borough);
    const location = row.event_location || '';

    // Build a human-readable address from location + borough
    const address = location
      ? `${location}, ${borough}, NY`
      : `${borough}, New York, NY`;

    const description = [
      row.event_type ? `Type: ${row.event_type}` : '',
      row.event_agency ? `Agency: ${row.event_agency}` : '',
    ].filter(Boolean).join('. ') || `${name} — public event in ${borough}.`;

    const price = detectPrice(null, description);
    const { emoji, color } = assignEmojiAndColor(name, description);

    const eventIdStr = String(row.event_id || makeHashId(name, dateInfo.event_date, address));
    const externalId = makeExternalId(SOURCE_SITE, eventIdStr);
    // Give each event a unique source_url so global dedup doesn't collapse all 500 onto the same URL
    const sourceUrl = `https://data.cityofnewyork.us/City-Government/NYC-Permitted-Event-Information/tvpp-9vvx?event_id=${eventIdStr}`;

    return {
      event_name: name,
      description,
      price_category: price,
      location_data: { city: borough, address, zipcode: null, lat: null, lng: null },
      event_date: dateInfo.event_date,
      event_time_utc: dateInfo.event_time_utc,
      representative_emoji: emoji,
      hex_color: color,
      photos: [],
      relevant_links: [`https://data.cityofnewyork.us/City-Government/NYC-Permitted-Event-Information/tvpp-9vvx`],
      borough,
      is_approved: true,
      source_site: SOURCE_SITE,
      source_url: sourceUrl,
      external_id: externalId,
    };
  } catch {
    return null;
  }
}

export async function scrapeNYCData() {
  const allEvents = [];
  const seenIds = new Set();

  const now = new Date();
  const startDate = now.toISOString().slice(0, 10) + 'T00:00:00.000';
  const endDate = new Date(now.getTime() + 180 * 86400000).toISOString().slice(0, 10) + 'T23:59:59.000';

  // Fetch up to 500 permitted events in the 6-month window
  const url = `${API_BASE}/tvpp-9vvx.json?$where=start_date_time>'${startDate}' AND start_date_time<'${endDate}'&$limit=500&$order=start_date_time`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!res.ok) {
      console.warn(`  NYC Open Data → HTTP ${res.status}`);
      return [];
    }

    const rows = await res.json();
    for (const row of rows) {
      const ev = normalizePermittedEvent(row);
      if (!ev || seenIds.has(ev.external_id)) continue;
      seenIds.add(ev.external_id);
      allEvents.push(ev);
    }
  } catch (err) {
    console.warn(`  NYC Open Data error: ${err.message}`);
  }

  return allEvents;
}
