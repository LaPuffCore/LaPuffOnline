// utils/nyc-validate.js
// NYC ZIP code → borough mapping and address validation.

// Contiguous ZIP ranges per borough (USPS data).
const ZIP_BOROUGH_RANGES = [
  { min: 10001, max: 10282, borough: 'Manhattan' },
  { min: 10451, max: 10475, borough: 'Bronx' },
  { min: 11201, max: 11256, borough: 'Brooklyn' },
  { min: 11101, max: 11109, borough: 'Queens' },  // LIC / Astoria
  { min: 11354, max: 11436, borough: 'Queens' },  // Flushing → Rosedale
  { min: 11001, max: 11003, borough: 'Queens' },  // Floral Park
  { min: 11040, max: 11042, borough: 'Queens' },  // New Hyde Park
  { min: 10301, max: 10314, borough: 'Staten Island' },
];

// Keyword patterns in address text → borough
const ADDR_KEYWORDS = [
  { kw: 'staten island', borough: 'Staten Island' },
  { kw: 'brooklyn', borough: 'Brooklyn' },
  { kw: 'bronx', borough: 'Bronx' },
  { kw: 'queens', borough: 'Queens' },
  { kw: 'astoria', borough: 'Queens' },
  { kw: 'flushing', borough: 'Queens' },
  { kw: 'jamaica', borough: 'Queens' },
  { kw: 'long island city', borough: 'Queens' },
  { kw: 'jackson heights', borough: 'Queens' },
  { kw: 'harlem', borough: 'Manhattan' },
  { kw: 'manhattan', borough: 'Manhattan' },
  { kw: 'new york, ny', borough: 'Manhattan' },
  { kw: 'new york city', borough: 'Manhattan' },
  { kw: 'nyc', borough: 'Manhattan' },
];

/**
 * Determine NYC borough from ZIP code + address text.
 * Falls back to 'Manhattan' if NYC but borough unclear.
 * Returns null if definitely NOT an NYC address.
 */
export function getBorough(zipCode, addressText = '') {
  const addr = (addressText || '').toLowerCase();

  if (zipCode) {
    const zip = parseInt(zipCode, 10);
    for (const r of ZIP_BOROUGH_RANGES) {
      if (zip >= r.min && zip <= r.max) return r.borough;
    }
  }

  for (const { kw, borough } of ADDR_KEYWORDS) {
    if (addr.includes(kw)) return borough;
  }

  // Generic NYC signals — default to Manhattan
  if (addr.includes('new york') || addr.includes(' ny ') || addr.includes(', ny')) {
    return 'Manhattan';
  }

  return null;
}

/**
 * Return true if the ZIP is within any NYC range.
 */
export function isNYCZip(zipCode) {
  if (!zipCode) return false;
  const zip = parseInt(zipCode, 10);
  return ZIP_BOROUGH_RANGES.some((r) => zip >= r.min && zip <= r.max);
}

/**
 * Return true if address text contains recognizable NYC location signals.
 */
export function isNYCAddress(zipCode, addressText = '') {
  if (isNYCZip(zipCode)) return true;
  const addr = addressText.toLowerCase();
  return (
    addr.includes('new york') ||
    addr.includes('brooklyn') ||
    addr.includes('bronx') ||
    addr.includes('queens') ||
    addr.includes('staten island') ||
    addr.includes('manhattan') ||
    addr.includes(', ny ')
  );
}
