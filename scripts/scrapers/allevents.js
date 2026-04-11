// scrapers/allevents.js
// Scrapes allevents.in NYC for additional volume.
// Allevents has structured JSON embeds and covers a wide range of categories.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'allevents';
const DELAY_MS = 2000;
const BASE_URL = 'https://allevents.in';

const BROWSE_URLS = [
  'https://allevents.in/new-york/all-events',
  'https://allevents.in/new-york/music',
  'https://allevents.in/new-york/arts',
  'https://allevents.in/new-york/food-drink',
  'https://allevents.in/new-york/sports',
  'https://allevents.in/new-york/community',
];

function normalizeAlleventsEvent(raw, sourceUrl) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || raw.event_description || '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.startDate || raw.start_time || raw.start;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    const loc = raw.location || {};
    const address = [
      loc.streetAddress || loc.address || '',
      loc.addressLocality || loc.city || '',
      loc.addressRegion || loc.state || '',
      loc.postalCode || '',
    ].filter(Boolean).join(', ');

    const zipcode = loc.postalCode || extractZip(address);
    if (!isNYCAddress(zipcode, address)) return null;
    const borough = getBorough(zipcode, address) || 'Manhattan';

    const price = detectPrice(raw.offers?.price ?? raw.ticket_price, description);

    const photos = [];
    const img = raw.image?.url || raw.image || raw.thumb || '';
    if (img && typeof img === 'string' && img.startsWith('http')) photos.push(img);

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
        lat: parseFloat(loc.latitude || loc.lat) || null,
        lng: parseFloat(loc.longitude || loc.lng) || null,
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

  // JSON-LD (Allevents uses schema.org events)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const items = data['@type'] === 'ItemList'
        ? (data.itemListElement || []).map(i => i.item || i)
        : data['@type'] === 'Event' ? [data] : [];
      items.forEach(item => {
        const ev = normalizeAlleventsEvent(item, sourceUrl);
        if (ev) results.push(ev);
      });
    } catch { /* skip */ }
  });

  // Also try __NEXT_DATA__
  if (results.length === 0) {
    const nextDataEl = $('script#__NEXT_DATA__').first();
    if (nextDataEl.length) {
      try {
        const nextData = JSON.parse(nextDataEl.html() || '{}');
        const eventsList =
          nextData?.props?.pageProps?.events ||
          nextData?.props?.pageProps?.data?.events ||
          [];
        eventsList.forEach(raw => {
          const ev = normalizeAlleventsEvent(raw, sourceUrl);
          if (ev) results.push(ev);
        });
      } catch { /* skip */ }
    }
  }

  return results;
}

export async function scrapeAllevents() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url);
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
