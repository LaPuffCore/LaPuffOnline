// scrapers/nycparks.js
// NYC Parks public event feed.
// NOTE: NYC Parks website blocks all server-side requests (403/permission denied).
// Parks-department-permitted events are already included in the NYC Open Data scraper
// (tvpp-9vvx dataset, event_agency = 'Parks Department'). This scraper is a no-op.

export async function scrapeNYCParks() {
  return [];
}
