// scrapers/luma.js
// Scrapes lu.ma/nyc — Luma's NYC city page has __NEXT_DATA__ with 20+ events.
// High-quality social/tech/cultural events with full addresses, coordinates, images, and ticket info.
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'luma';
const DELAY_MS = 2000;

// lu.ma/nyc is the NYC city page — lu.ma/new-york redirects to a single event (wrong)
const BROWSE_URLS = [
  'https://lu.ma/nyc',
];

function normalizeEvent(entry) {
  try {
    const ev = entry.event || entry;
    const name = ev.name || '';
    if (!name) return null;

    const dateStr = ev.start_at || ev.startDate;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    const descRaw = ev.description || ev.description_short || '';
    const description = cleanDescription(descRaw);

    // Address from geo_address_info
    const geoAddr = ev.geo_address_info || {};
    const fullAddress = geoAddr.full_address || '';
    const address = fullAddress ||
      [geoAddr.address, geoAddr.city, geoAddr.region].filter(Boolean).join(', ') ||
      'New York, NY';

    const zipcode = geoAddr.postal_code || extractZip(address);
    const coord = ev.coordinate || {};
    const lat = parseFloat(coord.latitude) || null;
    const lng = parseFloat(coord.longitude) || null;

    // NYC validation — accept events with NYC address, zip, or coords
    const nycByCoords = lat && lng && lat >= 40.4 && lat <= 41.0 && lng >= -74.3 && lng <= -73.6;
    if (!isNYCAddress(zipcode, address) && !nycByCoords) return null;
    const borough = getBorough(zipcode, address) || 'Manhattan';

    // Price from ticket info
    const ticketInfo = entry.ticket_info || {};
    let priceVal = null;
    if (ticketInfo.is_free) {
      priceVal = 0;
    } else if (ticketInfo.price?.cents) {
      priceVal = ticketInfo.price.cents / 100;
    }
    const price = detectPrice(priceVal, description);

    const { emoji, color } = assignEmojiAndColor(name, description);

    // Cover image from Luma CDN
    const photos = [];
    const coverUrl = ev.cover_url || ev.social_image_url || '';
    if (coverUrl && coverUrl.startsWith('http')) photos.push(coverUrl);

    // Event URL from slug
    const slug = ev.url || ev.slug || '';
    const eventUrl = slug.startsWith('http') ? slug : `https://lu.ma/${slug}`;
    const eventId = ev.api_id || ev.id || makeHashId(name, dateInfo.event_date, address);
    const externalId = makeExternalId(SOURCE_SITE, String(eventId));

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

export async function scrapeLuma() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url, {
        Referer: 'https://lu.ma/',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      });

      if (!res.ok) {
        console.warn(`  Luma ${url} → HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();

      // Extract __NEXT_DATA__ JSON blob
      const ndStart = html.indexOf('__NEXT_DATA__');
      if (ndStart === -1) {
        console.warn('  Luma: no __NEXT_DATA__ found');
        continue;
      }
      const jsonStart = html.indexOf('{', ndStart);
      const scriptEnd = html.indexOf('</script>', ndStart);
      if (jsonStart === -1 || scriptEnd === -1) continue;

      const nextData = JSON.parse(html.slice(jsonStart, scriptEnd));
      const initialData = nextData?.props?.pageProps?.initialData?.data ||
                          nextData?.props?.pageProps?.data || {};

      // Combine events + featured_events arrays
      const eventEntries = [
        ...(initialData.events || []),
        ...(initialData.featured_events || []),
      ];

      for (const entry of eventEntries) {
        const ev = normalizeEvent(entry);
        if (ev && !seenIds.has(ev.external_id)) {
          seenIds.add(ev.external_id);
          allEvents.push(ev);
        }
      }
    } catch (err) {
      console.warn(`  Luma error: ${err.message}`);
    }
  }

  return allEvents;
}
