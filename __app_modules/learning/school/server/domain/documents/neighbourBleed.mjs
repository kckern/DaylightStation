/**
 * Neighbour bleed: on a printed OMR sheet, a dark mark in the row above or
 * below can be read into a row's own bubbles. A single-answer row that shows
 * several marks is therefore resolved conservatively: a mark `m` is a
 * candidate when EVERY OTHER mark of the row also appears among the raw marks
 * of row-1 or row+1 (the rows beside it explain them). Exactly one candidate
 * -> that mark is the child's answer; zero or several -> undecidable (null).
 *
 * Known wrong-resolution case: if the true answer equals a neighbour's
 * letter, the other mark can be chosen instead (e.g. 24:'B', 25:['B','C'],
 * 26:'D' resolves 25 to 'C'). Accepted: the rule only ever turns an
 * "ambiguous" row into a graded one.
 *
 * Pure. `answers` is the RAW decoded sheet map (row -> letter | letters[]).
 */
const marksOf = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export function resolveNeighbourBleed({ row, answers } = {}) {
  const marks = marksOf(answers?.[row]);
  if (marks.length < 2) return null;
  const above = marksOf(answers?.[row - 1]);
  const below = marksOf(answers?.[row + 1]);
  const explained = new Set([...above, ...below]);
  const candidates = marks.filter((m) => marks.every((o) => o === m || explained.has(o)));
  if (candidates.length !== 1) return null;
  const letter = candidates[0];
  return { letter, removed: marks.filter((m) => m !== letter), above, below };
}

export default { resolveNeighbourBleed };
