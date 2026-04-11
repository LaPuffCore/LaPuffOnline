// utils/emoji-color.js
// Keyword → emoji matching, and emoji → complementary hex color.
// Rules are ordered from most specific to most general.

const KEYWORD_EMOJI_RULES = [
  // ── Music (specific genres first) ──────────────────────────────────────────
  { kw: ['jazz', 'bebop', 'swing', 'blue note', 'village vanguard', 'saxophone', 'trumpet jazz'], emoji: '🎷' },
  { kw: ['classical', 'symphony', 'orchestra', 'philharmonic', 'chamber music', 'quartet', 'concerto', 'opera', 'candlelight concert', 'recital'], emoji: '🎻' },
  { kw: ['hip hop', 'rap', 'mc ', 'freestyle', 'cypher', 'rave', 'edm', 'electronic music', 'dj set', 'techno', 'house music', 'drum and bass'], emoji: '🎧' },
  { kw: ['rock ', 'punk', 'metal', 'guitar band', 'rock concert', 'indie rock', 'alternative'], emoji: '🎸' },
  { kw: ['karaoke', 'sing-along', 'choir', 'vocal', 'open mic singing'], emoji: '🎤' },
  { kw: ['concert', 'live music', 'music festival', 'folk music', 'acoustic', 'r&b', 'soul music', 'reggae', 'pop concert'], emoji: '🎵' },

  // ── Visual Art ──────────────────────────────────────────────────────────────
  { kw: ['photography exhibit', 'photo show', 'photographic exhibition', 'photo exhibit'], emoji: '📸' },
  { kw: ['gallery opening', 'art opening', 'vernissage', 'exhibition opening', 'art show', 'installation art', 'mural unveiling', 'art exhibition', 'gallery show'], emoji: '🖼️' },
  { kw: ['painting class', 'watercolor', 'oil painting', 'drawing class', 'illustration workshop'], emoji: '🎨' },
  { kw: ['pottery', 'ceramics', 'clay workshop', 'sculpture'], emoji: '🏺' },

  // ── Food & Drink ────────────────────────────────────────────────────────────
  { kw: ['bottomless brunch', 'brunch party', 'sunday brunch', 'brunch event'], emoji: '🥂' },
  { kw: ['cocktail', 'mixology', 'speakeasy', 'craft cocktail', 'spirits tasting', 'cocktail bar', 'cocktail class'], emoji: '🍸' },
  { kw: ['wine tasting', 'wine bar', 'winery', 'vineyard', 'sommelier', 'wine event'], emoji: '🍷' },
  { kw: ['brewery', 'craft beer', 'beer tasting', 'taproom', 'beer festival'], emoji: '🍺' },
  { kw: ['pizza', 'pizzeria'], emoji: '🍕' },
  { kw: ['sushi', 'ramen', 'japanese food', 'dim sum', 'dumpling'], emoji: '🍜' },
  { kw: ['taco', 'mexican food', 'paella', 'latin food', 'empanada'], emoji: '🌮' },
  { kw: ['cooking class', 'baking class', 'culinary workshop', 'chef ', 'kitchen'], emoji: '👨‍🍳' },
  { kw: ['food market', 'smorgasburg', 'night market', 'food festival', 'street food', 'food fair', 'food pop-up', 'tasting event', 'restaurant week', 'food tour'], emoji: '🍽️' },
  { kw: ['brunch'], emoji: '🥂' },

  // ── Dance ───────────────────────────────────────────────────────────────────
  { kw: ['ballet', 'contemporary dance', 'modern dance', 'dance performance', 'choreography showcase'], emoji: '🩰' },
  { kw: ['salsa', 'merengue', 'bachata', 'latin dance', 'tango', 'ballroom', 'swing dance', 'social dance night'], emoji: '💃' },
  { kw: ['vogue', 'waacking', 'breaking', 'bboy', 'bgirl', 'hip hop dance', 'street dance', 'dance battle'], emoji: '🕺' },

  // ── Theater & Comedy ────────────────────────────────────────────────────────
  { kw: ['broadway', 'off-broadway', 'musical theater', 'theater performance', 'theatre', 'stage play', 'acting', 'improv show', 'sketch comedy'], emoji: '🎭' },
  { kw: ['stand-up comedy', 'standup comedy', 'comedy show', 'comedian', 'comedy club', 'roast', 'comedy open mic'], emoji: '😂' },

  // ── Film ────────────────────────────────────────────────────────────────────
  { kw: ['film screening', 'movie screening', 'documentary screening', 'cinema', 'film festival', 'short film', 'film premiere', 'outdoor movie', 'drive-in'], emoji: '🎬' },

  // ── Books & Literature ──────────────────────────────────────────────────────
  { kw: ['book fair', 'bookstore event', 'library event', 'book launch', 'book signing', 'literary festival'], emoji: '📚' },
  { kw: ['poetry slam', 'spoken word', 'slam poetry', 'poetry reading', 'poetry open mic', 'poem', 'poet'], emoji: '✍️' },
  { kw: ['author reading', 'book reading', 'literary reading', 'fiction', 'memoir', 'novel', 'writing workshop'], emoji: '📖' },

  // ── Sports & Fitness ────────────────────────────────────────────────────────
  { kw: ['marathon', '5k race', '10k race', 'running race', 'charity run', 'fun run'], emoji: '🏃' },
  { kw: ['yoga class', 'meditation', 'mindfulness', 'breathwork', 'sound bath', 'pilates', 'wellness retreat', 'sound healing'], emoji: '🧘' },
  { kw: ['gym', 'workout', 'fitness class', 'crossfit', 'bootcamp', 'hiit', 'personal training', 'fitness challenge'], emoji: '💪' },
  { kw: ['basketball', 'hoops', 'nba game'], emoji: '🏀' },
  { kw: ['soccer', 'futbol', 'mls game', 'football match'], emoji: '⚽' },
  { kw: ['tennis', 'pickleball'], emoji: '🎾' },
  { kw: ['boxing', 'mma', 'martial arts', 'wrestling'], emoji: '🥊' },
  { kw: ['cycling event', 'bike ride', 'bicycle tour', 'cycling class'], emoji: '🚴' },
  { kw: ['swimming', 'swim meet', 'triathlon'], emoji: '🏊' },
  { kw: ['ice skating', 'roller skating', 'skateboard', 'skating rink'], emoji: '⛸️' },
  { kw: ['rock climbing', 'bouldering', 'climbing gym'], emoji: '🧗' },

  // ── Outdoor & Nature ────────────────────────────────────────────────────────
  { kw: ['botanical garden', 'greenhouse', 'orchid', 'flower show', 'garden tour', 'plant sale', 'bloom'], emoji: '🌸' },
  { kw: ['hiking', 'trail walk', 'nature hike', 'trail run', 'wilderness'], emoji: '🥾' },
  { kw: ['beach', 'boardwalk', 'waterfront', 'pier event', 'harbor'], emoji: '🏖️' },
  { kw: ['birdwatching', 'wildlife tour', 'zoo', 'nature walk', 'ecology'], emoji: '🦜' },
  { kw: ['central park', 'prospect park', 'high line', 'mccarren park', 'outdoor festival', 'park concert', 'lawn event', 'open air'], emoji: '🌿' },

  // ── Technology ──────────────────────────────────────────────────────────────
  { kw: ['hackathon', 'coding bootcamp', 'developer meetup', 'programming', 'software engineering', 'code'], emoji: '💻' },
  { kw: ['artificial intelligence', 'machine learning', 'data science', 'ai summit', ' ai '], emoji: '🤖' },
  { kw: ['startup', 'entrepreneur', 'venture capital', 'pitch competition', 'product launch', 'launch event'], emoji: '🚀' },
  { kw: ['crypto', 'blockchain', 'nft', 'web3', 'defi'], emoji: '⛓️' },
  { kw: ['tech meetup', 'tech conference', 'tech event', 'technology'], emoji: '💻' },

  // ── Fashion ─────────────────────────────────────────────────────────────────
  { kw: ['fashion show', 'runway show', 'nyfw', 'new york fashion week', 'designer showcase', 'couture'], emoji: '👗' },
  { kw: ['vintage market', 'thrift shop', 'clothing swap', 'secondhand', 'vintage clothing'], emoji: '🧥' },
  { kw: ['sneaker', 'kicks', 'footwear', 'sneaker convention'], emoji: '👟' },

  // ── Nightlife & Social ──────────────────────────────────────────────────────
  { kw: ['nightclub', 'club night', 'rave party', 'afterparty', 'late night party', 'night party'], emoji: '🌙' },
  { kw: ['rooftop party', 'rooftop bar', 'rooftop event', 'terrace party', 'skybar'], emoji: '🌆' },
  { kw: ['networking event', 'professional mixer', 'career fair', 'business networking', 'startup mixer'], emoji: '🤝' },
  { kw: ['flea market', 'vintage bazaar', 'artisan market', 'craft fair', 'makers market', 'antique fair'], emoji: '🏪' },
  { kw: ['birthday party', 'anniversary party', 'celebration party', 'launch party', 'farewell party', 'new year party'], emoji: '🎉' },

  // ── Community & Culture ─────────────────────────────────────────────────────
  { kw: ['cultural festival', 'heritage festival', 'cultural parade', 'carnival', 'cultural celebration', 'street festival'], emoji: '🎊' },
  { kw: ['pride event', 'lgbtq', 'queer', 'drag show', 'drag brunch', 'pride party', 'pride parade'], emoji: '🏳️‍🌈' },
  { kw: ['fundraiser', 'benefit concert', 'charity gala', 'nonprofit event', 'volunteer', 'donation drive', 'charity event'], emoji: '❤️' },
  { kw: ['protest', 'rally', 'march', 'advocacy event', 'activism', 'civic', 'organize'], emoji: '✊' },
  { kw: ['kids event', "children's event", 'family fun', 'all ages', 'kid-friendly', 'toddler', 'storytime', 'family festival'], emoji: '👨‍👩‍👧' },
  { kw: ['nyc parks', 'parks department', 'nyc parks event', 'parks event'], emoji: '🗽' },

  // ── Education ───────────────────────────────────────────────────────────────
  { kw: ['lecture', 'keynote', 'panel discussion', 'symposium', 'conference talk', 'speaker series', 'forum', 'presentation', 'ted talk'], emoji: '📢' },
  { kw: ['workshop', 'masterclass', 'skill class', 'hands-on', 'learn ', 'course ', 'class '], emoji: '📝' },
  { kw: ['museum', 'history exhibit', 'science exhibit', 'natural history', 'museum tour'], emoji: '🏛️' },

  // ── Wellness ────────────────────────────────────────────────────────────────
  { kw: ['spa ', 'massage', 'healing circle', 'reiki', 'holistic', 'self care', 'mental health'], emoji: '🧖' },
];

// Emoji → complementary hex color (curated palette)
const EMOJI_COLORS = {
  '🎷': '#8B5CF6',
  '🎻': '#6D28D9',
  '🎧': '#1D4ED8',
  '🎸': '#DC2626',
  '🎤': '#EA580C',
  '🎵': '#7C63FF',
  '🖼️': '#9333EA',
  '📸': '#374151',
  '🎨': '#E11D48',
  '🏺': '#92400E',
  '🥂': '#D97706',
  '🍸': '#7C3AED',
  '🍷': '#7C2D12',
  '🍺': '#B45309',
  '🍕': '#DC2626',
  '🍜': '#EA580C',
  '🌮': '#16A34A',
  '👨‍🍳': '#C2410C',
  '🍽️': '#FF9F43',
  '🩰': '#EC4899',
  '💃': '#FF6B9D',
  '🕺': '#8B5CF6',
  '🎭': '#7C3AED',
  '😂': '#F59E0B',
  '🎬': '#111827',
  '📚': '#1E40AF',
  '✍️': '#374151',
  '📖': '#0F766E',
  '🏃': '#16A34A',
  '🧘': '#10B981',
  '💪': '#0369A1',
  '🏀': '#EA580C',
  '⚽': '#15803D',
  '🎾': '#65A30D',
  '🥊': '#DC2626',
  '🚴': '#0891B2',
  '🏊': '#0284C7',
  '⛸️': '#7DD3FC',
  '🧗': '#92400E',
  '🌸': '#EC4899',
  '🥾': '#78350F',
  '🏖️': '#0891B2',
  '🦜': '#15803D',
  '🌿': '#16A34A',
  '💻': '#1D4ED8',
  '🤖': '#6B7280',
  '🚀': '#7C3AED',
  '⛓️': '#374151',
  '👗': '#DB2777',
  '🧥': '#9CA3AF',
  '👟': '#F97316',
  '🌙': '#1E1B4B',
  '🌆': '#F59E0B',
  '🤝': '#0F766E',
  '🏪': '#D97706',
  '🎉': '#7C3AED',
  '🎊': '#EC4899',
  '🏳️‍🌈': '#8B5CF6',
  '❤️': '#EF4444',
  '✊': '#1D4ED8',
  '👨‍👩‍👧': '#F59E0B',
  '🗽': '#10B981',
  '📢': '#0369A1',
  '📝': '#0F766E',
  '🏛️': '#374151',
  '🧖': '#EC4899',
};

const DEFAULT_EMOJI = '🎉';
const DEFAULT_COLOR = '#7C3AED';

/**
 * Given event name and description text, return the best matching
 * emoji and its complementary hex color.
 *
 * @param {string} eventName
 * @param {string} description
 * @returns {{ emoji: string, color: string }}
 */
export function assignEmojiAndColor(eventName = '', description = '') {
  const text = `${eventName} ${description}`.toLowerCase();

  for (const rule of KEYWORD_EMOJI_RULES) {
    if (rule.kw.some((kw) => text.includes(kw))) {
      const emoji = rule.emoji;
      return { emoji, color: EMOJI_COLORS[emoji] || DEFAULT_COLOR };
    }
  }

  return { emoji: DEFAULT_EMOJI, color: DEFAULT_COLOR };
}
