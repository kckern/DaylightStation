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

/**
 * THE CHECK-YOUR-WORK PANEL (2026-09-23): which characters of the learner's
 * attempt and of the answer are shared, so the matching parts can be LIT on
 * both lines. Case-insensitive, because "it" and "It" are the same word to a
 * child checking their work. Each line keeps its own letters and case.
 *
 * Only matches are marked. What differs is left plain rather than drawn in a
 * warning colour: the panel is "see how close you got", not a red pen.
 *
 * @returns {{given: Array<{text: string, match: boolean}>, answer: Array<{text: string, match: boolean}>}}
 */
export function matchParts(answer, given) {
  const a = [...String(answer ?? '')];
  const b = [...String(given ?? '')];
  // Fold case only where folding keeps each code point one code point, so a
  // position in the folded string is a position in the original.
  const fold = (chars) => chars.map((c) => {
    const lower = c.toLowerCase();
    return [...lower].length === 1 ? lower : c;
  });
  const parts = diffChars(fold(a).join(''), fold(b).join(''));
  const out = { given: [], answer: [] };
  const push = (list, text, match) => {
    if (!text) return;
    const last = list[list.length - 1];
    if (last && last.match === match) last.text += text;
    else list.push({ text, match });
  };
  let i = 0;
  let j = 0;
  for (const part of parts) {
    const n = [...part.text].length;
    if (part.type === 'same') {
      push(out.answer, a.slice(i, i + n).join(''), true);
      push(out.given, b.slice(j, j + n).join(''), true);
      i += n; j += n;
    } else if (part.type === 'removed') {
      push(out.answer, a.slice(i, i + n).join(''), false);
      i += n;
    } else {
      push(out.given, b.slice(j, j + n).join(''), false);
      j += n;
    }
  }
  return out;
}

export default diffChars;
