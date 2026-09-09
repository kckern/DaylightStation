/**
 * A 두벌식 (2-set) Hangul input automaton.
 *
 * The Portal's WebView never sees an IME for the bonded physical keyboard —
 * neither AOSP LatinIME nor fcitx5 with its Hangul plugin emits a composition
 * event for physical keys there (see `_extensions/portal-keys/README.md`). So
 * composition happens in the page.
 *
 * Input is keyed off `KeyboardEvent.code`, never `key`, so the result does not
 * depend on whatever layout Android believes is attached.
 *
 * The automaton holds at most one syllable in flight; everything before it is
 * committed text that no longer changes. It knows nothing about the DOM —
 * `fieldComposer.js` is what maps its output onto a real input's value and
 * selection.
 */

const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// Unshifted / shifted jamo per physical key. Only the five doubled consonants
// and the two doubled vowels differ under Shift.
const LAYOUT = {
  KeyQ: ['ㅂ','ㅃ'], KeyW: ['ㅈ','ㅉ'], KeyE: ['ㄷ','ㄸ'], KeyR: ['ㄱ','ㄲ'], KeyT: ['ㅅ','ㅆ'],
  KeyY: ['ㅛ','ㅛ'], KeyU: ['ㅕ','ㅕ'], KeyI: ['ㅑ','ㅑ'], KeyO: ['ㅐ','ㅒ'], KeyP: ['ㅔ','ㅖ'],
  KeyA: ['ㅁ','ㅁ'], KeyS: ['ㄴ','ㄴ'], KeyD: ['ㅇ','ㅇ'], KeyF: ['ㄹ','ㄹ'], KeyG: ['ㅎ','ㅎ'],
  KeyH: ['ㅗ','ㅗ'], KeyJ: ['ㅓ','ㅓ'], KeyK: ['ㅏ','ㅏ'], KeyL: ['ㅣ','ㅣ'],
  KeyZ: ['ㅋ','ㅋ'], KeyX: ['ㅌ','ㅌ'], KeyC: ['ㅊ','ㅊ'], KeyV: ['ㅍ','ㅍ'],
  KeyB: ['ㅠ','ㅠ'], KeyN: ['ㅜ','ㅜ'], KeyM: ['ㅡ','ㅡ'],
};

const VOWEL_JOIN = {
  'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ',
  'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ',
  'ㅡㅣ':'ㅢ',
};
const FINAL_JOIN = {
  'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ',
  'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ', 'ㄹㅂ':'ㄼ', 'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ',
  'ㅂㅅ':'ㅄ',
};
// Reverse of the two join tables: how a compound comes apart, for Backspace and
// for the "final steals forward" rule.
const VOWEL_SPLIT = Object.fromEntries(Object.entries(VOWEL_JOIN).map(([k, v]) => [v, [k[0], k[1]]]));
const FINAL_SPLIT = Object.fromEntries(Object.entries(FINAL_JOIN).map(([k, v]) => [v, [k[0], k[1]]]));

const isVowel = (j) => JUNG.includes(j);

export class Hangul {
  constructor() { this.reset(); }

  reset() {
    this.committed = '';
    this.cho = null;   // jamo char, or null
    this.jung = null;
    this.jong = null;
  }

  /** The syllable currently being built, as displayable text. */
  get pending() {
    if (this.cho === null && this.jung === null) return '';
    if (this.cho !== null && this.jung === null) return this.cho;
    if (this.cho === null && this.jung !== null) return this.jung;
    const code = 0xac00
      + (CHO.indexOf(this.cho) * 21 + JUNG.indexOf(this.jung)) * 28
      + JONG.indexOf(this.jong ?? '');
    return String.fromCodePoint(code);
  }

  get text() { return this.committed + this.pending; }

  /** Freeze the in-flight syllable into committed text. */
  flush() {
    this.committed += this.pending;
    this.cho = this.jung = this.jong = null;
  }

  /** Feed one jamo. Returns true if the automaton consumed it. */
  jamo(j) {
    if (isVowel(j)) return this.#vowel(j);
    return this.#consonant(j);
  }

  #consonant(j) {
    // Nothing in flight, or only a bare consonant: a second consonant cannot
    // join the first, so the first stands alone.
    if (this.cho === null && this.jung === null) { this.cho = j; return true; }
    if (this.jung === null) { this.flush(); this.cho = j; return true; }

    if (this.jong === null) {
      if (JONG.includes(j)) { this.jong = j; return true; }
      this.flush(); this.cho = j; return true;
    }
    const joined = FINAL_JOIN[this.jong + j];
    if (joined) { this.jong = joined; return true; }
    this.flush(); this.cho = j; return true;
  }

  #vowel(j) {
    // A vowel with no initial is not a syllable — it stands as a bare jamo.
    if (this.cho === null && this.jung === null) { this.committed += j; return true; }

    if (this.jung === null) { this.jung = j; return true; }

    if (this.jong === null) {
      const joined = VOWEL_JOIN[this.jung + j];
      if (joined) { this.jung = joined; return true; }
      this.flush(); this.committed += j; return true;
    }

    // The defining rule of 두벌식: a vowel after a final steals that final
    // forward to become the next syllable's initial. 한 + ㅏ => 하나.
    const split = FINAL_SPLIT[this.jong];
    const stolen = split ? split[1] : this.jong;
    this.jong = split ? split[0] : null;
    this.flush();
    this.cho = stolen;
    this.jung = j;
    return true;
  }

  /** Literal text (space, punctuation, digits) ends the syllable. */
  literal(s) { this.flush(); this.committed += s; }

  /** Backspace peels one jamo off the syllable before touching committed text. */
  backspace() {
    if (this.jong !== null) {
      const split = FINAL_SPLIT[this.jong];
      this.jong = split ? split[0] : null;
      return true;
    }
    if (this.jung !== null) {
      const split = VOWEL_SPLIT[this.jung];
      this.jung = split ? split[0] : null;
      return true;
    }
    if (this.cho !== null) { this.cho = null; return true; }
    if (this.committed.length) {
      this.committed = [...this.committed].slice(0, -1).join('');
      return true;
    }
    return false;
  }

  static jamoFor(code, shift) {
    const pair = LAYOUT[code];
    return pair ? pair[shift ? 1 : 0] : null;
  }
}
