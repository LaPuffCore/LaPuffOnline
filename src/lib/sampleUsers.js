import { SAMPLE_MODE } from './sampleConfig';

// Demo sample users for leaderboard/colonist testing
// These are shown when SAMPLE_MODE = true and a zip has no real users
export const SAMPLE_USERS = SAMPLE_MODE ? [
  // ── Williamsburg 11211 (8 users) ──
  { id: 'su-1',  username: 'nyc_ghost',       bio: 'Brooklyn native. Always at shows.',          home_zip: '11211', clout_points: 420, updated_at: new Date().toISOString() },
  { id: 'su-11', username: 'wburg_wolf',       bio: 'Live music seven nights a week.',             home_zip: '11211', clout_points: 310, updated_at: new Date().toISOString() },
  { id: 'su-13', username: 'bedbug_barb',      bio: 'Vintage & vinyl, always.',                    home_zip: '11211', clout_points: 255, updated_at: new Date().toISOString() },
  { id: 'su-14', username: 'bedford_blaze',    bio: 'Coffee carts and mural hunts.',               home_zip: '11211', clout_points: 210, updated_at: new Date().toISOString() },
  { id: 'su-15', username: 'lorimer_luna',     bio: 'Gallery hops every First Friday.',            home_zip: '11211', clout_points: 175, updated_at: new Date().toISOString() },
  { id: 'su-16', username: 'north7_ned',       bio: 'Rooftop chaser. Skyline philosopher.',        home_zip: '11211', clout_points: 140, updated_at: new Date().toISOString() },
  { id: 'su-17', username: 'keap_kay',         bio: 'Dive bars and jazz basements.',               home_zip: '11211', clout_points: 88, updated_at: new Date().toISOString() },
  { id: 'su-18', username: 'berry_beacon',     bio: 'Bike commuter. Festival regular.',            home_zip: '11211', clout_points: 42, updated_at: new Date().toISOString() },

  // ── LIC / Long Island City 11101 (6 users) ──
  { id: 'su-4',  username: 'queens_quentin',   bio: 'Food hall expert. 80+ cuisines tried.',       home_zip: '11101', clout_points: 195, updated_at: new Date().toISOString() },
  { id: 'su-12', username: 'lic_lyra',         bio: 'MoMA PS1 regular. Skyline views.',            home_zip: '11101', clout_points: 130, updated_at: new Date().toISOString() },
  { id: 'su-20', username: 'qb_queen',         bio: 'Queensboro sunset collector.',                home_zip: '11101', clout_points: 95, updated_at: new Date().toISOString() },
  { id: 'su-21', username: 'hunters_haze',     bio: 'Warehouse raves and dim sum.',                home_zip: '11101', clout_points: 72, updated_at: new Date().toISOString() },
  { id: 'su-22', username: 'lic_lumen',        bio: 'Neon signs and late-night diners.',           home_zip: '11101', clout_points: 55, updated_at: new Date().toISOString() },
  { id: 'su-23', username: 'court_sq_clio',    bio: 'Art events and free gallery nights.',         home_zip: '11101', clout_points: 30, updated_at: new Date().toISOString() },

  // ── Harlem 10027 (5 users) ──
  { id: 'su-5',  username: 'harlem_honey',     bio: 'Jazz and spoken word. Community first.',      home_zip: '10027', clout_points: 280, updated_at: new Date().toISOString() },
  { id: 'su-10', username: 'uptown_ursa',      bio: 'Jazz, Harlem, community.',                    home_zip: '10027', clout_points: 190, updated_at: new Date().toISOString() },
  { id: 'su-25', username: 'mcd_malik',        bio: 'Street art tours every weekend.',             home_zip: '10027', clout_points: 145, updated_at: new Date().toISOString() },
  { id: 'su-26', username: 'sugar_hill_sol',   bio: 'Block parties and brownstone vibes.',         home_zip: '10027', clout_points: 90, updated_at: new Date().toISOString() },
  { id: 'su-27', username: 'west_116_wren',    bio: 'Community gardens and spoken word.',          home_zip: '10027', clout_points: 48, updated_at: new Date().toISOString() },

  // ── Park Slope 11215 (5 users) ──
  { id: 'su-8',  username: 'prospect_pete',    bio: 'Park Slope. Secretly cool.',                  home_zip: '11215', clout_points: 160, updated_at: new Date().toISOString() },
  { id: 'su-30', username: 'slope_serpent',    bio: 'Farmer markets and fiction readings.',        home_zip: '11215', clout_points: 105, updated_at: new Date().toISOString() },
  { id: 'su-31', username: 'flatbush_faye',    bio: 'Open mics and brunch marathons.',             home_zip: '11215', clout_points: 78, updated_at: new Date().toISOString() },
  { id: 'su-32', username: 'garfield_glow',    bio: 'Theater and small press fairs.',              home_zip: '11215', clout_points: 52, updated_at: new Date().toISOString() },
  { id: 'su-33', username: 'ppt_phantom',      bio: 'Prospect Park all seasons.',                  home_zip: '11215', clout_points: 28, updated_at: new Date().toISOString() },

  // ── Lower East Side 10002 (5 users) ──
  { id: 'su-7',  username: 'lowereast_lena',   bio: 'Vintage finds and dive bars.',                home_zip: '10002', clout_points: 245, updated_at: new Date().toISOString() },
  { id: 'su-35', username: 'orchard_ox',       bio: 'Every pop-up shop, every weekend.',           home_zip: '10002', clout_points: 155, updated_at: new Date().toISOString() },
  { id: 'su-36', username: 'delancey_dusk',    bio: 'Night market devotee.',                       home_zip: '10002', clout_points: 110, updated_at: new Date().toISOString() },
  { id: 'su-37', username: 'essex_echo',       bio: 'Food hall explorer. LES forever.',            home_zip: '10002', clout_points: 65, updated_at: new Date().toISOString() },
  { id: 'su-38', username: 'rivington_rio',    bio: 'Late-night shows and cheap eats.',            home_zip: '10002', clout_points: 33, updated_at: new Date().toISOString() },

  // ── SoHo / West Village 10012 (4 users) ──
  { id: 'su-2',  username: 'downtown_daria',   bio: 'Art openings and late nights only.',          home_zip: '10012', clout_points: 390, updated_at: new Date().toISOString() },
  { id: 'su-40', username: 'broome_blaze',     bio: 'Gallery openings and street casts.',          home_zip: '10012', clout_points: 200, updated_at: new Date().toISOString() },
  { id: 'su-41', username: 'prince_prism',     bio: 'Architecture walks and rooftop bars.',        home_zip: '10012', clout_points: 135, updated_at: new Date().toISOString() },
  { id: 'su-42', username: 'spring_specter',   bio: 'Pop-ups and concept stores.',                 home_zip: '10012', clout_points: 67, updated_at: new Date().toISOString() },

  // ── Bronx / South Bronx 10451 (5 users) ──
  { id: 'su-3',  username: 'bronx_baron',      bio: 'Boogie Down forever.',                        home_zip: '10451', clout_points: 330, updated_at: new Date().toISOString() },
  { id: 'su-44', username: '138th_ace',         bio: 'Block parties and hip-hop history.',          home_zip: '10451', clout_points: 190, updated_at: new Date().toISOString() },
  { id: 'su-45', username: 'melrose_myth',     bio: 'Street murals and skate spots.',              home_zip: '10451', clout_points: 120, updated_at: new Date().toISOString() },
  { id: 'su-46', username: 'courtlandt_crow',  bio: 'Corner store culture and open studios.',      home_zip: '10451', clout_points: 82, updated_at: new Date().toISOString() },
  { id: 'su-47', username: 'mott_haven_max',   bio: 'Bronx arts district pioneer.',                home_zip: '10451', clout_points: 45, updated_at: new Date().toISOString() },

  // ── Astoria 11102 (4 users) ──
  { id: 'su-9',  username: 'astoria_alex',     bio: 'Greek food and rooftop views.',               home_zip: '11102', clout_points: 175, updated_at: new Date().toISOString() },
  { id: 'su-50', username: 'ditmars_daze',     bio: 'Night markets and ethnic eats.',              home_zip: '11102', clout_points: 110, updated_at: new Date().toISOString() },
  { id: 'su-51', username: 'steinway_sun',     bio: 'Jazz clubs and record fairs.',                home_zip: '11102', clout_points: 73, updated_at: new Date().toISOString() },
  { id: 'su-52', username: 'astoria_ark',      bio: 'Film screenings at Kaufman Studios.',         home_zip: '11102', clout_points: 40, updated_at: new Date().toISOString() },

  // ── Staten Island 10301 (4 users) ──
  { id: 'su-6',  username: 'si_phantom',       bio: 'Staten Island represent.',                    home_zip: '10301', clout_points: 240, updated_at: new Date().toISOString() },
  { id: 'su-55', username: 'snug_harbor_sal',  bio: 'Botanical garden and arts center.',           home_zip: '10301', clout_points: 135, updated_at: new Date().toISOString() },
  { id: 'su-56', username: 'richmond_rave',    bio: 'Forgotten borough, not forgotten spirit.',    home_zip: '10301', clout_points: 80, updated_at: new Date().toISOString() },
  { id: 'su-57', username: 'castleton_cat',    bio: 'Ferry rides and ferry tales.',                home_zip: '10301', clout_points: 35, updated_at: new Date().toISOString() },

  // ── Midtown / Chelsea 10001 (4 users) ──
  { id: 'su-60', username: 'chelsea_chroma',   bio: 'Gallery district devotee.',                   home_zip: '10001', clout_points: 285, updated_at: new Date().toISOString() },
  { id: 'su-61', username: 'highline_hawk',    bio: 'High Line every season.',                     home_zip: '10001', clout_points: 165, updated_at: new Date().toISOString() },
  { id: 'su-62', username: 'hudson_yards_hz',  bio: 'New NYC energy and art installations.',       home_zip: '10001', clout_points: 95, updated_at: new Date().toISOString() },
  { id: 'su-63', username: 'penn_station_paz', bio: 'Commuter turned colonist.',                   home_zip: '10001', clout_points: 42, updated_at: new Date().toISOString() },

  // ── Upper East Side 10028 (4 users) ──
  { id: 'su-65', username: 'met_museum_mira',  bio: 'Met every week. Museum Mile forever.',        home_zip: '10028', clout_points: 310, updated_at: new Date().toISOString() },
  { id: 'su-66', username: 'ues_oracle',       bio: 'Classical concerts and estate sales.',        home_zip: '10028', clout_points: 180, updated_at: new Date().toISOString() },
  { id: 'su-67', username: 'yorkville_yael',   bio: 'Heritage festivals and culinary walks.',      home_zip: '10028', clout_points: 105, updated_at: new Date().toISOString() },
  { id: 'su-68', username: 'carl_schurz_crow', bio: 'Park runs and poetry in the park.',           home_zip: '10028', clout_points: 55, updated_at: new Date().toISOString() },
] : [];

// Return sample users matching a given zip (for colonist leaderboard)
export function getSampleUsersForZip(zip) {
  if (!SAMPLE_MODE) return [];
  return SAMPLE_USERS.filter(u => u.home_zip === zip).sort((a, b) => b.clout_points - a.clout_points);
}