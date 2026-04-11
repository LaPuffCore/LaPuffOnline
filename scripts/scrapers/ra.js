// scrapers/ra.js
// Scrapes Resident Advisor NYC events page via __NEXT_DATA__ embedded JSON.
// RA is NYC's most comprehensive music/nightlife event listing.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'ra';
const DELAY_MS = 2000;
const BASE_URL = 'https://ra.co';

const BROWSE_URLS = [
  'https://ra.co/events/us/newyork',
  'https://ra.co/events/us/newyork?page=2',
];

function normalizeRAEvent(raw) {
  try {
    const name = raw.title || raw.name || '';
    if (!name) return null;

    const descRaw = raw.contentUrl || raw.description || raw.blurb || '';
    const description = cleanDescription(descRaw);

    // Date/time — RA uses ISO strings with offset
    const dateStr = raw.date || raw.startTime || raw.startDate;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    // Venue / location
    const venue = raw.venue || raw.club || raw.location || {};
    let address = venue.address || venue.fullAddress || '';
    let zipcode = venue.postalCode || extractZip(address);
    let lat = parseFloat(venue.lat || venue.latitude) || null;
    let lng = parseFloat(venue.lng || venue.longitude) || null;

    if (!address && venue.name) {
      address = `${venue.name}, New York, NY`;
    }

    if (!isNYCAddress(zipcode, address)) return null;

    const borough = getBorough(zipcode, address) || 'Manhattan';

    // RA events are almost always ticketed
    const priceVal = raw.minimumCost || raw.ticketPrice || raw.cost;
    const price = detectPrice(priceVal, description);

    // Image
    const photos = [];
    const img = raw.flyer?.image?.url || raw.images?.[0]?.url || raw.image || '';
    if (img && typeof img === 'string') {
      photos.push(img.startsWith('http') ? img : `${BASE_URL}${img}`);
    }

    const eventPath = raw.contentUrl || raw.href || raw.url || '';
    const eventUrl = eventPath.startsWith('http') ? eventPath : `${BASE_URL}${eventPath}`;
    const eventId = raw.id || raw.contentId || makeHashId(name, dateInfo.event_date, address);
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

  // RA uses Next.js: look for __NEXT_DATA__
  const nextDataEl = $('script#__NEXT_DATA__').first();
  if (nextDataEl.length) {
    try {
      const nextData = JSON.parse(nextDataEl.html() || '{}');
      const props = nextData?.props?.pageProps;

      const eventsList =
        props?.listing?.events ||
        props?.events ||
        props?.data?.listing?.events ||
        props?.initialData?.events ||
        [];

      for (const raw of eventsList) {
        if (!raw) continue;
        const ev = normalizeRAEvent(raw);
        if (ev) results.push(ev);
      }
    } catch { /* skip */ }
  }

  // Fallback: JSON-LD
  if (results.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        const items = data['@type'] === 'ItemList'
          ? (data.itemListElement || []).map(i => i.item || i)
          : data['@type'] === 'Event' ? [data] : [];

        items.forEach(item => {
          const ev = normalizeRAEvent({
            name: item.name,
            description: item.description,
            date: item.startDate,
            venue: item.location ? {
              address: item.location.streetAddress,
              postalCode: item.location.postalCode,
              lat: item.location.geo?.latitude,
              lng: item.location.geo?.longitude,
            } : null,
            contentUrl: item.url,
            id: item['@id'],
            image: item.image,
          });
          if (ev) results.push(ev);
        });
      } catch { /* skip */ }
    });
  }

  return results;
}

export async function scrapeRA() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url);
      if (!res.ok) {
        console.warn(`  RA ${url} → HTTP ${res.status}`);
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
      console.warn(`  RA scrape error: ${err.message}`);
    }
  }

  return allEvents;
}
