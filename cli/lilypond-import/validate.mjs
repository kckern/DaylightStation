/**
 * validate — the gate that decides whether a converted score may be installed.
 *
 * THIS IS LOAD-BEARING, NOT DEFENSIVE POLISH. The upstream converter (python-ly)
 * fails by emitting a well-formed MusicXML document containing an empty part —
 * and exits 0 while doing it. On the target corpus that silent mode was 18 of 38
 * files. Any pipeline that trusts the exit code ships 18 blank scores and only
 * finds out when someone taps one on the kiosk.
 *
 * The grand-staff invariant is equally strict. Learn mode maps staff 0 → right
 * hand and staff 1 → left hand (activeParts.js). A score that converts as two
 * one-staff parts renders correctly but silently breaks HandsControl, so shape
 * is checked here rather than discovered later.
 */

/** Count occurrences of a MusicXML element, namespace-agnostic. */
function countTag(xml, tag) {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${tag}\\b`, 'g');
  return (xml.match(re) || []).length;
}

/** Read every `<staves>N</staves>` and return the largest. */
function maxStaves(xml) {
  const found = [...xml.matchAll(/<(?:[A-Za-z0-9]+:)?staves>\s*(\d+)\s*<\//g)].map((m) => Number(m[1]));
  return found.length ? Math.max(...found) : 1;
}

/**
 * @returns {{ok: boolean, reasons: string[], stats: object}}
 */
export function validateScore(xml, opts = {}) {
  const { requireGrandStaff = true, minNotes = 1, minMeasures = 1 } = opts;
  const text = String(xml || '');
  const reasons = [];

  if (!text.trim()) {
    return { ok: false, reasons: ['empty output'], stats: { parts: 0, notes: 0, measures: 0, staves: 0, fingerings: 0 } };
  }
  if (!/<score-partwise|<score-timewise/.test(text)) reasons.push('not a MusicXML score document');

  const stats = {
    parts: countTag(text, 'part') - countTag(text, 'part-list') - countTag(text, 'part-name') - countTag(text, 'part-abbreviation'),
    notes: countTag(text, 'note'),
    measures: countTag(text, 'measure'),
    staves: maxStaves(text),
    fingerings: countTag(text, 'fingering'),
  };
  // `<part id=...>` bodies only — `<score-part>` entries in the part-list share
  // the prefix and would otherwise double the count.
  stats.parts = (text.match(/<(?:[A-Za-z0-9]+:)?part\s+id=/g) || []).length;

  if (stats.notes < minNotes) reasons.push(`no notes (found ${stats.notes})`);
  if (stats.measures < minMeasures) reasons.push(`no measures (found ${stats.measures})`);
  if (requireGrandStaff) {
    if (stats.parts !== 1) reasons.push(`expected exactly 1 part, found ${stats.parts}`);
    if (stats.staves !== 2) reasons.push(`expected a 2-staff grand staff, found ${stats.staves}`);
  }
  return { ok: reasons.length === 0, reasons, stats };
}

export default { validateScore };
