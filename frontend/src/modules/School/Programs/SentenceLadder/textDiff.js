/**
 * Character-level diff for the Review surface (design §5).
 *
 * The 2016 app pulled in google-diff-match-patch for this. Sentences here are
 * a few dozen characters, so a plain LCS table is exact, instant, and one
 * fewer dependency — the library's speedups all target documents.
 *
 * Operates on code POINTS so a Hangul syllable (or an emoji) is one unit and
 * never splits into halves that render as replacement characters.
 */

/**
 * @param {string} expected
 * @param {string} given
 * @returns {Array<{type: 'same'|'added'|'removed', text: string}>}
 */
export function diffChars(expected, given) {
  const a = [...String(expected ?? '')];
  const b = [...String(given ?? '')];

  // LCS length table.
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const parts = [];
  const push = (type, text) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('removed', a[i]); i += 1; }
    else { push('added', b[j]); j += 1; }
  }
  while (i < a.length) { push('removed', a[i]); i += 1; }
  while (j < b.length) { push('added', b[j]); j += 1; }

  return parts;
}

export default diffChars;
