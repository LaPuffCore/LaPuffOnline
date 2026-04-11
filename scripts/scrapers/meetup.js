// scrapers/meetup.js
// Meetup.com NYC events via their public GraphQL API.
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'meetup';
const GRAPHQL_URL = 'https://api.meetup.com/gql2';

// Lat/lng center points for each NYC borough + radius
const SEARCH_POINTS = [
  { name: 'Manhattan', lat: 40.7831, lon: -73.9712 },
  { name: 'Brooklyn', lat: 40.6782, lon: -73.9442 },
  { name: 'Queens', lat: 40.7282, lon: -73.7949 },
  { name: 'Bronx', lat: 40.8448, lon: -73.8648 },
];

const SEARCH_QUERY = `
  query SearchEvents($lat: Float!, $lon: Float!) {
    keywordSearch(
      input: { first: 60, query: "" }
      filter: { lat: $lat, lon: $lon, radius: 12, source: EVENTS, startDateRange: "TODAY" }
    ) {
      edges {
        node {
          result {
            ... on Event {
              id
              title
              dateTime
              eventUrl
              isOnline
              venue {
                address
                city
                state
                postalCode
                lat
                lng
              }
              group { name }
              description
              feeSettings { fee { amount } }
              featuredEventPhoto { highResUrl }
            }
          }
        }
      }
    }
  }
`;

function normalizeMeetupEvent(raw) {
  try {
    const name = raw.title || raw.name || '';
    if (!name) return null;
    if (raw.isOnline) return null;

    const descRaw = raw.description || raw.shortDescription || '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.dateTime || raw.eventTime;
    if (!dateStr) return null;
    const dateInfo = dateToUTC(typeof dateStr === 'number' ? new Date(dateStr).toISOString() : dateStr);
    if (!dateInfo) return null;

    const venue = raw.venue || {};
    let address = [
      venue.address || venue.address1 || '',
      venue.city || '',
      venue.state || '',
      venue.postalCode || venue.zip || '',
    ].filter(Boolean).join(', ');
    const zipcode = venue.postalCode || venue.zip || extractZip(address);
    const lat = parseFloat(venue.lat) || null;
    const lng = parseFloat(venue.lng) || null;

    if (!address) address = 'New York, NY';
    if (!isNYCAddress(zipcode, address)) return null;

    const borough = getBorough(zipcode, address) || 'Manhattan';
    const price = detectPrice(raw.feeSettings?.fee?.amount, description);

    const photos = [];
    const img = raw.featuredEventPhoto?.highResUrl;
    if (img) photos.push(img);

    const eventUrl = raw.eventUrl || '';
    const externalId = makeExternalId(SOURCE_SITE, String(raw.id || makeHashId(name, dateInfo.event_date, address)));

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

export async function scrapeMeetup() {
  const allEvents = [];
  const seenIds = new Set();

  for (const point of SEARCH_POINTS) {
    try {
      await sleep(2000);
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://www.meetup.com',
          'Referer': 'https://www.meetup.com/',
        },
        body: JSON.stringify({ query: SEARCH_QUERY, variables: { lat: point.lat, lon: point.lon } }),
      });

      if (!res.ok) {
        console.warn(`  Meetup GraphQL (${point.name}) → HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const edges = json?.data?.keywordSearch?.edges || [];

      for (const edge of edges) {
        const raw = edge?.node?.result;
        if (!raw) continue;
        const ev = normalizeMeetupEvent(raw);
        if (!ev || seenIds.has(ev.external_id)) continue;
        seenIds.add(ev.external_id);
        allEvents.push(ev);
      }
    } catch (err) {
      console.warn(`  Meetup GraphQL error (${point.name}): ${err.message}`);
    }
  }

  return allEvents;
}

