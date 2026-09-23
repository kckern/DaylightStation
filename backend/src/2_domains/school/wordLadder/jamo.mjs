/**
 * Hangul as keystrokes (spec §2 step 5). A typed answer's distance is counted
 * in two-set keyboard strokes: ㅟ is ㅜ then ㅣ, ㄺ is ㄹ then ㄱ; ㄲ/ㅖ are one
 * Shift+key. Tables mirror frontend/src/modules/School/ime/hangul.js.
 */
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const SPLIT = {
  'ㅘ': ['ㅗ','ㅏ'], 'ㅙ': ['ㅗ','ㅐ'], 'ㅚ': ['ㅗ','ㅣ'], 'ㅝ': ['ㅜ','ㅓ'], 'ㅞ': ['ㅜ','ㅔ'], 'ㅟ': ['ㅜ','ㅣ'], 'ㅢ': ['ㅡ','ㅣ'],
  'ㄳ': ['ㄱ','ㅅ'], 'ㄵ': ['ㄴ','ㅈ'], 'ㄶ': ['ㄴ','ㅎ'], 'ㄺ': ['ㄹ','ㄱ'], 'ㄻ': ['ㄹ','ㅁ'], 'ㄼ': ['ㄹ','ㅂ'],
  'ㄽ': ['ㄹ','ㅅ'], 'ㄾ': ['ㄹ','ㅌ'], 'ㄿ': ['ㄹ','ㅍ'], 'ㅀ': ['ㄹ','ㅎ'], 'ㅄ': ['ㅂ','ㅅ'],
};
const MAX_ANSWER = 40;
const keys = (j) => SPLIT[j] ?? [j];

export function normalizeAnswer(text) {
  return [...String(text ?? '').normalize('NFC')].slice(0, MAX_ANSWER).join('')
    .replace(/[\s\p{P}]/gu, '');
}

export function hasHangul(text) {
  return /[가-힣ㄱ-ㆎ]/u.test(String(text ?? ''));
}

export function keystrokeJamo(text) {
  const out = [];
  for (const ch of String(text ?? '')) {
    const index = ch.codePointAt(0) - 0xac00;
    if (index >= 0 && index < CHO.length * 21 * 28) {
      const jong = JONG[index % 28];
      const rest = (index - (index % 28)) / 28;
      out.push(CHO[Math.floor(rest / 21)], ...keys(JUNG[rest % 21]), ...(jong ? keys(jong) : []));
    } else {
      out.push(...keys(ch));
    }
  }
  return out;
}
