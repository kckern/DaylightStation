#!/usr/bin/env node

/**
 * Libretto CLI — turn a printed libretto into the corpus's own segment list.
 *
 * Written for Handel's Messiah (`plex:6918`), whose libretto PDF carries every
 * number's sequence position, its form, its voice, its sung text and its
 * scripture citation. The corpus wants all of that; the rail wants the names and
 * the forms; the timing aligner wants the forms most of all, because a form
 * implies a plausible duration and that is what makes a candidate boundary set
 * checkable rather than merely produced.
 *
 * THREE TRAPS, ALL SILENT, all measured on the real document:
 *
 *   1. `pdftotext -raw` destroys reading order on a two-column page. A
 *      strict-sequence filter over `-raw` recovered 16 numbers of 54. Use
 *      `-layout` and `splitColumns`.
 *   2. The PDF's own page numbers (12-17) parse as movement numbers.
 *   3. Eight numbers cite more than one passage and their verse CONTINUES after
 *      the first citation — stopping there loses 41 lines and 9 citations.
 *
 * Each is silent: a wrong reading produces a plausible file with wrong contents,
 * which nothing downstream could reveal. So each has a guard, and the guards
 * report rather than repair.
 *
 * Usage:
 *   node cli/libretto.cli.mjs <libretto.pdf> [out.json]
 *
 * @module cli/libretto
 */

const FORM_LINE = /^(Recitative|Air|Chorus|Duet|Soli|Sinfonia|Pifa|Symphony)\b\s*(?:\((.+?)\))?\s*$/;
/**
 * A number line, with an optional LETTER SUFFIX.
 *
 * Editions split some movements as `15a` / `15b` — here the two shepherd
 * recitatives — and the pair counts as ONE of the 53. A pattern demanding
 * whitespace straight after the digits skips both halves, and the only symptom
 * is the sequence checksum: the movement simply is not there.
 */
const NUM_LINE = /^(\d{1,2})([a-z])?\s+(.*)$/;
const CITE_LINE = /^\((.+?)\)\s*$/;
const PART_LINE = /^PART\s+(One|Two|Three)$/i;
/** Instrumental numbers name their own form: "2 Sinfonia (Ouverture)". */
const INSTRUMENTAL = /^(Sinfonia|Pifa|Symphony)\b\s*(?:\((.+?)\))?/;

/**
 * The forms this reader can label, derived from the pattern rather than kept by
 * hand. The duration gate checks itself against this list, and a hand-kept copy
 * is exactly how `Soli` came to be recognised here and unpriced there.
 */
export const RECOGNISED_FORMS = Object.freeze(
  FORM_LINE.source.match(/\(([^)]+)\)/)[1].split('|'),
);

/**
 * Split a `-layout` page into single-column reading order.
 *
 * The gutter is found per page as the column that is blank on the most lines —
 * derived rather than hardcoded, because the two columns do not start at the
 * same x on every page.
 *
 * IT DECLINES RATHER THAN GUESSES. A page with no convincing gutter (a title
 * page, or continuous prose) is returned untouched: splitting it would cut lines
 * in half, and the halves would fall through the parser's catch-all into the
 * previous number's text, which is silent corruption of the verse.
 */
export function splitColumns(laidOut, { blankRatio = 0.9 } = {}) {
  const pages = String(laidOut).split('\f');
  const out = [];
  for (const page of pages) {
    const lines = page.split('\n');
    const inked = lines.filter((l) => l.trim());
    const width = Math.max(0, ...lines.map((l) => l.length));
    if (width < 20 || inked.length < 2) { out.push(page); continue; }
    let best = -1;
    let bestScore = -1;
    for (let c = Math.floor(width * 0.3); c < Math.floor(width * 0.7); c += 1) {
      const score = inked.filter((l) => (l[c] ?? ' ') === ' ').length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best < 0 || bestScore < inked.length * blankRatio) { out.push(page); continue; }
    // Trimmed both ends: the right column's leading run is gutter padding, not
    // indentation, and carrying it forward would put every right-column line
    // through the parser wearing a margin.
    const left = lines.map((l) => l.slice(0, best).trim()).filter(Boolean);
    const right = lines.map((l) => l.slice(best).trim()).filter(Boolean);
    out.push([...left, ...right].join('\n'));
  }
  return out.join('\n');
}

/* -------------------------------------------------------------------------- */
/* COORDINATES, NOT WHITESPACE                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read `pdftotext -bbox` output into pages of words with their extents.
 *
 * This exists because `splitColumns` — which guesses a gutter from which text
 * column is most often blank — lost three movements outright on the real
 * libretto and emitted a fourth out of order. Word extents turn the same
 * question into an exact one.
 */
export function parseBbox(xml) {
  const unescape = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  const pages = [];
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  const wordRe = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g;
  for (const p of String(xml).matchAll(pageRe)) {
    const words = [...p[3].matchAll(wordRe)].map((w) => ({
      xMin: Number(w[1]), yMin: Number(w[2]), xMax: Number(w[3]), yMax: Number(w[4]),
      text: unescape(w[5]),
    }));
    pages.push({ width: Number(p[1]), height: Number(p[2]), words });
  }
  return pages;
}

/**
 * One page of words, in single-column reading order.
 *
 * THE GUTTER IS AN X NO WORD CROSSES. That is the whole idea, and it is exact
 * rather than statistical: a two-column page has a band of such x's between the
 * columns, and a page whose heading spans the full measure has none. So a
 * straddling heading DECLINES the split rather than being cut in half — which is
 * the failure that cost three movements, because the halves would fall through
 * the parser's catch-all into the previous number's verse, silently.
 *
 * `lineTol` groups words onto a baseline: `yMin` jitters by a fraction of a point
 * within a line, and exact equality would break every line into single words.
 */
export function columnize(page, { minGutterPt = 6, lineTol = 3 } = {}) {
  const words = page.words ?? [];
  if (!words.length) return '';

  const linesOf = (subset) => {
    const rows = [];
    for (const w of [...subset].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(w.yMin - row.y) <= lineTol) row.words.push(w);
      else rows.push({ y: w.yMin, words: [w] });
    }
    return rows.map((r) => r.words.sort((a, b) => a.xMin - b.xMin).map((w) => w.text).join(' '));
  };

  // Every x in the middle of the page that no word's extent crosses.
  const lo = page.width * 0.3;
  const hi = page.width * 0.7;
  const free = [];
  for (let x = lo; x <= hi; x += 0.5) {
    if (!words.some((w) => w.xMin < x && x < w.xMax)) free.push(x);
  }
  // The widest contiguous run of free x's is the gutter, if there is one.
  let bestStart = null; let bestLen = 0; let runStart = null; let prev = null;
  for (const x of free) {
    if (prev === null || x - prev > 0.75) runStart = x;
    const len = x - runStart;
    if (len > bestLen) { bestLen = len; bestStart = runStart; }
    prev = x;
  }
  if (bestStart === null || bestLen < minGutterPt) return linesOf(words).join('\n');

  const cut = bestStart + bestLen / 2;
  const left = words.filter((w) => w.xMax <= cut);
  const right = words.filter((w) => w.xMin >= cut);
  return [...linesOf(left), ...linesOf(right)].join('\n');
}

/**
 * Read a libretto's text into structured numbers.
 *
 * @param {string} rawText single-column reading order (see `splitColumns`).
 * @returns {{items: Array<object>, warnings: string[]}} `items` in corpus
 *   numbering 1..N with `Play All` dropped; `warnings` names every sequence
 *   break and unlabelled form rather than silently absorbing them.
 */
export function parseLibretto(rawText) {
  const warnings = [];
  const items = [];
  let pending = null;
  let current = null;
  for (const line of String(rawText).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    if (PART_LINE.test(s)) { current = null; pending = null; continue; }
    let m = FORM_LINE.exec(s);
    if (m) { pending = { form: m[1], voice: m[2] ?? null }; continue; }
    m = NUM_LINE.exec(s);
    if (m) {
      const pdfN = Number(m[1]);
      const suffix = m[2] ?? null;
      const title = m[3].trim();
      if (/^Play All$/i.test(title)) { pending = null; continue; }
      // A lettered continuation (`15b` after `15a`) is the SAME number: keep
      // appending to the entry already open rather than starting a new one.
      if (suffix && current && current.pdfN === pdfN) {
        current.text = current.text ? `${current.text}\n${title}` : title;
        pending = null;
        continue;
      }
      const inst = INSTRUMENTAL.exec(title);
      current = {
        n: 0,
        pdfN,
        part: null,
        form: inst ? inst[1] : (pending?.form ?? null),
        voice: inst ? null : (pending?.voice ?? null),
        incipit: inst ? inst[1] : title,
        cites: [],
        text: inst ? '' : title,
      };
      if (!current.form) warnings.push(`no form for "${title}"`);
      items.push(current);
      pending = null;
      continue;
    }
    m = CITE_LINE.exec(s);
    // EVERY citation, and the text keeps going after it: a number may draw on
    // several passages and resume its verse after the first.
    if (m && current) { current.cites.push(m[1]); continue; }
    if (current) {
      current.text = current.text ? `${current.text}\n${s}` : s;
    }
  }

  // THE PDF's OWN NUMBERS ARE A CHECKSUM. One number missed plus one page number
  // captured keeps the count right while shifting every name against its timing.
  for (let i = 1; i < items.length; i += 1) {
    if (items[i].pdfN !== items[i - 1].pdfN + 1) {
      warnings.push(`sequence break: PDF ${items[i - 1].pdfN} followed by ${items[i].pdfN}`);
    }
  }

  items.forEach((it, i) => {
    delete it.pdfN;
    it.n = i + 1;
    it.scripture = it.cites.length ? it.cites.join('; ') : null;
    delete it.cites;
  });
  return { items, warnings };
}

/**
 * WHERE THE PARTS DIVIDE — by anchor, never by reading order.
 *
 * Messiah divides 21 / 23 / 9, and the trial parse got that right — but only by
 * luck of layout: `pdftotext` can put a heading on the wrong side of a column
 * break, and the cost is silent, because the aligner uses Part membership to pin
 * the applause breaks. These two incipits open Parts Two and Three in every
 * edition, so they locate the divisions without trusting the column order.
 */
export const PART_ANCHORS = Object.freeze({
  Two: 'Behold the Lamb of God',
  Three: 'I know that my Redeemer liveth',
});

export function assignParts(items) {
  const find = (needle) => items.findIndex(
    (i) => i.incipit.toLowerCase().startsWith(needle.toLowerCase()),
  );
  const two = find(PART_ANCHORS.Two);
  const three = find(PART_ANCHORS.Three);
  if (two < 0) throw new Error(`Part Two anchor not found: "${PART_ANCHORS.Two}"`);
  if (three <= two) throw new Error(`Part Three anchor not found after Part Two: "${PART_ANCHORS.Three}"`);
  return items.map((it, i) => ({
    ...it,
    part: i < two ? 'One' : i < three ? 'Two' : 'Three',
  }));
}

/* -------------------------------------------------------------------------- */
/* CLI shell — all the I/O, so everything above stays unit-testable            */
/* -------------------------------------------------------------------------- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const pdf = process.argv[2];
  if (!pdf) {
    console.error('Usage: node cli/libretto.cli.mjs <libretto.pdf> [out.json]');
    process.exit(1);
  }
  // `-layout`, NOT `-raw`: this libretto is two-column and `-raw` interleaves
  // them so badly the movement numbers do not even ascend.
  const laid = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const { items, warnings } = parseLibretto(splitColumns(laid));
  warnings.forEach((w) => console.error(`warn: ${w}`));
  const withParts = assignParts(items);
  const counts = withParts.reduce((a, i) => ({ ...a, [i.part]: (a[i.part] ?? 0) + 1 }), {});
  console.error(`${withParts.length} numbers  parts=${JSON.stringify(counts)}`);
  fs.writeFileSync(process.argv[3] ?? 'libretto.json', JSON.stringify(withParts, null, 1));
}
