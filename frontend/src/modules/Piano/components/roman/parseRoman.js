// frontend/src/modules/Piano/components/roman/parseRoman.js
// Split a roman-numeral chord token into typographic parts. Input uses the
// project's convention (case = quality, ° dim, + aug, b/# accidental prefix,
// trailing figure = extension/inversion). Pure.
export function parseRoman(token) {
  if (!token || token === '?') return { accidental: '', numeral: '·', quality: 'unknown', figure: '', isMinor: false };
  const m = String(token).match(/^([b#]?)([iIvV]+)(°|\+)?(.*)$/);
  if (!m) return { accidental: '', numeral: '·', quality: 'unknown', figure: '', isMinor: false };
  const [, acc, num, symbol, rest] = m;
  const isMinor = num === num.toLowerCase();
  let quality = isMinor ? 'minor' : 'major';
  if (symbol === '°') quality = 'dim';
  else if (symbol === '+') quality = 'aug';
  const accidental = acc === 'b' ? '♭' : acc === '#' ? '♯' : '';
  return { accidental, numeral: num, quality, figure: (rest || '').trim(), isMinor };
}

export default parseRoman;
