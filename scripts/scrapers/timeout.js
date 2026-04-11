// scrapers/timeout.js
// Scrapes TimeOut NYC events via JSON-LD and og:meta tags.
// TimeOut has curated editorial events with good descriptions and images.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'timeout';
const DELAY_MS = 2000;
const BASE_URL = 'https://www.timeout.com';

const BROWSE_URLS = [
  'https://www.timeout.com/newyork/events',
  'https://www.timeout.com/newyork/things-to-do',
  'https://www.timeout.com/newyork/music',
  'https://www.timeout.com/newyork/art',
  'https://www.timeout.com/newyork/food-and-drink',
  'https://www.timeout.com/newyork/nightlife',
];

function normalizeTimeOutEvent(raw, sourceUrl) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || '';
    const description = cleanDescription(descRaw);

    // TimeOut sometimes has date ranges
    const dateStr = raw.startDate || raw.date || raw.dateTime;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    // Location
    const loc = raw.location || raw.address || {};
    const venueAddress = typeof loc === 'string'
      ? loc
      : [loc.streetAddress, loc.addressLocality, loc.addressRegion, loc.postalCode].filter(Boolean).join(', ');

    const zipcode = (typeof loc === 'object' && loc.postalCode) || extractZip(venueAddress);
    const borough = getBorough(zipcode, venueAddress) || 'Manhattan';

    // Default NYC for TimeOut NYC articles
    if (venueAddress && !isNYCAddress(zipcode, venueAddress)) return null;

    const price = detectPrice(raw.offers?.price, description);

    const photos = [];
    const img = raw.image?.url || raw.image || raw.thumbnailUrl || '';
    if (img && typeof img === 'string' && img.startsWith('http')) photos.push(img);

    const eventUrl = raw.url || raw['@id'] || sourceUrl || '';
    const eventId = raw['@id']?.split('/').filter(Boolean).pop() ||
      makeHashId(name, dateInfo.event_date, venueAddress);
    const externalId = makeExternalId(SOURCE_SITE, eventId);

    const { emoji, color } = assignEmojiAndColor(name, description);

    return {
      event_name: name.trim(),
      description,
      price_category: price,
      location_data: {
        city: borough,
        address: venueAddress || 'New York, NY',
        zipcode,
        lat: parseFloat(loc?.latitude || loc?.geo?.latitude) || null,
        lng: parseFloat(loc?.longitude || loc?.geo?.longitude) || null,
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

  // Strategy 1: JSON-LD (TimeOut uses schema.org Events)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const items = data['@type'] === 'ItemList'
        ? (data.itemListElement || []).map(i => i.item || i)
        : data['@type'] === 'Event' ? [data] : [];

      items.forEach(item => {
        const ev = normalizeTimeOutEvent(item, sourceUrl);
        if (ev) results.push(ev);
      });
    } catch { /* skip */ }
  });

  // Strategy 2: __NEXT_DATA__ (TimeOut also uses Next.js)
  if (results.length === 0) {
    const nextDataEl = $('script#__NEXT_DATA__').first();
    if (nextDataEl.length) {
      try {
        const nextData = JSON.parse(nextDataEl.html() || '{}');
        const props = nextData?.props?.pageProps;
        const eventsList =
          props?.events ||
          props?.articles ||
          props?.items ||
          props?.data?.events ||
          [];

        for (const raw of eventsList) {
          if (!raw) continue;
          const ev = normalizeTimeOutEvent({
            name: raw.name || raw.title,
            description: raw.description || raw.teaser,
            startDate: raw.startDate || raw.dates?.[0]?.startDate,
            url: raw.url ? `${BASE_URL}${raw.url}` : null,
            image: raw.image?.src || raw.heroImage,
            location: raw.location || raw.venue,
          }, sourceUrl);
          if (ev) results.push(ev);
        }
      } catch { /* skip */ }
    }
  }

  // Strategy 3: Article cards with og:meta data (single page listing)
  if (results.length === 0) {
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDesc = $('meta[property="og:description"]').attr('content');
    const ogImg = $('meta[property="og:image"]').attr('content');

    if (ogTitle && sourceUrl.includes('/newyork/') && !sourceUrl.endsWith('/events') && !sourceUrl.endsWith('/newyork')) {
      const dateMatch = $('time').first().attr('datetime');
      const addressText = $('[class*="address"], [class*="venue"], [itemprop="address"]').first().text().trim();

      const dateInfo = dateToUTC(dateMatch || new Date().toISOString());
      if (dateInfo && ogTitle) {
        const zipcode = extractZip(addressText);
        const borough = getBorough(zipcode, addressText) || 'Manhattan';
        const { emoji, color } = assignEmojiAndColor(ogTitle, ogDesc || '');

        results.push({
          event_name: ogTitle.trim(),
          description: cleanDescription(ogDesc || ''),
          price_category: detectPrice(null, ogDesc || ''),
          location_data: { city: borough, address: addressText || 'New York, NY', zipcode, lat: null, lng: null },
          event_date: dateInfo.event_date,
          event_time_utc: dateInfo.event_time_utc,
          representative_emoji: emoji,
          hex_color: color,
          photos: ogImg ? [ogImg] : [],
          relevant_links: [sourceUrl],
          borough,
          is_approved: true,
          source_site: SOURCE_SITE,
          source_url: sourceUrl,
          external_id: makeExternalId(SOURCE_SITE, makeHashId(ogTitle, dateInfo.event_date, addressText)),
        });
      }
    }
  }

  return results;
}

export async function scrapeTimeOut() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url);
      if (!res.ok) {
        console.warn(`  TimeOut ${url} → HTTP ${res.status}`);
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
      console.warn(`  TimeOut scrape error: ${err.message}`);
    }
  }

  return allEvents;
}
