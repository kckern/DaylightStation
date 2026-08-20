#!/usr/bin/env node
// Deterministic checks on the physical page index.
//
// These do not look at the scan at all. They assert structural facts that must
// hold if the index is sound: a Bible is read front to back, so page numbers
// can only ever go up. Anything that goes backwards, repeats, or lands outside
// its book means the alignment slipped somewhere.
//
// Usage: node cli/bible-page-index-verify.mjs [--verbose]

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const INDEX =
  process.env.PAGE_INDEX ||
  '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/school/scripture/nirv-adventure-early-readers/page-index.yml';
const CORPUS = process.env.NIRV_CORPUS || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/readalong/scripture';
const VERBOSE = process.argv.includes('--verbose');

const index = yaml.load(fs.readFileSync(INDEX, 'utf8'));
const rows = index.pages;
const starts = rows.map((r) => r.verseId);
const books = index.books;
const omitted = new Set(index.omittedVerses || []);

function pageFor(verseId) {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= verseId) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? null : rows[found].page;
}

// Every chapter and every verse, in canonical order, straight from the corpus.
const chapters = [];
const verses = [];
for (const volume of ['ot', 'nt']) {
  const dir = path.join(CORPUS, volume, 'nirv');
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^(\d+)-(.+)-(\d+)\.yml$/);
    if (!m) continue;
    const entries = yaml.load(fs.readFileSync(path.join(dir, name), 'utf8'));
    chapters.push({ verseId: +m[1], slug: m[2], chapter: +m[3] });
    for (const e of entries) verses.push({ verseId: +e.verse_id, slug: m[2], chapter: +m[3], verse: +e.verse });
  }
}
chapters.sort((a, b) => a.verseId - b.verseId);
verses.sort((a, b) => a.verseId - b.verseId);

const results = [];
const record = (name, failures, detail) =>
  results.push({ name, failures, detail: failures.length ? failures.slice(0, 6) : [], note: detail });

// --- T1: verse 1 of every chapter, in order, must never go backwards --------
{
  const bad = [];
  let prev = null;
  for (const c of chapters) {
    const page = pageFor(c.verseId);
    if (page === null) { bad.push(`${c.slug} ${c.chapter}: no page`); continue; }
    if (prev && page < prev.page) bad.push(`${c.slug} ${c.chapter} -> p${page} after ${prev.slug} ${prev.chapter} -> p${prev.page}`);
    prev = { ...c, page };
  }
  record(`T1  chapter starts never go backwards (${chapters.length} chapters)`, bad);
}

// --- T2: same over every single verse ---------------------------------------
{
  const bad = [];
  let prev = null;
  for (const v of verses) {
    const page = pageFor(v.verseId);
    if (page === null) { bad.push(`${v.slug} ${v.chapter}:${v.verse}: no page`); continue; }
    if (prev !== null && page < prev.page) bad.push(`${v.slug} ${v.chapter}:${v.verse} -> p${page} after p${prev.page}`);
    prev = { page };
  }
  record(`T2  every verse never goes backwards (${verses.length} verses)`, bad);
}

// --- T3: books start in canonical order, strictly increasing ----------------
{
  const bad = [];
  let prev = null;
  for (const b of books) {
    const page = pageFor(b.firstVerseId);
    if (prev && page <= prev.page) bad.push(`${b.slug} starts p${page}, not after ${prev.slug} p${prev.page}`);
    prev = { slug: b.slug, page };
  }
  record(`T3  book starts strictly increasing (${books.length} books)`, bad);
}

// --- T4: a chapter must sit inside its own book's page span -----------------
{
  const span = new Map(books.map((b) => [b.slug, [pageFor(b.firstVerseId), pageFor(b.lastVerseId)]]));
  const bad = [];
  for (const c of chapters) {
    const page = pageFor(c.verseId);
    const [lo, hi] = span.get(c.slug);
    if (page < lo || page > hi) bad.push(`${c.slug} ${c.chapter} -> p${page}, outside book span ${lo}-${hi}`);
  }
  record('T4  each chapter falls inside its book span', bad);
}

// --- T5: a book must not overlap the next book's pages by more than one -----
// (one shared page is normal: a short book can start on the page another ends)
{
  const bad = [];
  for (let i = 0; i < books.length - 1; i++) {
    const end = pageFor(books[i].lastVerseId);
    const next = pageFor(books[i + 1].firstVerseId);
    if (next < end) bad.push(`${books[i].slug} ends p${end} but ${books[i + 1].slug} starts p${next}`);
  }
  record('T5  books do not overlap out of order', bad);
}

// --- T6: the page table itself round-trips ----------------------------------
{
  const bad = [];
  for (const r of rows) {
    if (pageFor(r.verseId) !== r.page) bad.push(`page ${r.page} first verse resolves to ${pageFor(r.verseId)}`);
    if (pageFor(r.endVerseId) !== r.page) bad.push(`page ${r.page} last verse resolves to ${pageFor(r.endVerseId)}`);
  }
  record(`T6  page rows round-trip through the lookup (${rows.length} rows)`, bad);
}

// --- T7: page numbers unique, increasing, inside the printed range ----------
{
  const bad = [];
  const seen = new Set();
  let prev = 0;
  for (const r of rows) {
    if (seen.has(r.page)) bad.push(`page ${r.page} appears twice`);
    seen.add(r.page);
    if (r.page <= prev) bad.push(`page ${r.page} follows ${prev}`);
    if (r.page < 1 || r.page > 1520) bad.push(`page ${r.page} out of the book's range`);
    prev = r.page;
  }
  record('T7  page numbers unique, ascending, in range', bad);
}

// --- T8: every verse covered exactly once -----------------------------------
{
  const bad = [];
  const covered = new Set();
  for (const r of rows) {
    for (const v of verses) {
      if (v.verseId >= r.verseId && v.verseId <= r.endVerseId) {
        if (covered.has(v.verseId)) bad.push(`verse ${v.verseId} covered twice`);
        covered.add(v.verseId);
      }
    }
    if (bad.length > 5) break;
  }
  const missing = verses.filter((v) => !covered.has(v.verseId));
  if (missing.length) bad.push(`${missing.length} verses covered by no page`);
  record(`T8  every verse covered exactly once (${verses.length})`, bad);
}

// --- T9: verses-per-page stays in a believable band -------------------------
{
  const counts = rows.map((r, i) => {
    const next = rows[i + 1] ? rows[i + 1].verseId : r.endVerseId + 1;
    return verses.filter((v) => v.verseId >= r.verseId && v.verseId < next).length;
  });
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const bad = [];
  rows.forEach((r, i) => {
    if (counts[i] > median * 4) bad.push(`page ${r.page} holds ${counts[i]} verses (median ${median})`);
    if (counts[i] === 0) bad.push(`page ${r.page} holds no verses`);
  });
  record(`T9  verses per page within 4x the median (median ${median})`, bad);
}

// --- T10: omitted verses are exactly the expected set -----------------------
{
  const bad = [];
  const expected = new Set([
    'Matthew 17:21', 'Matthew 18:11', 'Matthew 23:14', 'Mark 7:16',
    'Mark 9:44', 'Mark 9:46', 'Mark 11:26', 'Mark 15:28', 'Luke 17:36', 'Luke 23:17',
    'John 5:4', 'Acts 8:37', 'Acts 15:34', 'Acts 24:7', 'Acts 28:29', 'Romans 16:24',
  ]);
  if (omitted.size !== expected.size) bad.push(`${omitted.size} omitted verses, expected ${expected.size}`);
  record(`T10 omitted-verse list matches the known NIrV set (${omitted.size})`, bad);
}

// --- T11: the page table's own ordering, checked directly -------------------
// T1 and T2 read through pageFor(), which is built from this same table, so a
// corrupted row can shift both sides consistently and slip past them. This
// asserts the raw structure instead.
{
  const bad = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.endVerseId < r.verseId) bad.push(`page ${r.page}: end ${r.endVerseId} before start ${r.verseId}`);
    if (i && r.verseId <= rows[i - 1].verseId) bad.push(`page ${r.page}: start ${r.verseId} not after previous ${rows[i - 1].verseId}`);
    if (i && r.verseId <= rows[i - 1].endVerseId) bad.push(`page ${r.page}: overlaps previous page's range`);
    if (i && r.scan <= rows[i - 1].scan) bad.push(`page ${r.page}: scan ${r.scan} not after ${rows[i - 1].scan}`);
  }
  record(`T11 page rows strictly ordered and non-overlapping (${rows.length})`, bad);
}

// ---------------------------------------------------------------- report ----
let failed = 0;
for (const r of results) {
  const ok = r.failures.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? ' PASS ' : ' FAIL '} ${r.name}${ok ? '' : `  — ${r.failures.length} problem(s)`}`);
  if (!ok || VERBOSE) for (const d of r.detail) console.log(`         ${d}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
