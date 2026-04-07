import { useState, useRef, useEffect } from 'react';

// Standard universal emojis organized by category (no skin tone variants)
const EMOJI_CATEGORIES = [
  {
    label: '😀 Faces', key: 'faces',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾']
  },
  {
    label: '👋 People', key: 'people',
    emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁','👅','👄','💋','🫦']
  },
  {
    label: '🐶 Animals', key: 'animals',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐈','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿','🦔']
  },
  {
    label: '🌸 Nature', key: 'nature',
    emojis: ['🌸','🌺','🌻','🌹','🌷','💐','🌱','🌿','☘️','🍀','🎋','🎍','🍃','🍂','🍁','🍄','🌾','💧','🌊','🌙','🌟','⭐','✨','🌈','☀️','🌤','⛅','🌥','☁️','🌦','🌧','⛈','🌩','🌨','❄️','🌪','🌫','🌬','🌀','🌈','🌂','☂️','🔥','💥','⚡','🌍','🌎','🌏','🗺','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞']
  },
  {
    label: '🍕 Food', key: 'food',
    emojis: ['🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍑','🍒','🍍','🥭','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🥕','🧅','🥔','🌽','🍠','🫘','🥜','🍞','🥐','🥖','🫓','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥙','🧆','🥚','🍜','🍝','🍛','🍲','🍣','🍱','🍤','🦐','🍙','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🫙','☕','🫖','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾']
  },
  {
    label: '⚽ Sports', key: 'sports',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥊','🥋','🎽','🛹','🛼','🛷','⛸','🥌','🎿','🛷','🥌','⛷','🏂','🏋️','🤸','🤼','🤽','🤺','🤾','🏇','⛹️','🧘','🏄','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖','🎗','🎯','🎮','🎲','♟','🎭','🎨']
  },
  {
    label: '🎵 Music', key: 'music',
    emojis: ['🎵','🎶','🎼','🎤','🎧','🎷','🎺','🎸','🎻','🥁','🪘','🎹','🪗','🎙','📻','🎚','🎛','📣','📢','🔔','🔕','🎊','🎉','🎈','🪄','🎪']
  },
  {
    label: '🎨 Art & Culture', key: 'art',
    emojis: ['🎨','🖌','🖼','🎭','🎬','🎥','📽','🎞','📸','📷','🎪','🎠','🎡','🎢','🎟','🎫','🏛','⛩','🕌','🕍','💒','🗿','🗽','🗼','🏯','🏰','⛺','🎑','🖋','✏️','📝','📚','📖','📰','🗞','📋','📌','📍','✂️','🧵','🧶','🪡']
  },
  {
    label: '💃 Party', key: 'party',
    emojis: ['🎉','🎊','🎈','🎁','🎀','🎆','🎇','🧨','🪅','🎏','🎐','🎑','🎃','🎄','🎋','🎍','🎎','🎠','🏮','🪔','💝','💖','💗','💓','💞','💕','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','💫','⭐','🌟','✨','💥','🔥','🌈']
  },
  {
    label: '🏙 City & Places', key: 'city',
    emojis: ['🏙','🌆','🌇','🌃','🌉','🌁','🗽','🗼','🏛','🏟','🏪','🏬','🏫','🏩','🏨','🏦','🏥','🏤','🏣','🏢','🏠','🏡','🏘','🏚','🏗','🧱','⛲','⛺','🌁','🌌','🎑','🗾','🏝','🏖','🏜','🏕','⛰','🌋','🗻','🏔','🌏','🌍','🌎','🗺']
  },
  {
    label: '🚗 Transport', key: 'transport',
    emojis: ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍','🛵','🚲','🛴','🛹','🛼','🚏','🚦','🚥','🛣','🛤','🚂','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚃','🚟','🚠','🚡','🚃','✈️','🛩','🛫','🛬','💺','🚁','🛸','🚀','⛵','🛥','🚢','⚓','⛽','🪝','🚧','🚦','🚨']
  },
  {
    label: '🌙 Night & Vibes', key: 'night',
    emojis: ['🌙','⭐','🌟','💫','✨','🌃','🏙','🍸','🍹','🥂','🍾','🎉','💃','🕺','🎶','🎵','🎸','🔥','💜','🌈','🎆','🎇','🪩','🕹','🎮']
  },
  {
    label: '📚 Books & Learning', key: 'books',
    emojis: ['📚','📖','📝','📓','📔','📒','📕','📗','📘','📙','📃','📄','📑','🗒','🗓','📆','📅','📇','📈','📉','📊','📋','🗂','🗃','🗄','🗑','📂','📁','🖋','✒️','📌','📍','✂️','🔭','🔬','🧬','🧪','🧫','🧲','💡','🔦','🕯','🪔','📡','🖥','💻','⌨️','🖱','🖨','📱','📲','📳','📴']
  },
  {
    label: '🫂 Community', key: 'community',
    emojis: ['🫂','👥','👤','🧑‍🤝‍🧑','💑','👨‍👩‍👧','👨‍👩‍👦','👨‍👩‍👧‍👦','🏘','🏡','🏫','🏥','⛪','🕌','🏛','🗳','📣','📢','🤝','🙌','👏','🫶','❤️','🌍','☮️','✊','✌️','🕊','🌱','🌿','💪']
  },
  {
    label: '🎓 Education', key: 'education',
    emojis: ['🎓','🏫','📚','📝','✏️','🖋','📐','📏','🔭','🔬','🧪','🧫','🧬','💡','🏆','🥇','📜','🗒','📋','🗃','🖥','💻','📊','📈','📉','⚗️','🔮','🧮','🔢','➕','➖','➗','✖️']
  },
  {
    label: '🌺 Wellness', key: 'wellness',
    emojis: ['🧘','🏃','🚴','🤸','💆','💅','🛀','🌺','🌿','🍃','💊','🩺','🏥','❤️','💚','🧡','💛','💙','🧠','🫁','🫀','🦷','🦴','🌱','☀️','🌊','🔋','🌟','✨']
  },
];

export default function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [catIdx, setCatIdx] = useState(0);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentCat = EMOJI_CATEGORIES[catIdx];
  const displayedEmojis = search
    ? EMOJI_CATEGORIES.flatMap(c => c.emojis).filter(e => {
        // simple search by category label
        return EMOJI_CATEGORIES.some(c => c.label.toLowerCase().includes(search.toLowerCase()) && c.emojis.includes(e));
      }).slice(0, 80)
    : currentCat.emojis;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-14 h-14 rounded-2xl border-3 border-black bg-white text-2xl hover:scale-105 transition-transform shadow-[3px_3px_0px_black] flex items-center justify-center ${open ? 'ring-2 ring-[#7C3AED]' : ''}`}
      >
        {value || '🔍'}
      </button>
      {open && (
        <div className="absolute z-50 top-16 left-0 bg-white border-3 border-black rounded-3xl shadow-[6px_6px_0px_black] w-80 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b-2 border-black">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search categories..."
              className="w-full border-2 border-black rounded-xl px-2 py-1 text-xs font-medium focus:outline-none" />
          </div>
          {/* Category tabs */}
          {!search && (
            <div className="flex overflow-x-auto gap-0.5 p-1.5 border-b-2 border-black bg-gray-50">
              {EMOJI_CATEGORIES.map((cat, i) => (
                <button key={cat.key} onClick={() => setCatIdx(i)}
                  className={`flex-shrink-0 px-2 py-1 rounded-xl text-xs font-black transition-colors whitespace-nowrap ${catIdx === i ? 'bg-[#7C3AED] text-white' : 'hover:bg-violet-100'}`}>
                  {cat.label.split(' ')[0]}
                </button>
              ))}
            </div>
          )}
          {/* Emoji grid */}
          <div className="grid grid-cols-9 gap-0.5 p-2 max-h-48 overflow-y-auto">
            {/* Clear button if selected */}
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                className="col-span-9 text-xs font-black text-red-500 hover:bg-red-50 rounded-xl py-1 mb-1 border border-red-200">
                ✕ Clear ({value})
              </button>
            )}
            {displayedEmojis.map(e => (
              <button key={e} type="button"
                onClick={() => { onChange(e === value ? '' : e); setOpen(false); }}
                className={`text-xl rounded-xl p-1 hover:bg-violet-100 transition-colors leading-none ${value === e ? 'bg-[#7C3AED] ring-2 ring-[#7C3AED]' : ''}`}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}