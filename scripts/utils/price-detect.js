// utils/price-detect.js
// Algorithmically determine price_category from scraped price data.

const FREE_KEYWORDS = [
  'free', 'no cost', 'complimentary', 'no admission', 'no charge',
  'at no cost', 'free admission', 'free entry', 'free event',
  'free to attend', 'rsvp required', 'rsvp only', 'free rsvp',
  'donation', 'by donation', 'suggested donation', '$0',
];

const PREMIUM_KEYWORDS = [
  'gala', 'black tie', 'vip table', 'bottle service',
  'tasting menu', 'exclusive access', 'private event',
];

/**
 * Detect price category from a scraped price value and/or description text.
 *
 * @param {string|number|null} priceValue  Raw price from the event source (e.g. "Free", "$25", 0, 45)
 * @param {string}             descText    Full event description text (for keyword fallback)
 * @returns {'free'|'$'|'$$'|'$$$'}
 */
export function detectPrice(priceValue, descText = '') {
  const priceStr = String(priceValue ?? '').toLowerCase().trim();
  const desc = (descText || '').toLowerCase();

  // Explicit $0 or 'free' in price field
  if (priceStr === '0' || priceStr === '0.00') return 'free';
  if (FREE_KEYWORDS.some((kw) => priceStr.includes(kw))) return 'free';

  // Parse a dollar amount from the price field
  const numMatch = priceStr.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (numMatch) {
    const amount = parseFloat(numMatch[1]);
    if (amount === 0) return 'free';
    if (amount < 20) return '$';
    if (amount < 60) return '$$';
    return '$$$';
  }

  // Price field wasn't a number — check description for price signals
  if (FREE_KEYWORDS.some((kw) => desc.includes(kw))) return 'free';

  const descNumMatch = desc.match(/\$\s*(\d+)/);
  if (descNumMatch) {
    const amount = parseFloat(descNumMatch[1]);
    if (amount === 0) return 'free';
    if (amount < 20) return '$';
    if (amount < 60) return '$$';
    return '$$$';
  }

  if (PREMIUM_KEYWORDS.some((kw) => desc.includes(kw))) return '$$$';

  // Default assumption for events without clear pricing
  return '$';
}
