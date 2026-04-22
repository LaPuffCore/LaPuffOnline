// Unicode font conversion utilities for GeoPost rich text editor

// NOTE: Spread [...str] correctly handles surrogate pairs for Math Unicode chars
export const COOL_FONTS = {
  script:      { label: '𝓢𝓬𝓻𝓲𝓹𝓽',  name: 'Script',       upper: '𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩', lower: '𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃' },
  fraktur:     { label: '𝔉𝔯𝔞𝔨',      name: 'Fraktur',      upper: '𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ', lower: '𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷' },
  doubleStruck:{ label: '𝔻𝕠𝕦𝕓',      name: 'Double-Struck', upper: '𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ', lower: '𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫' },
  monospace:   { label: '𝙼𝚘𝚗𝚘',      name: 'Monospace',    upper: '𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉', lower: '𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣' },
  fullWidth:   { label: 'Ｆｕｌｌ',    name: 'Full-Width',   upper: 'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ', lower: 'ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ' },
  smallCaps:   { label: 'ꜱᴍᴀʟʟ',     name: 'Small Caps',   upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',  lower: 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ' },
  circled:     { label: 'Ⓒⓘⓡⓒ',      name: 'Circled',      upper: 'ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ', lower: 'ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ' },
  squared:     { label: '🅂🅀🄿',       name: 'Squared',      upper: '🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉', lower: '🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉' },
};

const ZALGO_UP   = ['̍','̎','̄','̅','̿','̑','̆','̐','͒','͗','̇','̈','̊','̓','̈́','̃','̂','̌','̀','́','̋','̏'];
const ZALGO_DOWN = ['̖','̗','̘','̙','̜','̝','̞','̟','̠','̤','̥','̦','̩','̪','̫','̬','̭','̮','̯','̰'];

export function toZalgo(text) {
  return [...text].map(c => {
    if (!/[a-zA-Z0-9]/.test(c)) return c;
    let r = c;
    for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++)
      r += ZALGO_UP[Math.floor(Math.random() * ZALGO_UP.length)];
    if (Math.random() > 0.5)
      r += ZALGO_DOWN[Math.floor(Math.random() * ZALGO_DOWN.length)];
    return r;
  }).join('');
}

export function convertFont(text, key) {
  if (key === 'zalgo') return toZalgo(text);
  const map = COOL_FONTS[key];
  if (!map) return text;
  const upper = [...map.upper];
  const lower = [...map.lower];
  return [...text].map(c => {
    const u = c.charCodeAt(0) - 65;
    const l = c.charCodeAt(0) - 97;
    if (u >= 0 && u < 26 && upper[u]) return upper[u];
    if (l >= 0 && l < 26 && lower[l]) return lower[l];
    return c;
  }).join('');
}

// All font options including zalgo
export const ALL_COOL_FONTS = [
  ...Object.entries(COOL_FONTS).map(([key, v]) => ({ key, label: v.label, name: v.name })),
  { key: 'zalgo', label: 'Ẓą̯l͖g̢o', name: 'Zalgo/Glitch' },
];
