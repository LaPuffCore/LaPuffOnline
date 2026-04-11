// scrapers/eventbrite.js
// Scrapes Eventbrite NYC browse pages.
// Strategy: extract event links via img[alt$=" primary image"] pattern visible in HTML,
// then batch-fetch individual event pages for their JSON-LD (complete structured data).
import { load as cheerioLoad } from 'cheerio';
import { cleanDescription, dateToUTC, makeExternalId, makeHashId, extractZip, sleep, httpGet } from '../utils/normalize.js';
import { getBorough, isNYCAddress, isNYCZip } from '../utils/nyc-validate.js';
import { assignEmojiAndColor } from '../utils/emoji-color.js';
import { detectPrice } from '../utils/price-detect.js';

const SOURCE_SITE = 'eventbrite';
const DELAY_MS = 1500;
const MAX_EVENTS_PER_PAGE = 12; // Limit event-page fetches per category

const BROWSE_URLS = [
  'https://www.eventbrite.com/d/ny--new-york/events/',
  'https://www.eventbrite.com/d/ny--new-york/music--events/',
  'https://www.eventbrite.com/d/ny--new-york/food-and-drink--events/',
  'https://www.eventbrite.com/d/ny--new-york/arts--events/',
  'https://www.eventbrite.com/d/ny--new-york/community--events/',
  'https://www.eventbrite.com/d/ny--new-york/health--events/',
  'https://www.eventbrite.com/d/ny--new-york/sports-and-fitness--events/',
];

function normalizeEventbriteEvent(raw, sourceUrl) {
  try {
    const name = raw.name || raw.title || '';
    if (!name) return null;

    const descRaw = raw.description || raw.summary || '';
    const description = cleanDescription(descRaw);

    const dateStr = raw.startDate || raw.start_date || raw.start?.utc || raw.starts_at;
    const dateInfo = dateToUTC(dateStr);
    if (!dateInfo) return null;

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

    if (!isNYCAddress(zipcode, address)) return null;
    const borough = getBorough(zipcode, address) || 'Manhattan';

    const priceVal = raw.offers?.price ?? raw.ticket_availability?.minimum_ticket_price?.major_value ?? null;
    const price = detectPrice(priceVal, description);

    const photos = [];
    const imgUrl = raw.image?.url || raw.logo?.url || (typeof raw.image === 'string' ? raw.image : '');
    if (imgUrl && imgUrl.startsWith('http')) photos.push(imgUrl);

    const eventUrl = (raw.url || raw['@id'] || sourceUrl || '').split('?')[0];

    let eventId = raw['@id']?.split('/')?.find(s => /^\d{10,}$/.test(s)) ||
      raw.id || raw.event_id ||
      eventUrl.match(/tickets-(\d+)/)?.[1];
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

/** Extract event links from a browse page (img[alt$=" primary image"] pattern). */
function extractEventLinksFromBrowse(html) {
  const $ = cheerioLoad(html);
  const links = new Map();

  // First: JSON-LD / __SERVER_DATA__ fast path
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const items = data['@type'] === 'ItemList'
        ? (data.itemListElement || []).map(i => i.item || i)
        : data['@type'] === 'Event' ? [data] : [];
      items.forEach(item => {
        const url = (item.url || item['@id'] || '').split('?')[0];
        const idMatch = url.match(/tickets-(\d+)/);
        if (idMatch) links.set(idMatch[1], { url, name: item.name || '', img: item.image?.url || '' });
      });
    } catch { /* skip */ }
  });

  // Second: find event links via img alt "primary image" convention
  $('img').each((_, el) => {
    const alt = $(el).attr('alt') || '';
    if (!alt.endsWith(' primary image')) return;
    const name = alt.replace(/ primary image$/, '').trim();
    if (!name) return;

    const $a = $(el).closest('a[href]');
    let href = $a.attr('href') || '';
    if (!href) {
      // Try parent containers
      let $parent = $(el).parent();
      for (let i = 0; i < 5 && !href; i++) {
        href = $parent.closest('a[href*="/e/"]').attr('href') || '';
        $parent = $parent.parent();
      }
    }
    if (!href || !href.includes('/e/')) return;

    const fullUrl = (href.startsWith('http') ? href : `https://www.eventbrite.com${href}`).split('?')[0];
    const idMatch = fullUrl.match(/tickets-(\d+)/);
    if (!idMatch) return;
    const id = idMatch[1];

    const imgSrc = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!links.has(id)) {
      links.set(id, { url: fullUrl, name, img: imgSrc });
    }
  });

  // Third: any remaining /e/ links
  if (links.size < 3) {
    $('a[href*="/e/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const fullUrl = (href.startsWith('http') ? href : `https://www.eventbrite.com${href}`).split('?')[0];
      const idMatch = fullUrl.match(/tickets-(\d+)/);
      if (!idMatch) return;
      const id = idMatch[1];
      if (!links.has(id)) {
        const name = $(el).find('img').attr('alt')?.replace(/ primary image$/, '') || $(el).text().trim().slice(0, 80);
        const img = $(el).find('img').attr('src') || '';
        links.set(id, { url: fullUrl, name, img });
      }
    });
  }

  return Array.from(links.values()).filter(l => l.url && l.name).slice(0, MAX_EVENTS_PER_PAGE);
}

/** Fetch an individual event page and extract JSON-LD. */
async function fetchEventDetails(eventUrl) {
  try {
    await sleep(DELAY_MS);
    const res = await httpGet(eventUrl, {
      Referer: 'https://www.eventbrite.com/',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerioLoad(html);

    let eventData = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (eventData) return;
      try {
        const data = JSON.parse($(el).html() || '{}');
        if (data['@type'] === 'Event') eventData = data;
      } catch { /* skip */ }
    });
    return eventData;
  } catch {
    return null;
  }
}

export async function scrapeEventbrite() {
  const allEvents = [];
  const seenIds = new Set();
  // Hard limit: max total event-page fetches across all browse pages (to avoid 120s+ runs)
  let totalEventFetches = 0;
  const MAX_TOTAL_FETCHES = 20;

  for (const browseUrl of BROWSE_URLS) {
    if (totalEventFetches >= MAX_TOTAL_FETCHES) break;
    try {
      await sleep(DELAY_MS);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let res;
      try {
        res = await fetch(browseUrl, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.eventbrite.com/',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
          },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        console.warn(`  Eventbrite ${browseUrl} → HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();

      // Try fast JSON-LD parse first (no extra requests needed)
      let fastEvents = [];
      const $ = cheerioLoad(html);
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() || '{}');
          const items = data['@type'] === 'ItemList'
            ? (data.itemListElement || []).map(i => i.item || i)
            : data['@type'] === 'Event' ? [data] : [];
          items.forEach(item => {
            const ev = normalizeEventbriteEvent(item, browseUrl);
            if (ev && !seenIds.has(ev.external_id)) {
              seenIds.add(ev.external_id);
              fastEvents.push(ev);
            }
          });
        } catch { /* skip */ }
      });

      if (fastEvents.length > 0) {
        allEvents.push(...fastEvents);
        continue;
      }

      // Fallback: extract links then fetch each event page for JSON-LD
      const remaining = MAX_TOTAL_FETCHES - totalEventFetches;
      const eventLinks = extractEventLinksFromBrowse(html).slice(0, Math.min(4, remaining));
      for (const { url, name } of eventLinks) {
        if (totalEventFetches >= MAX_TOTAL_FETCHES) break;
        const idMatch = url.match(/tickets-(\d+)/);
        if (!idMatch) continue;
        const candidateExtId = makeExternalId(SOURCE_SITE, idMatch[1]);
        if (seenIds.has(candidateExtId)) continue;

        totalEventFetches++;
        const jsonLd = await fetchEventDetails(url);
        if (jsonLd) {
          const ev = normalizeEventbriteEvent(jsonLd, url);
          if (ev && !seenIds.has(ev.external_id)) {
            seenIds.add(ev.external_id);
            allEvents.push(ev);
          }
        }
      }
    } catch (err) {
      console.warn(`  Eventbrite error on ${browseUrl}: ${err.message}`);
    }
  }

  return allEvents;
}
