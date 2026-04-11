// scrapers/ra.js
// Resident Advisor — switches to their public GraphQL API instead of HTML scraping.
// RA is NYC's most comprehensive music/nightlife event listing.
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'ra';
const BASE_URL = 'https://ra.co';
const GRAPHQL_URL = 'https://ra.co/graphql';
// RA area ID 13 = New York, area ID 18 = Brooklyn (both covered under NYC)
const NYC_AREA_IDS = [13];

// GraphQL query for event listings
const EVENTS_QUERY = `
  query GetListings($areaIds: [ID!]!, $startDate: String!, $endDate: String!) {
    listing(
      filters: { areas: { in: $areaIds }, listingDate: { gte: $startDate, lte: $endDate } }
      pageSize: 100
    ) {
      data {
        id
        title
        date
        startTime
        contentUrl
        images { filename type }
        venue {
          name
          address
          area { name }
          postalCode
          lat
          lng
        }
        cost
        lineup { displayName }
      }
    }
  }
`;

function normalizeRAEvent(raw) {
  try {
    const name = raw.title || raw.name || '';
    if (!name) return null;

    const lineupNames = (raw.lineup || []).map(l => l.displayName).filter(Boolean).join(', ');
    const descRaw = lineupNames ? `Lineup: ${lineupNames}` : '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.date || raw.startDate;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

    const venue = raw.venue || {};
    let address = venue.address || '';
    if (!address && venue.name) address = `${venue.name}, New York, NY`;
    let zipcode = venue.postalCode || extractZip(address);
    let lat = parseFloat(venue.lat) || null;
    let lng = parseFloat(venue.lng) || null;

    // RA NYC events are definitionally NYC — accept them without strict ZIP check
    const borough = getBorough(zipcode, address) || 'Manhattan';

    const priceVal = raw.cost;
    const price = detectPrice(priceVal, description);

    const photos = [];
    const img = (raw.images || []).find(i => i.type === 'flyer' || i.filename)?.filename;
    if (img) {
      const imgUrl = img.startsWith('http') ? img : `https://ra.co${img}`;
      photos.push(imgUrl);
    }

    const eventPath = raw.contentUrl || '';
    const eventUrl = eventPath.startsWith('http') ? eventPath : `${BASE_URL}${eventPath}`;
    const externalId = makeExternalId(SOURCE_SITE, String(raw.id || makeHashId(name, dateInfo.event_date, address)));

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

export async function scrapeRA() {
  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + 180 * 86400000).toISOString().slice(0, 10);

  const allEvents = [];
  const seenIds = new Set();

  for (const areaId of NYC_AREA_IDS) {
    try {
      await sleep(2000);
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://ra.co',
          'Referer': 'https://ra.co/events/us/newyork',
        },
        body: JSON.stringify({
          query: EVENTS_QUERY,
          variables: { areaIds: [String(areaId)], startDate, endDate },
        }),
      });

      if (!res.ok) {
        console.warn(`  RA GraphQL area ${areaId} → HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const events = json?.data?.listing?.data || [];

      for (const raw of events) {
        if (!raw) continue;
        const ev = normalizeRAEvent(raw);
        if (!ev || seenIds.has(ev.external_id)) continue;
        seenIds.add(ev.external_id);
        allEvents.push(ev);
      }
    } catch (err) {
      console.warn(`  RA GraphQL error (area ${areaId}): ${err.message}`);
    }
  }

  return allEvents;
}

