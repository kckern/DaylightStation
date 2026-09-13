/**
 * One column per target syllable: what belongs there, what the learner put
 * there, and how it should be drawn. The rung renders two rows on one grid —
 * the model above, the answer directly beneath — and this decides both.
 *
 * The index of the live column is `Array.from(committed).length` and NOTHING
 * else. Deriving it from the field's value instead is what made the prompt
 * collapse on the first keystroke of every new syllable: in 두벌식 a consonant
 * is genuinely ambiguous until the next vowel lands, so typing 오늘 leaves the
 * field reading 온 — a real word, two glyphs — after ㄴ, and only the next
 * vowel decides whether that ㄴ closed 오 or opened 늘. Fed the field value the
 * strip would call column 0 settled-and-wrong and jump the cursor, then undo
 * itself a keystroke later. Fed the IME's COMMITTED prefix
 * (`FieldComposer.compositionState(el) → { committed, pending }`) it simply
 * does not move until the ambiguity resolves.
 *
 * There is deliberately no "wrong" state for `pending`: a half-built syllable
 * is not yet incorrect, it is unfinished. Callers that must judge a keystroke
 * as it lands use a prefix oracle, not this.
 *
 * @param {{target: string, committed: string, pending: string,
 *          reveal?: 'model'|'all'|'none'}} args
 *   reveal — 'model' (default) shows current + one ghosted next; 'all' is a
 *   peek; 'none' is blind listen mode.
 * @returns {Array<{want: string, got: string|null, state: string}>}
 */
export function columnsFor({ target, committed, pending = '', reveal = 'model' } = {}) {
  // A rung mounts before the day's sentence has arrived. A missing target is an
  // empty strip, not a crash — the same guard covers a caller mid-load and a
  // sentence that failed to fetch.
  if (typeof target !== 'string' || target === '') return [];

  // `Array.from` and not `.split('')`: precomposed Hangul syllables are single
  // code points, but nothing here may assume BMP-only — a surrogate pair must
  // be ONE column, not two half-columns.
  const want = Array.from(target);
  const got = Array.from(typeof committed === 'string' ? committed : '');
  const ghost = typeof pending === 'string' ? pending : '';
  const at = got.length;

  return want.map((glyph, i) => {
    // A SETTLED COLUMN IS STILL SUBJECT TO `reveal`. Returning the model glyph
    // here regardless turned listen mode into an answer key: every syllable the
    // learner committed — right OR WRONG — printed the correct one above it, so
    // typing anything at all walked the sentence out one glyph at a time and
    // the learner could simply copy it back before submitting. Found by
    // rendering the rung, not by a test; no assertion anywhere covered
    // `reveal: 'none'` with committed text in it. The state is kept, so `done`
    // and `wrong` still colour the learner's own row.
    if (i < at) {
      return { want: reveal === 'none' ? '' : glyph, got: got[i], state: got[i] === glyph ? 'done' : 'wrong' };
    }
    // THE LIVE COLUMN IS NEVER BLIND — it belongs to the learner, not the model.
    // This branch used to sit BELOW the blind one, so in listen mode the column
    // the child was actually typing into came back `blind` with `got: null`:
    // no caret anywhere on the strip, and the syllable still in the IME's
    // pending buffer invisible. Typing 오늘 drew one green 오 and nine empty
    // writing lines, and the final syllable of every sentence stayed invisible
    // right up to Submit. Withholding the model is the point of listen mode;
    // withholding the learner's own keystrokes is just a broken screen. Same
    // trick as the settled column above — blank the `want`, keep everything
    // that is the learner's.
    if (i === at) {
      return { want: reveal === 'none' ? '' : glyph, got: ghost || null, state: 'current' };
    }
    if (reveal === 'none') return { want: glyph, got: null, state: 'blind' };
    if (reveal === 'all') return { want: glyph, got: null, state: 'next' };
    return { want: glyph, got: null, state: i === at + 1 ? 'next' : 'hidden' };
  });
}

export default columnsFor;
