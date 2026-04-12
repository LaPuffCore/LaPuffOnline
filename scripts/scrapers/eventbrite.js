// scrapers/eventbrite.js
// Extracts events from Eventbrite's embedded __SERVER_DATA__ JSON on browse pages.
// The /d/ny--new-york/events/ page embeds ~36 structured Event items per page
// as Python repr strings inside window.__SERVER_DATA__.jsonld[0].itemListElement.
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'eventbrite';
const DELAY_MS = 2000;

// Only /d/ browse URLs work (category /b/ URLs redirect and lose __SERVER_DATA__)
const BROWSE_URLS = [
  'https://www.eventbrite.com/d/ny--new-york/events/',
  'https://www.eventbrite.com/d/ny--new-york/events/?page=2',
  'https://www.eventbrite.com/d/ny--new-york/events/?page=3',
];

/**
 * Parse a Python repr dict string into a JS object.
 * Eventbrite's __SERVER_DATA__ stores event items as Python repr strings:
 *   "{'name': 'Foo', 'startDate': '2026-04-11', ...}"
 * We convert Python-style single-quoted dicts to valid JSON.
 */
function parsePythonRepr(s) {
  if (typeof s !== 'string') return s;
  try {
    // Replace Python True/False/None with JSON equivalents
    let json = s
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null');
    // Convert single-quoted keys/values to double-quoted
    // This handles nested dicts like {'address': {'postalCode': '10011'}}
    json = json.replace(/'/g, '"');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeEvent(raw, sourceUrl) {
  try {
    const name = raw.name || '';
    if (!name) return null;

    const descRaw = raw.description || '';
    const description = cleanDescription(descRaw);

    const dateInfo = dateToUTC(raw.startDate || raw.endDate);
    if (!dateInfo) return null;

    // Location from schema.org Place structure
    const loc = raw.location || {};
    const addr = loc.address || {};
    const geo = loc.geo || {};
    const address = [
      addr.streetAddress || '',
      addr.addressLocality || '',
      addr.addressRegion || '',
      addr.postalCode || '',
    ].filter(Boolean).join(', ');

    const zipcode = addr.postalCode || extractZip(address);
    const lat = parseFloat(geo.latitude) || null;
    const lng = parseFloat(geo.longitude) || null;

    if (!isNYCAddress(zipcode, address)) return null;
    const borough = getBorough(zipcode, address) || 'Manhattan';

    const price = detectPrice(raw.offers?.price, description);
    const { emoji, color } = assignEmojiAndColor(name, description);

    const eventUrl = (raw.url || sourceUrl || '').split('?')[0];
    const ticketId = eventUrl.match(/tickets-(\d+)/)?.[1];
    const externalId = ticketId
      ? makeExternalId(SOURCE_SITE, ticketId)
      : makeExternalId(SOURCE_SITE, makeHashId(name, dateInfo.event_date, address));

    // Image URL from Eventbrite CDN
    const photos = [];
    const img = typeof raw.image === 'string' ? raw.image : '';
    if (img && img.startsWith('http')) photos.push(img);

    return {
      event_name: name.trim(),
      description,
      price_category: price,
      location_data: { city: borough, address, zipcode, lat, lng },
      event_date: dateInfo.event_date,
      event_time_utc: dateInfo.event_time_utc,
      representative_emoji: emoji,
      hex_color: color,
      photos,
      relevant_links: [eventUrl],
      borough,
      is_approved: true,
      source_site: SOURCE_SITE,
      source_url: eventUrl,
      external_id: externalId,
    };
  } catch {
    return null;
  }
}

/**
 * Extract events from an Eventbrite browse page's __SERVER_DATA__ JSON.
 */
function extractFromServerData(html, sourceUrl) {
  const results = [];

  // Find window.__SERVER_DATA__ = {...};
  const sdStart = html.indexOf('__SERVER_DATA__');
  if (sdStart === -1) return results;

  const jsonStart = html.indexOf('{', sdStart);
  if (jsonStart === -1) return results;

  try {
    // Use a streaming JSON decoder approach — find the end of the JSON object
    let depth = 0;
    let inString = false;
    let escape = false;
    let jsonEnd = jsonStart;

    for (let i = jsonStart; i < html.length && i < jsonStart + 500000; i++) {
      const ch = html[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
    }

    const serverData = JSON.parse(html.slice(jsonStart, jsonEnd));
    const jsonld = serverData?.jsonld;
    if (!Array.isArray(jsonld) || !jsonld[0]) return results;

    const itemList = jsonld[0];
    const items = itemList.itemListElement || [];

    for (const listItem of items) {
      // Items may be Python repr strings or already-parsed objects
      let eventObj = listItem.item || listItem;
      if (typeof eventObj === 'string') {
        eventObj = parsePythonRepr(eventObj);
      }
      if (!eventObj || eventObj['@type'] !== 'Event') continue;

      // Location may also be a Python repr string
      if (typeof eventObj.location === 'string') {
        eventObj.location = parsePythonRepr(eventObj.location);
      }

      const ev = normalizeEvent(eventObj, sourceUrl);
      if (ev) results.push(ev);
    }
  } catch (err) {
    console.warn(`  Eventbrite __SERVER_DATA__ parse error: ${err.message}`);
  }

  return results;
}

export async function scrapeEventbrite() {
  const allEvents = [];
  const seenIds = new Set();

  for (const browseUrl of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(browseUrl, {
        Referer: 'https://www.eventbrite.com/',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      });

      if (!res.ok) {
        console.warn(`  Eventbrite ${browseUrl} → HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const events = extractFromServerData(html, browseUrl);

      for (const ev of events) {
        if (!seenIds.has(ev.external_id)) {
          seenIds.add(ev.external_id);
          allEvents.push(ev);
        }
      }
    } catch (err) {
      console.warn(`  Eventbrite error: ${err.message}`);
    }
  }

  return allEvents;
}
