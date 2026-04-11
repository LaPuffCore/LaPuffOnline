// scrapers/meetup.js
// Scrapes Meetup.com NYC events via their __NEXT_DATA__ embedded JSON.
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'meetup';
const DELAY_MS = 2500;

const BROWSE_URLS = [
  'https://www.meetup.com/find/?location=us--ny--New+York&source=EVENTS&sortField=DATETIME',
  'https://www.meetup.com/find/events/?allMeetups=false&keywords=&radius=5&userFreeform=New+York%2C+NY&mcId=z10004&change=yes&eventFilter=mysugg',
];

function normalizeMeetupEvent(raw) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || raw.shortDescription || '';
    const description = cleanDescription(descRaw);

    // Date/time
    const dateStr = raw.dateTime || raw.eventTime || raw.time;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(typeof dateStr === 'number' ? new Date(dateStr).toISOString() : dateStr);
    if (!dateInfo) return null;

    // Location — only in-person events
    const venue = raw.venue || raw.eventHosts?.[0] || null;
    if (!venue && raw.isOnline) return null; // Skip online-only events

    let address = '';
    let zipcode = null;
    let lat = null;
    let lng = null;

    if (venue) {
      address = [
        venue.address || venue.address1 || '',
        venue.city || '',
        venue.state || '',
        venue.zip || venue.zipCode || '',
      ].filter(Boolean).join(', ');
      zipcode = venue.zip || venue.zipCode || extractZip(address);
      lat = parseFloat(venue.lat) || null;
      lng = parseFloat(venue.lng) || null;
    }

    if (!address && !raw.isOnline) {
      address = 'New York, NY';
    }

    // NYC check
    if (!isNYCAddress(zipcode, address)) return null;

    const borough = getBorough(zipcode, address) || 'Manhattan';
    const price = detectPrice(raw.feeSettings?.fee?.amount || raw.fee?.amount, description);

    const photos = [];
    const img = raw.featuredEventPhoto?.highResUrl || raw.featuredEventPhoto?.photo_link || raw.group?.keyPhoto?.highResUrl;
    if (img) photos.push(img);

    const eventUrl = raw.eventUrl || raw.link || '';
    const eventId = raw.id || raw.eventId || makeHashId(name, dateInfo.event_date, address);
    const externalId = makeExternalId(SOURCE_SITE, String(eventId));

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

function extractFromHTML(html) {
  const $ = cheerioLoad(html);
  const results = [];

  // Primary: __NEXT_DATA__ embedded JSON
  const nextDataEl = $('script#__NEXT_DATA__').first();
  if (nextDataEl.length) {
    try {
      const nextData = JSON.parse(nextDataEl.html() || '{}');
      const props = nextData?.props?.pageProps;

      // Meetup stores events in various shapes depending on the page
      const eventsList =
        props?.events ||
        props?.searchResult?.edges?.map(e => e?.node?.result) ||
        props?.initialProps?.events ||
        [];

      for (const raw of eventsList) {
        if (!raw) continue;
        const ev = normalizeMeetupEvent(raw);
        if (ev) results.push(ev);
      }
    } catch { /* skip */ }
  }

  // Fallback: JSON-LD
  if (results.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        if (data['@type'] === 'Event') {
          const ev = normalizeMeetupEvent({
            name: data.name,
            description: data.description,
            dateTime: data.startDate,
            venue: data.location ? {
              address: data.location.streetAddress,
              city: data.location.addressLocality,
              state: data.location.addressRegion,
              zip: data.location.postalCode,
            } : null,
            eventUrl: data.url,
            id: data['@id'],
          });
          if (ev) results.push(ev);
        }
      } catch { /* skip */ }
    });
  }

  return results;
}

export async function scrapeMeetup() {
  const allEvents = [];
  const seenIds = new Set();

  for (const url of BROWSE_URLS) {
    try {
      await sleep(DELAY_MS);
      const res = await httpGet(url);
      if (!res.ok) {
        console.warn(`  Meetup ${url} → HTTP ${res.status}`);
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
      console.warn(`  Meetup scrape error: ${err.message}`);
    }
  }

  return allEvents;
}
