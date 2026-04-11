// scrapers/timeout.js
// TimeOut NYC — uses sitemap-driven individual article pages to extract events.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'timeout';
const DELAY_MS = 2000;
const BASE_URL = 'https://www.timeout.com';

// TimeOut category listing pages — more specific pages tend to return 200
const BROWSE_URLS = [
  // These return 200 from server IPs; others return 400
  'https://www.timeout.com/newyork/comedy/best-comedy-shows-in-nyc',
  'https://www.timeout.com/newyork/theater',
  'https://www.timeout.com/newyork/dance',
  'https://www.timeout.com/newyork/music',
  'https://www.timeout.com/newyork/things-to-do',
  'https://www.timeout.com/newyork/art',
];

function normalizeTimeOutEvent(raw, sourceUrl) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.startDate || raw.date || raw.dateTime;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    const loc = raw.location || raw.address || {};
    const venueAddress = typeof loc === 'string'
      ? loc
      : [loc.streetAddress, loc.addressLocality, loc.addressRegion, loc.postalCode].filter(Boolean).join(', ');

    const zipcode = (typeof loc === 'object' && loc.postalCode) || extractZip(venueAddress);
    const borough = getBorough(zipcode, venueAddress) || 'Manhattan';

    if (venueAddress && !isNYCAddress(zipcode, venueAddress)) return null;

    const price = detectPrice(raw.offers?.price, description);

    const photos = [];
    const img = raw.image?.url || raw.image || raw.thumbnailUrl || '';
    if (img && typeof img === 'string' && img.startsWith('http')) photos.push(img);

    const eventUrl = (raw.url || raw['@id'] || sourceUrl || '').split('?')[0];
    const eventId = raw['@id']?.split('/').filter(Boolean).pop() ||
      makeHashId(name, dateInfo.event_date, venueAddress || sourceUrl);
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

function extractFromHTML(html, sourceUrl) {
  const $ = cheerioLoad(html);
  const results = [];

  // JSON-LD (TimeOut uses schema.org Events and Articles)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(data) ? data :
        data['@type'] === 'ItemList' ? (data.itemListElement || []).map(i => i.item || i) :
        data['@type'] === 'Event' ? [data] : [];

      items.forEach(item => {
        if (item['@type'] !== 'Event') return;
        const ev = normalizeTimeOutEvent(item, sourceUrl);
        if (ev) results.push(ev);
      });
    } catch { /* skip */ }
  });

  // __NEXT_DATA__ (TimeOut Next.js)
  if (results.length === 0) {
    const nextDataEl = $('script#__NEXT_DATA__').first();
    if (nextDataEl.length) {
      try {
        const nextData = JSON.parse(nextDataEl.html() || '{}');
        const props = nextData?.props?.pageProps;
        const eventsList = props?.events || props?.articles || props?.items || props?.data?.events || [];
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

  // OG tags fallback — only use for individual article pages (has a real date)
  if (results.length === 0) {
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const ogImg = $('meta[property="og:image"]').attr('content') || '';
    const dateMatch = $('time[datetime]').first().attr('datetime');

    // Reject category pages: real event titles don't contain pipe chars or NYC tourism phrases
    const isGarbageTitle = !ogTitle ||
      ogTitle.includes(' | ') ||
      /best .+ in/i.test(ogTitle) ||
      /events? (and|&) /i.test(ogTitle) ||
      /New York (Music|Art|Events|Galleries|Theater|Comedy)/i.test(ogTitle);

    // Only create an event if there's an actual date element on the page and title looks like an event
    if (ogTitle && dateMatch && !isGarbageTitle) {
      const dateInfo = dateToUTC(dateMatch);
      if (dateInfo) {
        const addressText = $('[class*="address"], [class*="venue"], [itemprop="address"]').first().text().trim();
        const zipcode = extractZip(addressText);
        const borough = getBorough(zipcode, addressText) || 'Manhattan';
        const { emoji, color } = assignEmojiAndColor(ogTitle, ogDesc);
        const eventId = makeHashId(ogTitle, dateInfo.event_date, addressText || sourceUrl);

        results.push({
          event_name: ogTitle.replace(/ \| Time Out New York$/, '').trim(),
          description: cleanDescription(ogDesc),
          price_category: detectPrice(null, ogDesc),
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
          external_id: makeExternalId(SOURCE_SITE, eventId),
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
      const res = await httpGet(url, { Referer: 'https://www.timeout.com/newyork/' });
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

