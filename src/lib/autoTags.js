const TAG_RULES = [
  { tag: 'music', keywords: ['concert','music','jazz','rock','hip hop','classical','dj','band','live music','festival','electronic','symphony','quartet','marsalis','candlelight','songs','beats','perform','rap','r&b','pop','indie','folk','acoustic','rave','edm','karaoke','sing','choir','opera'] },
  { tag: 'jazz', keywords: ['jazz','jazz club','bebop','swing','quartet','marsalis','blue note','village vanguard','dizzy','coltrane','miles','blues','saxophone'] },
  { tag: 'art', keywords: ['art','gallery','exhibition','museum','painting','sculpture','photography','biennial','installation','drawing','raphael','whitney','moma','met','brooklyn museum','dawoud','weems','collage','printmaking','illustration','ceramics','pottery','opening','vernissage'] },
  { tag: 'food', keywords: ['food','dining','restaurant','chef','culinary','eat','tasting','market','cuisine','smorgasburg','night market','flea','vendors','taste','beer','brunch','dinner','lunch','breakfast','pop-up','street food','cocktail','wine','spirits','tasting menu','dessert','baking','cooking','pizzeria','ramen','sushi','tapas','oyster'] },
  { tag: 'brunch', keywords: ['brunch','brunch event','bottomless','mimosa','sunday brunch','brunch party'] },
  { tag: 'market', keywords: ['market','flea market','bazaar','vendor','artisan fair','craft fair','pop-up market','makers fair','artisan market','shopping','antique','vintage market'] },
  { tag: 'sports', keywords: ['marathon','run','race','basketball','baseball','nets','yankees','tournament','half','sports','athletic','game','match','soccer','football','tennis','boxing','mma','swimming','cycling','yoga','fitness','gym','workout','league','championship','skating','climbing','surfing'] },
  { tag: 'workshop', keywords: ['workshop','class','course','lesson','tutorial','learn','hands-on','craft','diy','skill','seminar','training','bootcamp','masterclass'] },
  { tag: 'lecture', keywords: ['lecture','talk','panel','discussion','q&a','conversation','keynote','symposium','conference','forum','speaker','ted','presentation'] },
  { tag: 'family', keywords: ['family','kids','children','film festival','egg hunt','easter','spring break','youth','all ages','kid-friendly','baby','toddler','parent','school','playground','storytime'] },
  { tag: 'kids', keywords: ['kids','children','youth','toddler','baby','school-age','family-friendly','all ages','under 12','teen','junior'] },
  { tag: 'outdoor', keywords: ['outdoor','park','boardwalk','island','ferry','garden','high line','waterfront','plaza','open air','outside','prospect','astoria','flushing meadows','hiking','trail','beach','rooftop','terrace','pier','lawn','meadow'] },
  { tag: 'free', keywords: ['free','no charge','complimentary','gratis','no cost','open to all'] },
  { tag: 'nightlife', keywords: ['night','late','bar','club','comedy','cellar','evening','pm','cocktail','drinks','dance','lounge','speakeasy','afterparty','midnight','bottle service','rave','nightclub'] },
  { tag: 'culture', keywords: ['culture','heritage','latino','asian','harlem','lunar','parade','community','cultural','tradition','diversity','festival','dance','afro','caribbean','south asian','chinese new year','diwali','pride','juneteenth','kwanzaa'] },
  { tag: 'fashion', keywords: ['fashion','style','design','runway','designer','clothing','apparel','nyfw','streetwear','vintage','thrift','swap','textile','couture','lookbook','sneaker','accessories'] },
  { tag: 'film', keywords: ['film','movie','cinema','screening','documentary','animation','ifc','theater','premiere','short film','indie film','feature','drive-in','outdoor cinema'] },
  { tag: 'dance', keywords: ['dance','ballet','flamenco','salsa','merengue','choreograph','performance','dancer','tango','swing','hip hop dance','contemporary','ballroom','bboy','breaking','vogue','waacking','paso doble'] },
  { tag: 'books', keywords: ['book','zine','literary','reading','author','publish','printed matter','art book','open mic','spoken word','bookfair','library','novel','nonfiction','memoir','fiction','literature'] },
  { tag: 'reading', keywords: ['reading','book reading','author reading','bookstore','literary event','launch','book launch','short story','prose','essay','fiction','nonfiction','memoir'] },
  { tag: 'poetry', keywords: ['poem','poetry','poet','verse','spoken word','open mic','slam','lyric','stanza','haiku','writing','literature','prose','recital','rhyme'] },
  { tag: 'comedy', keywords: ['comedy','stand-up','laugh','humor','comic','cellar','joke','improv','sketch','roast','open mic comedy','satire','funny'] },
  { tag: 'nature', keywords: ['orchid','flower','botanical','garden','cherry blossom','plant','bloom','nature','zoo','wildlife','animal','birdwatching','ecology','conservation','hiking','trail','park'] },
  { tag: 'party', keywords: ['party','celebration','birthday','anniversary','rooftop','late night','afterparty','social','mixer','meetup','happy hour','pregame','soiree','gala','fundraiser','charity'] },
  { tag: 'charity', keywords: ['charity','fundraiser','benefit','nonprofit','gala','auction','donation','cause','awareness','community','volunteer'] },
  { tag: 'tech', keywords: ['tech','technology','startup','hackathon','developer','coding','ai','crypto','blockchain','product','launch','demo','innovation','digital','workshop','webinar','app'] },
  { tag: 'wellness', keywords: ['wellness','meditation','mindfulness','yoga','pilates','therapy','mental health','self care','healing','spa','massage','breathwork','journaling','retreat','holistic','sound bath'] },
  { tag: 'theater', keywords: ['theater','theatre','play','musical','broadway','off-broadway','improv','comedy show','show','performance','stage','acting','monologue','opera','ballet'] },
  { tag: 'social', keywords: ['social','networking','mixer','meetup','community','get-together','gathering','friends','connection','speed dating'] },
  { tag: 'activism', keywords: ['activism','protest','rally','march','advocacy','rights','justice','movement','organize','vote','civic','political'] },
];

export function generateAutoTags(event) {
  const text = [
    event.event_name || '',
    event.description || '',
    (event.location_data?.address) || '',
    (event.location_data?.city) || '',
  ].join(' ').toLowerCase();

  const tags = [];
  if (event.price_category === 'free') tags.push('free');

  for (const rule of TAG_RULES) {
    if (rule.tag === 'free' && tags.includes('free')) continue;
    if (rule.keywords.some(kw => text.includes(kw))) {
      if (!tags.includes(rule.tag)) tags.push(rule.tag);
    }
  }

  // 'reading' macro: attach when poetry or books match
  if ((tags.includes('books') || tags.includes('poetry')) && !tags.includes('reading')) {
    tags.push('reading');
  }

  const borough = event.borough || event.location_data?.city;
  const boroughMap = {
    'Manhattan': 'manhattan', 'Brooklyn': 'brooklyn', 'Queens': 'queens',
    'Bronx': 'bronx', 'Staten Island': 'staten island',
  };
  if (boroughMap[borough]) tags.push(boroughMap[borough]);

  return tags.slice(0, 7);
}