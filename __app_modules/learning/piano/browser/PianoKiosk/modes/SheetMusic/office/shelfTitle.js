// shelfTitle.js — a score's printed title, set as a title on an office card.
//
// Titles arrive as the files print them, often sentence case or all lowercase
// ("Santa Claus is coming to town"). Across a row of cards that reads as raw
// data, so the office picker sets them in headline case: every word's first
// letter raised, the small joining words kept small after the first word.
// It only ever raises a letter, never lowers one, so "BWV", "No." and "Für"
// keep their own case. Words are split on spaces (not `\b`), so an accented
// letter is never mistaken for a word boundary.

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);

const raise = (word) => {
  const at = word.search(/\p{L}/u);
  return at === -1 ? word : word.slice(0, at) + word[at].toLocaleUpperCase() + word.slice(at + 1);
};

export function shelfTitle(raw) {
  const words = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  return words.map((word, index) => {
    const opensGroup = /^[([{"“‘']/.test(word);
    if (index > 0 && !opensGroup && SMALL.has(word.toLowerCase())) return word;
    return raise(word);
  }).join(' ');
}
