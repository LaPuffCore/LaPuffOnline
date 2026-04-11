// scrapers/eventbrite.js
// Scrapes Eventbrite NYC browse & category pages.
// Strategy: Extract JSON-LD from page source, then fall back to
//           parsing embedded __SERVER_DATA__ JSON blobs.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress, isNYCZip } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'eventbrite';
const DELAY_MS = 2000;

// Category pages to scrape — each yields different event types for volume
const BROWSE_URLS = [
  'https://www.eventbrite.com/d/ny--new-york/events/',
  'https://www.eventbrite.com/d/ny--new-york/music--events/',
  'https://www.eventbrite.com/d/ny--new-york/food-and-drink--events/',
  'https://www.eventbrite.com/d/ny--new-york/arts--events/',
  'https://www.eventbrite.com/d/ny--new-york/community--events/',
  'https://www.eventbrite.com/d/ny--new-york/film-media-and-entertainment--events/',
  'https://www.eventbrite.com/d/ny--new-york/health--events/',
  'https://www.eventbrite.com/d/ny--new-york/sports-and-fitness--events/',
  'https://www.eventbrite.com/d/ny--new-york/science-and-technology--events/',
];

function normalizeEventbriteEvent(raw, sourceUrl) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || raw.summary || '';
    const description = cleanDescription(descRaw);

    // Date/time
    const dateStr = raw.startDate || raw.start_date || raw.start?.utc || raw.starts_at;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    // Location
    let address = '';
    let zipcode = null;
    let lat = null;
    let lng = null;

    if (raw.location) {
      const loc = raw.location;
      address = [
        loc.streetAddress || loc.street_address || '',
        loc.addressLocality || loc.city || '',
        loc.addressRegion || loc.region || '',
        loc.postalCode || loc.postal_code || '',
      ].filter(Boolean).join(', ');
      zipcode = loc.postalCode || loc.postal_code || extractZip(address);
      lat = parseFloat(loc.latitude || loc.lat) || null;
      lng = parseFloat(loc.longitude || loc.lng) || null;
    } else if (raw.venue) {
      const v = raw.venue;
      address = v.address?.localized_address_display ||
        [v.address?.address_1, v.city, v.region, v.postal_code].filter(Boolean).join(', ');
      zipcode = v.postal_code || v.address?.postal_code || extractZip(address);
      lat = parseFloat(v.latitude) || null;
      lng = parseFloat(v.longitude) || null;
    }

    // NYC validation
    if (!isNYCAddress(zipcode, address)) return null;

    const borough = getBorough(zipcode, address) || 'Manhattan';

    // Price
    const priceVal = raw.offers?.price ?? raw.ticket_availability?.minimum_ticket_price?.major_value ?? null;
    const price = detectPrice(priceVal, description);

    // Image
    const photos = [];
    const imgUrl = raw.image?.url || raw.logo?.url || raw.image || '';
    if (imgUrl && typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
      photos.push(imgUrl);
    }

    // Link
    const eventUrl = raw.url || raw['@id'] || sourceUrl || '';

    // External ID from Eventbrite event ID (in URL or raw.id)
    let eventId = raw['@id']?.split('/')?.find(s => /^\d{10,}$/.test(s)) ||
      raw.id || raw.event_id ||
      eventUrl.match(/\/e\/[^/]+-(\d+)/)?.[1];
    const externalId = eventId
      ? makeExternalId(SOURCE_SITE, eventId)
      : makeExternalId(SOURCE_SITE, makeHashId(name, dateInfo.event_date, address));

    const { emoji, color } = assignEmojiAndColor(name, description);

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

/**
 * Extract events from an Eventbrite browse page HTML.
 * Tries JSON-LD ItemList first, then __SERVER_DATA__ embedded JSON.
 */
function extractFromHTML(html, sourceUrl) {
  const $ = cheerioLoad(html);
  const results = [];

  // Strategy 1: JSON-LD tags (schema.org Event or ItemList)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const items = data['@type'] === 'ItemList'
        ? (data.itemListElement || []).map(i => i.item || i)
        : data['@type'] === 'Event'
          ? [data]
          : [];
      items.forEach(item => {
        const ev = normalizeEventbriteEvent(item, sourceUrl);
        if (ev) results.push(ev);
      });
    } catch { /* skip malformed */ }
  });

  if (results.length > 0) return results;

  // Strategy 2: Look for embedded JSON blobs in script tags
  $('script:not([src])').each((_, el) => {
    const text = $(el).html() || '';
    if (!text.includes('"events"') && !text.includes('"EventList"') && !text.includes('"start"')) return;

    // Try to find the component data JSON
    const patterns = [
      // window.__SERVER_DATA__ = {...}
      /window\.__SERVER_DATA__\s*=\s*(\{.+\});?\s*(?:<\/script>|window\.)/s,
      // __data__ = {...}
      /__data__\s*=\s*(\{.+?\});/s,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          const eventList =
            data?.components?.EventsByLocation?.events ||
            data?.search?.events ||
            data?.events ||
            [];
          eventList.forEach(raw => {
            const ev = normalizeEventbriteEvent(raw, sourceUrl);
            if (ev) results.push(ev);
          });
        } catch { /* skip */ }
      }
    }
  });

  // Strategy 3: Find event card links and parse what we can from markup
  if (results.length === 0) {
    $('[data-event-id], [data-testid="event-card"], article[class*="event"]').each((_, el) => {
      try {
        const $el = $(el);
        const eventId = $el.attr('data-event-id') || '';
        const name = $el.find('h2, h3, [class*="event-name"], [class*="title"]').first().text().trim();
        const link = $el.find('a[href*="/e/"]').first().attr('href') || '';
        const dateText = $el.find('[class*="date"], time, [datetime]').first().text().trim();
        const location = $el.find('[class*="location"], [class*="venue"], [class*="address"]').first().text().trim();

        if (!name || !link) return;

        const fullLink = link.startsWith('http') ? link : `https://www.eventbrite.com${link}`;
        const dateInfo = dateToUTC(dateText) || dateToUTC(new Date().toISOString());
        const zipcode = extractZip(location);
        const borough = getBorough(zipcode, location) || 'Manhattan';

        if (!isNYCAddress(zipcode, location) && !location.toLowerCase().includes('new york')) return;

        const { emoji, color } = assignEmojiAndColor(name, '');
        const externalId = eventId
          ? makeExternalId(SOURCE_SITE, eventId)
          : makeExternalId(SOURCE_SITE, makeHashId(name, dateInfo?.event_date || '', location));

        results.push({
          event_name: name,
          description: '',
          price_category: '$',
          location_data: { city: borough, address: location || 'New York, NY', zipcode, lat: null, lng: null },
          event_date: dateInfo?.event_date || new Date().toISOString().slice(0, 10),
          event_time_utc: dateInfo?.event_time_utc || null,
          representative_emoji: emoji,
          hex_color: color,
          photos: [],
          relevant_links: [fullLink],
          borough,
          is_approved: true,
          source_site: SOURCE_SITE,
          source_url: fullLink,
          external_id: externalId,
        });
      } catch { /* skip */ }
    });
  }

  return results;
}

export async function scrapeEventbrite() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url);
      if (!res.ok) {
        console.warn(`  Eventbrite ${url} → HTTP ${res.status}`);
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
      console.warn(`  Eventbrite scrape error on ${url}: ${err.message}`);
    }
  }

  return allEvents;
}
