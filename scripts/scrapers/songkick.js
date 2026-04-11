// scrapers/songkick.js
// Songkick NYC concert listings — scrapes their metro area events page.
// Songkick covers thousands of concerts and has structured data in their HTML.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'songkick';
const BASE_URL = 'https://www.songkick.com';
const DELAY_MS = 2000;

// NYC metro area ID = 7644
const PAGES = [
  'https://www.songkick.com/metro_areas/7644-us-ny-new-york/calendar',
  // Pages 2+ return HTTP 406 from non-browser environments — only page 1 accessible
];

function normalizeEvent(raw, sourceUrl) {
  try {
    const name = raw.displayName || raw.name || '';
    if (!name) return null;

    const dateStr = raw.start?.datetime || raw.start?.date;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    const venue = raw.venue || {};
    const venueName = venue.displayName || venue.name || '';
    const location = venue.metroArea?.displayName || 'New York';
    let address = venueName ? `${venueName}, New York, NY` : 'New York, NY';
    const zipcode = venue.zip || extractZip(address);
    const lat = parseFloat(venue.lat) || null;
    const lng = parseFloat(venue.lng) || null;
    const borough = getBorough(zipcode, address) || 'Manhattan';

    const eventUri = raw.uri || '';
    const eventUrl = eventUri.startsWith('http') ? eventUri : `${BASE_URL}${eventUri}`;
    const eventId = String(raw.id || makeHashId(name, dateInfo.event_date, address));
    const externalId = makeExternalId(SOURCE_SITE, eventId);

    const description = raw.type === 'Concert'
      ? `Live music at ${venueName || 'NYC venue'}.`
      : cleanDescription(raw.description || '');

    const price = detectPrice(null, description);
    const { emoji, color } = assignEmojiAndColor(name, description);

    const photos = [];
    const img = raw.coverImageUrl || raw.imageUrl || '';
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

function extractFromHTML(html, sourceUrl) {
  const $ = cheerioLoad(html);
  const results = [];

  // Songkick embeds event data in a <script> as window.sk_page_data or similar
  $('script:not([src])').each((_, el) => {
    const text = $(el).html() || '';
    // Look for resultsPage embedded JSON
    const match = text.match(/SK\.page_data\s*=\s*(\{.+?\});\s*(?:SK\.|<)/s) ||
                  text.match(/window\.SK_INITIAL_DATA\s*=\s*(\{.+?\});/s) ||
                  text.match(/"resultsPage"\s*:\s*(\{.+?"totalEntries":\d+.+?\})\s*[,}]/s);
    if (!match) return;
    try {
      const raw = JSON.parse(match[1]);
      const events =
        raw?.resultsPage?.results?.event ||
        raw?.data?.resultsPage?.results?.event ||
        raw?.events ||
        [];
      for (const ev of events) {
        const norm = normalizeEvent(ev, sourceUrl);
        if (norm) results.push(norm);
      }
    } catch { /* skip */ }
  });

  // JSON-LD fallback
  if (results.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        const items = Array.isArray(data) ? data :
          data['@type'] === 'ItemList' ? (data.itemListElement || []).map(i => i.item || i) :
          (data['@type'] === 'MusicEvent' || data['@type'] === 'Event') ? [data] : [];
        items.forEach(item => {
          const ev = normalizeEvent({
            displayName: item.name,
            description: item.description,
            start: { datetime: item.startDate },
            venue: item.location ? {
              displayName: item.location.name,
              zip: item.location.postalCode,
              lat: item.location.geo?.latitude,
              lng: item.location.geo?.longitude,
            } : null,
            uri: item.url,
            id: item['@id'],
            coverImageUrl: item.image?.url || item.image,
          }, sourceUrl);
          if (ev) results.push(ev);
        });
      } catch { /* skip */ }
    });
  }

  // Fallback: HTML microdata event cards
  if (results.length === 0) {
    $('[itemtype*="MusicEvent"], [itemtype*="Event"]').each((_, el) => {
      try {
        const $el = $(el);
        const name = $el.find('[itemprop="name"]').first().text().trim();
        const dateStr = $el.find('[itemprop="startDate"]').first().attr('content') ||
                        $el.find('time').first().attr('datetime');
        const venue = $el.find('[itemprop="location"] [itemprop="name"]').first().text().trim();
        const link = $el.find('a[href*="/concerts/"]').first().attr('href') || '';
        if (!name || !dateStr) return;

        const dateInfo = dateToUTC(dateStr);
        if (!dateInfo) return;

        const address = venue ? `${venue}, New York, NY` : 'New York, NY';
        const eventUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
        const { emoji, color } = assignEmojiAndColor(name, '');
        results.push({
          event_name: name,
          description: `Live music at ${venue || 'NYC venue'}.`,
          price_category: '$',
          location_data: { city: 'Manhattan', address, zipcode: null, lat: null, lng: null },
          event_date: dateInfo.event_date,
          event_time_utc: dateInfo.event_time_utc,
          representative_emoji: emoji,
          hex_color: color,
          photos: [],
          relevant_links: [eventUrl],
          borough: 'Manhattan',
          is_approved: true,
          source_site: SOURCE_SITE,
          source_url: eventUrl,
          external_id: makeExternalId(SOURCE_SITE, makeHashId(name, dateInfo.event_date, address)),
        });
      } catch { /* skip */ }
    });
  }

  return results;
}

export async function scrapeSongkick() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of PAGES) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url, { Referer: 'https://www.songkick.com/' });
      if (!res.ok) {
        console.warn(`  Songkick ${url} → HTTP ${res.status}`);
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
      console.warn(`  Songkick scrape error: ${err.message}`);
    }
  }

  return allEvents;
}
