// utils/normalize.js
// Shared normalization utilities for all scrapers.
import { createHash } from 'node:crypto';

/**
 * Convert any date string (ISO with offset, plain date, etc.) to:
 *   event_time_utc  — ISO UTC string (null if no time info)
 *   event_date      — 'YYYY-MM-DD' in America/New_York timezone
 * Returns null if the date is unparseable or clearly invalid.
 */
export function dateToUTC(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;

    // event_date as YYYY-MM-DD in NY local time so day-boundary is correct
    const nyDateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    return {
      event_time_utc: d.toISOString(),
      event_date: nyDateStr,
    };
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags, decode common entities, collapse whitespace.
 * Truncates to maxLen characters (default 800).
 */
export function cleanDescription(html, maxLen = 800) {
  if (!html) return '';
  let text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
}

/**
 * Build a stable external_id string: "site:siteId"
 */
export function makeExternalId(site, siteEventId) {
  return `${site}:${siteEventId}`;
}

/**
 * Fallback external_id using SHA-256 hash of name+date+address.
 * Returns first 16 hex chars (64-bit hash — sufficient for dedup).
 */
export function makeHashId(name, date, address) {
  const raw = `${name}|${date}|${address}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Extract ZIP code from an address string.
 */
export function extractZip(addressStr) {
  if (!addressStr) return null;
  const m = addressStr.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

/**
 * Small helper — await a sleep between requests to be polite.
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Shared fetch wrapper — full Chrome 120 browser fingerprint to bypass basic bot detection.
 */
export async function httpGet(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
        ...extraHeaders,
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * JSON API fetch with browser-like headers but JSON accept type.
 */
export async function httpGetJSON(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cache-Control': 'no-cache',
        ...extraHeaders,
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
