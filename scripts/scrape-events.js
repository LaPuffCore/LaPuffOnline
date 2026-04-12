// scrape-events.js
// Main orchestrator: runs all scrapers, deduplicates, upserts to auto_events table.
import { scrapeAllevents } from './scrapers/allevents.js';
import { scrapeSongkick } from './scrapers/songkick.js';
import { scrapeEventbrite } from './scrapers/eventbrite.js';
import { scrapeLuma } from './scrapers/luma.js';
import { getExistingExternalIds, filterNewEvents } from './utils/dedup.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gazuabyyugbbthonqnsp.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY env var is required (or set DRY_RUN=true)');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY || '',
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY || ''}`,
  'Content-Type': 'application/json',
};

// Ordered by reliability / expected volume
const SCRAPERS = [
  { name: 'Allevents.in', fn: scrapeAllevents },    // Volume aggregator — 130+ events, most reliable
  { name: 'Songkick', fn: scrapeSongkick },          // Concerts — 50 events
  { name: 'Eventbrite', fn: scrapeEventbrite },       // General events — __SERVER_DATA__ extraction
  { name: 'Luma', fn: scrapeLuma },                   // Social/tech events — __NEXT_DATA__ extraction
];

const UPSERT_CHUNK_SIZE = 50;

/**
 * Upsert events to auto_events table in chunks.
 * Uses ON CONFLICT DO UPDATE via PostgREST "merge-duplicates" preference
 * to safely re-run the same external_id without creating duplicates.
 */
async function upsertEvents(events) {
  if (!events.length) return 0;
  let inserted = 0;

  for (let i = 0; i < events.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = events.slice(i, i + UPSERT_CHUNK_SIZE);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/auto_events`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      });

      if (res.ok) {
        inserted += chunk.length;
      } else {
        const errText = await res.text().catch(() => '?');
        console.warn(`  ⚠️  Chunk ${i / UPSERT_CHUNK_SIZE + 1} upsert failed: ${errText}`);
      }
    } catch (err) {
      console.warn(`  ⚠️  Chunk ${i / UPSERT_CHUNK_SIZE + 1} network error: ${err.message}`);
    }
  }

  return inserted;
}

/**
 * Remove auto_events older than 60 days to keep the table lean.
 */
async function pruneOldEvents() {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/auto_events?event_date=lt.${cutoff}`,
      {
        method: 'DELETE',
        headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
      }
    );
    if (res.ok) {
      console.log(`🗑️  Pruned events older than ${cutoff}`);
    }
  } catch (err) {
    console.warn(`  Could not prune old events: ${err.message}`);
  }
}

async function main() {
  console.log(`\n🚀 LaPuff Event Scraper — ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
  if (DRY_RUN) console.log('   DRY RUN — events will NOT be written to database\n');

  // Fetch existing IDs to avoid re-inserting duplicates
  const existingIds = DRY_RUN
    ? new Set()
    : await getExistingExternalIds(SUPABASE_URL, supabaseHeaders);
  console.log(`📋 ${existingIds.size} existing event IDs loaded for dedup\n`);

  // Run all scrapers
  const allScraped = [];
  const sourceReport = [];

  for (const { name, fn } of SCRAPERS) {
    const start = Date.now();
    try {
      console.log(`🔍 ${name}...`);
      const events = await fn();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`   ✅ ${events.length} events (${elapsed}s)`);
      allScraped.push(...events);
      sourceReport.push({ name, count: events.length, error: null });
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`   ❌ Failed (${elapsed}s): ${err.message}`);
      sourceReport.push({ name, count: 0, error: err.message });
    }
  }

  // Global dedup by external_id, source_url, AND event_name+date (user requirement: no repeated titles or links)
  const seenIds = new Set();
  const seenUrls = new Set();
  const seenTitleDates = new Set();
  const deduped = allScraped.filter(ev => {
    if (ev.external_id && seenIds.has(ev.external_id)) return false;
    if (ev.source_url && seenUrls.has(ev.source_url)) return false;
    const tdKey = `${(ev.event_name || '').toLowerCase().trim()}|${ev.event_date}`;
    if (seenTitleDates.has(tdKey)) return false;

    if (ev.external_id) seenIds.add(ev.external_id);
    if (ev.source_url) seenUrls.add(ev.source_url);
    seenTitleDates.add(tdKey);
    return true;
  });

  console.log(`\n📊 Total scraped: ${allScraped.length} | After dedup: ${deduped.length}`);

  // Filter out already-stored events
  const newEvents = filterNewEvents(deduped, existingIds);
  console.log(`🆕 New events to insert: ${newEvents.length}`);

  // Only keep events in window: from 30 days ago (archive) up to 6 months ahead
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixMonthsOut = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  const windowed = newEvents.filter(ev => {
    if (!ev.event_date) return false;
    const d = new Date(ev.event_date + 'T00:00:00');
    return d >= thirtyDaysAgo && d <= sixMonthsOut;
  });
  console.log(`📅 Within date window: ${windowed.length}`);

  if (DRY_RUN) {
    console.log('\n📋 DRY RUN — Sample events:');
    windowed.slice(0, 5).forEach((ev, i) => {
      console.log(`  ${i + 1}. [${ev.source_site}] ${ev.event_name} — ${ev.event_date} — ${ev.borough} ${ev.representative_emoji}`);
    });
    console.log('\n✅ Dry run complete. No changes written.\n');
    return;
  }

  // Upsert new events
  if (windowed.length > 0) {
    const inserted = await upsertEvents(windowed);
    console.log(`✅ Upserted ${inserted} events to auto_events\n`);
  }

  // Prune stale events
  await pruneOldEvents();

  // Summary report
  console.log('\n─── Source Summary ─────────────────────────────');
  sourceReport.forEach(({ name, count, error }) => {
    const status = error ? `❌ ${error}` : `✅ ${count} events`;
    console.log(`  ${name.padEnd(22)} ${status}`);
  });
  console.log('────────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n💥 Fatal scraper error:', err);
  process.exit(1);
});
