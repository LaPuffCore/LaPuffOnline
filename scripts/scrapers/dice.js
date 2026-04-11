// scrapers/dice.js
// Dice.fm NYC music/nightlife events — tries public API then falls back to JSON-LD scraping.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'dice';
const DELAY_MS = 2000;
const BASE_URL = 'https://dice.fm';

// Correct browse URLs for Dice.fm NYC
// The city slug is dynamic — we discover it from the browse redirect then append categories
const BROWSE_BASE = 'https://dice.fm/browse';
const DICE_CATEGORIES = ['music/gig', 'music/dj', 'music/party', 'culture/social', 'culture/film'];

function normalizeDiceEvent(raw, sourceUrl) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || raw.lineup_details || '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.date || raw.eventDate || raw.startDate;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

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

    const eventPath = raw.url || raw.link || sourceUrl || '';
    const eventUrl = eventPath.startsWith('http') ? eventPath : `${BASE_URL}${eventPath}`;
    const externalId = makeExternalId(SOURCE_SITE, String(raw.id || raw.slug || makeHashId(name, dateInfo.event_date, address)));

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

function extractFromHTML(html, sourceUrl) {
  const $ = cheerioLoad(html);
  const results = [];

  // JSON-LD (MusicEvent or Event)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(data) ? data :
        data['@type'] === 'ItemList' ? (data.itemListElement || []).map(i => i.item || i) :
        (data['@type'] === 'MusicEvent' || data['@type'] === 'Event') ? [data] : [];
      items.forEach(item => {
        const ev = normalizeDiceEvent({
          name: item.name,
          description: item.description,
          date: item.startDate,
          venue: item.location ? {
            address: item.location.streetAddress,
            city: item.location.addressLocality,
            postal_code: item.location.postalCode,
          } : null,
          url: item.url,
          id: item['@id'],
          image: item.image,
        }, sourceUrl);
        if (ev) results.push(ev);
      });
    } catch { /* skip */ }
  });

  // __NEXT_DATA__ fallback
  if (results.length === 0) {
    const nextDataEl = $('script#__NEXT_DATA__').first();
    if (nextDataEl.length) {
      try {
        const nextData = JSON.parse(nextDataEl.html() || '{}');
        const props = nextData?.props?.pageProps;
        const eventsList = props?.events || props?.data?.events || props?.listing?.events || [];
        for (const raw of eventsList) {
          if (!raw) continue;
          const ev = normalizeDiceEvent(raw, sourceUrl);
          if (ev) results.push(ev);
        }
      } catch { /* skip */ }
    }
  }

  return results;
}

export async function scrapeDice() {
  const allEvents = [];
  const seenIds = new Set();

  // Step 1: Follow the browse redirect to discover the NYC city slug
  let nycSlug = null;
  try {
    const res = await httpGet(`${BROWSE_BASE}?city=new-york`, { Referer: 'https://dice.fm/' });
    const finalUrl = res.url || '';
    // finalUrl should be like https://dice.fm/browse/newyork-XXXXXXXX
    const match = finalUrl.match(/\/browse\/([a-z0-9-]+)/);
    if (match) nycSlug = match[1];
  } catch { /* ignore */ }

  // Only proceed if the slug actually looks like a NYC city (IP-based redirect may send us elsewhere)
  if (!nycSlug || (!nycSlug.includes('york') && !nycSlug.includes('nyc'))) {
    console.warn(`  Dice: NYC city slug not found (got: ${nycSlug || 'none'}) — skipping`);
    return [];
  }

  const BROWSE_URLS = [BROWSE_BASE + '/' + nycSlug, ...DICE_CATEGORIES.map(c => `${BROWSE_BASE}/${nycSlug}/${c}`)];

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url, { Referer: 'https://dice.fm/' });
      if (!res.ok) {
        console.warn(`  Dice ${url} → HTTP ${res.status}`);
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

      if (allEvents.length > 20) break;
    } catch (err) {
      console.warn(`  Dice scrape error: ${err.message}`);
    }
  }

  return allEvents;
}

