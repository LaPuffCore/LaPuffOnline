import { SAMPLE_MODE } from './sampleConfig';

// Demo sample users for leaderboard/colonist testing
// These are shown when SAMPLE_MODE = true and a zip has no real users
export const SAMPLE_USERS = SAMPLE_MODE ? [
  { id: 'su-1', username: 'nyc_ghost', bio: 'Brooklyn native. Always at shows.', home_zip: '11211', clout_points: 420, updated_at: new Date().toISOString() },
  { id: 'su-2', username: 'downtown_daria', bio: 'Art openings and late nights only.', home_zip: '10012', clout_points: 310, updated_at: new Date().toISOString() },
  { id: 'su-3', username: 'bronx_baron', bio: 'Boogie Down forever.', home_zip: '10451', clout_points: 280, updated_at: new Date().toISOString() },
  { id: 'su-4', username: 'queens_quentin', bio: 'Food hall expert. 80+ cuisines tried.', home_zip: '11101', clout_points: 195, updated_at: new Date().toISOString() },
  { id: 'su-5', username: 'harlem_honey', bio: 'Jazz and spoken word. Community first.', home_zip: '10027', clout_points: 155, updated_at: new Date().toISOString() },
  { id: 'su-6', username: 'si_phantom', bio: 'Staten Island represent.', home_zip: '10301', clout_points: 90, updated_at: new Date().toISOString() },
  { id: 'su-7', username: 'lowereast_lena', bio: 'Vintage finds and dive bars.', home_zip: '10002', clout_points: 75, updated_at: new Date().toISOString() },
  { id: 'su-8', username: 'prospect_pete', bio: 'Park Slope. Secretly cool.', home_zip: '11215', clout_points: 60, updated_at: new Date().toISOString() },
  { id: 'su-9', username: 'astoria_alex', bio: 'Greek food and rooftop views.', home_zip: '11102', clout_points: 45, updated_at: new Date().toISOString() },
  { id: 'su-10', username: 'uptown_ursa', bio: 'Jazz, Harlem, community.', home_zip: '10027', clout_points: 30, updated_at: new Date().toISOString() },
  { id: 'su-11', username: 'wburg_wolf', bio: 'Live music seven nights a week.', home_zip: '11211', clout_points: 25, updated_at: new Date().toISOString() },
  { id: 'su-12', username: 'lic_lyra', bio: 'MoMA PS1 regular. Skyline views.', home_zip: '11101', clout_points: 18, updated_at: new Date().toISOString() },
] : [];

// Return sample users matching a given zip (for colonist leaderboard)
export function getSampleUsersForZip(zip) {
  if (!SAMPLE_MODE) return [];
  return SAMPLE_USERS.filter(u => u.home_zip === zip).sort((a, b) => b.clout_points - a.clout_points);
}