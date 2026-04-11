// scrapers/dice.js
// Scrapes Dice.fm NYC music/nightlife events via __NEXT_DATA__ JSON.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'dice';
const DELAY_MS = 2000;
const BASE_URL = 'https://dice.fm';

const BROWSE_URLS = [
  'https://dice.fm/venue/new-york',
  'https://dice.fm/browse/new-york',
];

function normalizeDiceEvent(raw) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || raw.lineup_details || '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.date || raw.eventDate || raw.startDate;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    // Venue
    const venue = raw.venue || raw.location || {};
    let address = [
      venue.address || '',
      venue.city || '',
      venue.postal_code || '',
    ].filter(Boolean).join(', ');

    const zipcode = venue.postal_code || extractZip(address);
    const lat = parseFloat(venue.lat) || null;
    const lng = parseFloat(venue.lng) || null;

    if (!isNYCAddress(zipcode, address)) return null;
    const borough = getBorough(zipcode, address) || 'Manhattan';

    const priceVal = raw.min_price || raw.price;
    const price = detectPrice(priceVal, description);

    const photos = [];
    const img = raw.images?.square?.url || raw.image || raw.artwork || '';
    if (img && typeof img === 'string' && img.startsWith('http')) photos.push(img);

    const eventPath = raw.url || raw.link || '';
    const eventUrl = eventPath.startsWith('http') ? eventPath : `${BASE_URL}${eventPath}`;
    const eventId = raw.id || raw.slug || makeHashId(name, dateInfo.event_date, address);
    const externalId = makeExternalId(SOURCE_SITE, String(eventId));

    const { emoji, color } = assignEmojiAndColor(name, description);

    return {
      event_name: name.trim(),
      description,
      price_category: price,
      location_data: { city: borough, address: address || 'New York, NY', zipcode, lat, lng },
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

function extractFromHTML(html) {
  const $ = cheerioLoad(html);
  const results = [];

  const nextDataEl = $('script#__NEXT_DATA__').first();
  if (nextDataEl.length) {
    try {
      const nextData = JSON.parse(nextDataEl.html() || '{}');
      const props = nextData?.props?.pageProps;
      const eventsList = props?.events || props?.data?.events || props?.listing?.events || [];

      for (const raw of eventsList) {
        if (!raw) continue;
        const ev = normalizeDiceEvent(raw);
        if (ev) results.push(ev);
      }
    } catch { /* skip */ }
  }

  // Fallback JSON-LD
  if (results.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        if (data['@type'] === 'MusicEvent' || data['@type'] === 'Event') {
          const ev = normalizeDiceEvent({
            name: data.name,
            description: data.description,
            date: data.startDate,
            venue: data.location ? {
              address: data.location.streetAddress,
              city: data.location.addressLocality,
              postal_code: data.location.postalCode,
            } : null,
            url: data.url,
            id: data['@id'],
            image: data.image,
          });
          if (ev) results.push(ev);
        }
      } catch { /* skip */ }
    });
  }

  return results;
}

export async function scrapeDice() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url);
      if (!res.ok) {
        console.warn(`  Dice ${url} → HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const events = extractFromHTML(html);

      for (const ev of events) {
        if (!seenIds.has(ev.external_id)) {
          seenIds.add(ev.external_id);
          allEvents.push(ev);
        }
      }
    } catch (err) {
      console.warn(`  Dice scrape error: ${err.message}`);
    }
  }

  return allEvents;
}
