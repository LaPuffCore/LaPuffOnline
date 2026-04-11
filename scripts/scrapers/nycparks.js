// scrapers/nycparks.js
// NYC Parks official RSS feed — most reliable source, no rate limits needed.
// Feed: https://www.nycgovparks.org/events/rss
import Parser from 'rss-parser';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep } from '../utils/normalize.js';
import { getBorough, isNYCAddress } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const FEED_URL = 'https://www.nycgovparks.org/events/rss';
const SOURCE_SITE = 'nycparks';

function parseNYCParksLocation(item) {
  // NYC Parks RSS items have location info in the description or a <location> field
  const descRaw = item.content || item.contentSnippet || item.summary || '';
  const titleRaw = item.title || '';

  // Try to find address patterns in content
  const addrMatch = descRaw.match(/(\d+[^,\n]+(?:Ave|Blvd|St|Dr|Rd|Pkwy|Park|Way|Ln|Place|Pl|Ct|Terrace|Ter)[^,\n,<]*)/i);
  const address = addrMatch ? addrMatch[1].trim() : null;

  // NYC Parks events are always in NYC — extract borough from title or description
  const combined = `${titleRaw} ${descRaw}`.toLowerCase();
  let borough = null;
  if (combined.includes('brooklyn')) borough = 'Brooklyn';
  else if (combined.includes('bronx')) borough = 'Bronx';
  else if (combined.includes('queens')) borough = 'Queens';
  else if (combined.includes('staten island')) borough = 'Staten Island';
  else if (combined.includes('manhattan') || combined.includes('central park') || combined.includes('harlem')) borough = 'Manhattan';

  const zip = address ? extractZip(address) : null;
  if (!borough && zip) borough = getBorough(zip, address);
  if (!borough) borough = 'Manhattan'; // Parks default

  return {
    address: address || 'New York City Parks',
    city: borough,
    zipcode: zip,
  };
}

export async function scrapeNYCParks() {
  const parser = new Parser({
    customFields: {
      item: ['location', 'event:location', 'geo:lat', 'geo:long'],
    },
  });

  let feed;
  try {
    feed = await parser.parseURL(FEED_URL);
  } catch (err) {
    console.warn(`  NYC Parks RSS parse failed: ${err.message}`);
    return [];
  }

  const events = [];
  const now = new Date();

  for (const item of feed.items || []) {
    try {
      // Skip past events
      const pubDate = item.pubDate ? new Date(item.pubDate) : null;
      const dateInfo = dateToUTC(item.pubDate || item.isoDate);
      if (!dateInfo) continue;

      const eventDate = new Date(dateInfo.event_date + 'T00:00:00');
      // Skip events more than 6 months in future or clearly past (>1 day ago)
      if (eventDate < new Date(now.getTime() - 86400000)) continue;
      if (eventDate > new Date(now.getTime() + 180 * 86400000)) continue;

      const title = item.title || '';
      const descRaw = item.contentSnippet || item.summary || item.content || '';
      const description = cleanDescription(descRaw);
      const link = item.link || item.guid || '';

      if (!title || !link) continue;

      const locData = parseNYCParksLocation(item);
      const { emoji, color } = assignEmojiAndColor(title, description);
      const price = detectPrice(null, description);

      const borough = getBorough(locData.zipcode, locData.address) || locData.city;

      // Use link path as external ID
      const urlPath = new URL(link.startsWith('http') ? link : `https://nycgovparks.org${link}`).pathname;
      const externalId = makeExternalId(SOURCE_SITE, urlPath.replace(/\//g, '_').slice(-40));

      events.push({
        event_name: title.trim(),
        description,
        price_category: price,
        location_data: {
          city: borough,
          address: locData.address,
          zipcode: locData.zipcode || null,
          lat: null,
          lng: null,
        },
        event_date: dateInfo.event_date,
        event_time_utc: dateInfo.event_time_utc,
        representative_emoji: emoji,
        hex_color: color,
        photos: [],
        relevant_links: [link],
        borough,
        is_approved: true,
        source_site: SOURCE_SITE,
        source_url: link,
        external_id: externalId,
      });
    } catch (err) {
      // Skip malformed items silently
    }
  }

  return events;
}
