// Comprehensive profanity + hate speech filter
// Checks exact words, common substitutions, abbreviations, and leet-speak variants

const BAD_WORDS = [
  // Racial slurs and variants
  'nigger','niggers','nigga','niggas','nigger','niggr','nigr','niga','nigar','nigg','n1gger','n1gga',
  'ngr','n-word','nword','niger','kike','kikes','chink','chinks','gook','gooks','spick','spic','spics',
  'wetback','wetbacks','beaner','beaners','towelhead','raghead','coon','coons','jigaboo','sambo',
  'honky','gringo','zipperhead','slope','slopehead',
  // Homophobic slurs
  'faggot','faggots','fag','fags','faggo','fagg','fago','fagot','fagots','dyke','dykes',
  'homo','tranny','trannies','shemale',
  // Sexist / misogynistic
  'cunt','cunts', 'rape', 'raper', 'rapist', 'rapiest', 'rapely', 
  // General severe profanity (contextual but block in names/descriptions)

  // Nazi / extremist
  'nazi','nazis','nsdap','1488','heil','swastika','kkk','aryan', 'hitler', 'gorillion', '6million', '6_million', 'six_million', 'sixmillion',
  // Violence / threats
  'kill yourself','kys','die faggot','rope yourself', 'killer',
];

// Leet speak and common substitutions map
const LEET = { '0':'o','1':'i','3':'e','4':'a','5':'s','6':'g','7':'t','8':'b','@':'a','$':'s','!':'i','|':'l' };

function normalize(str) {
  let s = str.toLowerCase().trim();
  // Replace leet speak
  s = s.split('').map(c => LEET[c] || c).join('');
  // Remove repeated chars beyond 2 (fagggg → fagg)
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  // Remove non-alphanumeric separators but keep spaces
  s = s.replace(/[^a-z0-9 ]/g, '');
  return s;
}

function stripSpacers(str) {
  // Also check with all spaces/dots/dashes removed
  return str.replace(/[\s\-_.]/g, '');
}

export function containsProfanity(text) {
  if (!text) return false;
  const norm = normalize(text);
  const stripped = stripSpacers(norm);
  for (const word of BAD_WORDS) {
    const normWord = normalize(word);
    // Check in spaced version (word boundary-ish)
    if (norm.includes(normWord)) return true;
    // Check stripped (catches f.a.g, n-i-g-g-a etc)
    if (stripped.includes(stripSpacers(normWord))) return true;
  }
  return false;
}

export function validateText(text, fieldName = 'Field') {
  if (containsProfanity(text)) {
    throw new Error(`${fieldName} contains inappropriate language. Please keep it respectful.`);
  }
  return true;
}