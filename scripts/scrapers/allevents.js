// scrapers/allevents.js
// Scrapes allevents.in NYC for additional volume.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'allevents';
const DELAY_MS = 2000;
const BASE_URL = 'https://allevents.in';

/** Rough lat/lng bounding boxes per borough. */
function getBoroughByCoords(lat, lng) {
  if (lat >= 40.7 && lat <= 40.88 && lng >= -74.02 && lng <= -73.9) return 'Manhattan';
  if (lat >= 40.57 && lat <= 40.74 && lng >= -74.05 && lng <= -73.83) return 'Brooklyn';
  if (lat >= 40.49 && lat <= 40.65 && lng >= -74.26 && lng <= -74.05) return 'Staten Island';
  if (lat >= 40.49 && lat <= 40.80 && lng >= -73.96 && lng <= -73.70) return 'Queens';
  if (lat >= 40.79 && lat <= 40.92 && lng >= -73.94 && lng <= -73.79) return 'Bronx';
  return null;
}

const BROWSE_URLS = [
  'https://allevents.in/new-york',
  'https://allevents.in/new-york/music',
  'https://allevents.in/new-york/art',
  'https://allevents.in/new-york/food',
  'https://allevents.in/new-york/sports',
  'https://allevents.in/new-york/community',
  'https://allevents.in/new-york/nightlife',
];

function normalizeAlleventsEvent(raw, sourceUrl) {
  try {
    const name = raw.name || raw.title || raw.eventName || '';
    if (!name) return null;

    const descRaw = raw.description || raw.event_description || '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.startDate || raw.start_time || raw.start || raw.date;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    const locRaw = raw.location || raw.venue || {};
    // JSON-LD Place → PostalAddress nesting: loc.address is a PostalAddress object
    const addrObj = (locRaw.address && typeof locRaw.address === 'object') ? locRaw.address : {};
    const address = [
      addrObj.streetAddress || locRaw.name || '',
      addrObj.addressLocality || '',
      addrObj.addressRegion || '',
      addrObj.postalCode || '',
    ].filter(Boolean).join(', ');

    const zipcode = addrObj.postalCode || extractZip(address) || extractZip(locRaw.name || '');
    const lat = parseFloat(locRaw.geo?.latitude || addrObj.latitude) || null;
    const lng = parseFloat(locRaw.geo?.longitude || addrObj.longitude) || null;

    // Accept if zip matches NYC OR address text has NYC signals OR coords in NYC bounding box
    const nycByCoords = lat && lng && lat >= 40.4 && lat <= 41.0 && lng >= -74.3 && lng <= -73.6;
    if (!isNYCAddress(zipcode, address) && !nycByCoords) return null;
    const borough = getBorough(zipcode, address) || (lat ? getBoroughByCoords(lat, lng) : null) || 'Manhattan';

    const price = detectPrice(raw.offers?.price ?? raw.ticket_price ?? raw.price, description);

    const photos = [];
    const img = raw.image?.url || (typeof raw.image === 'string' ? raw.image : '') || raw.thumb || raw.cover || '';
    if (img && img.startsWith('http')) photos.push(img);

    const eventUrl = raw.url || raw['@id'] || sourceUrl || '';
    const eventId = raw.id || raw['@id']?.split('/').filter(Boolean).pop() ||
      makeHashId(name, dateInfo.event_date, address);
    const externalId = makeExternalId(SOURCE_SITE, String(eventId));

    const { emoji, color } = assignEmojiAndColor(name, description);

    return {
      event_name: name.trim(),
      description,
      price_category: price,
      location_data: {
        city: borough,
        address: address || 'New York, NY',
        zipcode,
        lat,
        lng,
      },
      event_date: dateInfo.event_date,
      event_time_utc: dateInfo.event_time_utc,
      representative_emoji: emoji,
      hex_color: color,
      photos,
      relevant_links: eventUrl ? [eventUrl] : [],
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

function extractFromHTML(html, sourceUrl) {
  const $ = cheerioLoad(html);
  const results = [];

  // JSON-LD arrays and single events
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(raw) ? raw :
        raw['@type'] === 'ItemList' ? (raw.itemListElement || []).map(i => i.item || i) :
        raw['@type'] === 'Event' ? [raw] : [];
      items.forEach(item => {
        const ev = normalizeAlleventsEvent(item, sourceUrl);
        if (ev) results.push(ev);
      });
    } catch { /* skip */ }
  });

  // __NEXT_DATA__ / server-side props
  if (results.length === 0) {
    const nextDataEl = $('script#__NEXT_DATA__').first();
    if (nextDataEl.length) {
      try {
        const nextData = JSON.parse(nextDataEl.html() || '{}');
        const lists = [
          nextData?.props?.pageProps?.events,
          nextData?.props?.pageProps?.data?.events,
          nextData?.props?.pageProps?.initialData,
        ].filter(Array.isArray);
        for (const list of lists) {
          list.forEach(raw => {
            const ev = normalizeAlleventsEvent(raw, sourceUrl);
            if (ev) results.push(ev);
          });
        }
      } catch { /* skip */ }
    }
  }

  // Embedded JSON blobs in page scripts
  if (results.length === 0) {
    $('script:not([src])').each((_, el) => {
      const text = $(el).html() || '';
      const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\});/s) ||
                    text.match(/window\.__data__\s*=\s*(\{.+?\});/s);
      if (!match) return;
      try {
        const data = JSON.parse(match[1]);
        const eventsList = data?.events || data?.data?.events || [];
        eventsList.forEach(raw => {
          const ev = normalizeAlleventsEvent(raw, sourceUrl);
          if (ev) results.push(ev);
        });
      } catch { /* skip */ }
    });
  }

  return results;
}

export async function scrapeAllevents() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url, { Referer: 'https://allevents.in/' });
      if (!res.ok) {
        console.warn(`  Allevents ${url} → HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const events = extractFromHTML(html, url);

      for (const ev of events) {
        if (!seenIds.has(ev.external_id)) {
          seenIds.add(ev.external_id);
          allEvents.push(ev);
        }
      }
    } catch (err) {
      console.warn(`  Allevents scrape error: ${err.message}`);
    }
  }

  return allEvents;
}

