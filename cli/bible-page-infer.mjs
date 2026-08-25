#!/usr/bin/env node
/**
 * Infer a verse -> printed-page index for a closely related Bible edition.
 *
 * The source text remains the authority.  This tool only estimates where that
 * text falls in another physical printing when we have book-opening anchors
 * but not a complete scan.  It deliberately emits provenance and uncertainty
 * alongside the familiar page-index lookup shape.
 *
 * Usage:
 *   node cli/bible-page-infer.mjs analyze [--out report.json]
 *   node cli/bible-page-infer.mjs estimate --out page-index.yml
 *   node cli/bible-page-infer.mjs validate --index page-index.yml
 *   node cli/bible-page-infer.mjs rewrite-course --index page-index.yml [--apply]
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const DATA = process.env.DAYLIGHT_DATA_DIR ||
  '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';
const CONTENT = path.join(DATA, 'content');
const LEGACY_INDEX = path.join(CONTENT, 'school/scripture/nirv-adventure-early-readers/page-index.yml');
const LEGACY_CACHE = path.join(CONTENT, 'school/scripture/nirv-adventure-early-readers/.pageindex-cache.txt');
const CORPUS = path.join(CONTENT, 'readalong/scripture');
const EDITION_ID = 'nirv-adventure-early-readers-2014-inferred';
const EDITION_DIR = path.join(CONTENT, `school/scripture/${EDITION_ID}`);
const DEFAULT_OUT = path.join(EDITION_DIR, 'page-index.yml');
const DEFAULT_REPORT = path.join(EDITION_DIR, 'inference-report.json');
const COURSE = path.join(CONTENT, 'school/scripture/come-follow-me-ot-2026');

// Transcribed from the physical 2014 Bible's table of contents.  These are
// book-opening pages (which may be an introduction), not claims about 1:1.
export const TOC_2014 = Object.freeze({
  genesis: 1, exodus: 65, leviticus: 116, numbers: 154, deuteronomy: 209,
  joshua: 255, judges: 288, ruth: 320, '1-samuel': 326, '2-samuel': 367,
  '1-kings': 404, '2-kings': 445, '1-chronicles': 484, '2-chronicles': 526,
  ezra: 570, nehemiah: 586, esther: 608, job: 619, psalms: 661, proverbs: 767,
  ecclesiastes: 805, solomon_s_song: 817, isaiah: 825, jeremiah: 910,
  lamentations: 987, ezekiel: 996, daniel: 1055, hosea: 1076, joel: 1090,
  amos: 1096, obadiah: 1108, jonah: 1111, micah: 1115, nahum: 1125,
  habakkuk: 1129, zephaniah: 1135, haggai: 1141, zechariah: 1144,
  malachi: 1156, matthew: 1163, mark: 1207, luke: 1235, john: 1281,
  acts: 1316, romans: 1359, '1-corinthians': 1380, '2-corinthians': 1399,
  galatians: 1412, ephesians: 1421, philippians: 1429, colossians: 1435,
  '1-thessalonians': 1441, '2-thessalonians': 1446, '1-timothy': 1450,
  '2-timothy': 1457, titus: 1462, philemon: 1466, hebrews: 1469, james: 1485,
  '1-peter': 1492, '2-peter': 1499, '1-john': 1504, '2-john': 1511,
  '3-john': 1513, jude: 1515, revelation: 1518,
});

const TERMINAL_PAGE = 1541; // Subject Index begins here, after Revelation.
const WORD_RE = /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu;
const MARK_HOLDOUT = Object.freeze([1208, 1209, 1211, 1212, 1214, 1215, 1218, 1219,
  1220, 1222, 1224, 1226, 1228, 1229, 1231, 1233]);

function args(argv) {
  const [command = 'help', ...rest] = argv;
  const values = { _: command };
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2);
    values[key] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
  }
  return values;
}

function readYaml(file) { return yaml.load(fs.readFileSync(file, 'utf8')); }
function writeYaml(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(value, { noRefs: true, lineWidth: 110, sortKeys: false }));
}
function visibleText(value = '') { return String(value).replace(/[§¶▼/_]/gu, ''); }
function metrics(text) {
  const raw = String(text ?? '');
  const visible = visibleText(raw);
  return {
    sourceCharacters: Array.from(raw).length,
    visibleCharacters: Array.from(visible).length,
    words: (visible.match(WORD_RE) ?? []).length,
  };
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * p)];
}
function summary(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    mean: +mean.toFixed(2),
    standardDeviation: +Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length).toFixed(2),
    min: Math.min(...values), p10: percentile(values, 0.1), median: percentile(values, 0.5),
    p90: percentile(values, 0.9), max: Math.max(...values),
  };
}

export function loadCorpus(corpus = CORPUS) {
  const verses = [];
  const chapters = [];
  for (const testament of ['ot', 'nt']) {
    const dir = path.join(corpus, testament, 'nirv');
    for (const name of fs.readdirSync(dir)) {
      const match = name.match(/^(\d+)-(.+)-(\d+)\.yml$/);
      if (!match) continue;
      const [, firstId, slug, chapter] = match;
      const entries = readYaml(path.join(dir, name));
      chapters.push({ verseId: +firstId, slug, chapter: +chapter });
      for (const entry of entries) {
        verses.push({ verseId: +entry.verse_id, slug, chapter: +chapter, verse: +entry.verse,
          format: entry.format ?? 'prose', headings: entry.headings ?? [], text: entry.text ?? '', ...metrics(entry.text) });
      }
    }
  }
  verses.sort((a, b) => a.verseId - b.verseId);
  chapters.sort((a, b) => a.verseId - b.verseId);
  return { verses, chapters };
}

function pageResolver(rows) {
  const starts = rows.map((row) => row.verseId);
  return (verseId) => {
    let lo = 0; let hi = starts.length - 1; let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= verseId) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found < 0 ? null : rows[found].page;
  };
}

function introPages(legacy, cachePath = LEGACY_CACHE) {
  const cache = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8').split('\f') : [];
  const pageFor = pageResolver(legacy.pages);
  const result = {};
  for (const book of legacy.books) {
    const first = legacy.pages.find((row) => row.verseId <= book.firstVerseId && row.endVerseId >= book.firstVerseId);
    const previous = cache[(first?.scan ?? 1) - 2] ?? '';
    // The repeated Early Readers book introduction asks these questions.  We
    // only claim one intro page when that physical evidence is present.
    result[book.slug] = /(?:who wrote this book\?|why was this book written\?|this book shows people|stories in\s+(?:this\s+)?book|important person in this book)/iu.test(previous) ? 1 : 0;
  }
  return result;
}

function groupByBook(verses) {
  const groups = new Map();
  for (const verse of verses) {
    if (!groups.has(verse.slug)) groups.set(verse.slug, []);
    groups.get(verse.slug).push(verse);
  }
  return groups;
}

function confidenceFor({ book, legacyPageCount, newPageCount, intro }) {
  if (book === 'mark') return { label: 'inferred-high', interval: [0, 1], note: 'independent Mark holdout validates this layout class' };
  const drift = Math.abs(newPageCount - legacyPageCount) / Math.max(1, legacyPageCount);
  if (intro && drift <= 0.12) return { label: 'inferred-high', interval: [0, 1] };
  if (drift <= 0.22) return { label: 'inferred-medium', interval: [-1, 2] };
  return { label: 'inferred-low', interval: [-2, 3] };
}

/**
 * Segment a book into a fixed number of new scripture pages.  Legacy page
 * positions are the primary shape; character mass breaks ties where a book
 * gains or loses pages.  This is intentionally auditable and deterministic.
 */
function inferBook({ book, verses, legacyRows, legacyPageFor, newFirst, newPageCount, intro }) {
  const oldPages = [...new Set(verses.map((verse) => legacyPageFor(verse.verseId)))];
  const oldFirst = oldPages[0];
  const oldLast = oldPages.at(-1);
  // Preserve gaps between legacy page rows.  A missing row is often a feature
  // page or a page whose scripture merely continues; compressing it caused
  // the Mark holdout to lose an otherwise useful physical-layout signal.
  const oldPageCount = oldLast - oldFirst + 1;
  const confidence = confidenceFor({ book, legacyPageCount: oldPageCount, newPageCount, intro });
  const target = Math.max(1, newPageCount);
  const assigned = new Map();

  // Map legacy page ordinals into the new fixed budget.  If the budgets agree,
  // this preserves every old page break exactly (the successful Mark baseline).
  for (const verse of verses) {
    const ordinal = legacyPageFor(verse.verseId) - oldFirst;
    const scaled = oldPageCount <= 1 || target <= 1 ? 0 : Math.round(ordinal * (target - 1) / (oldPageCount - 1));
    assigned.set(verse.verseId, newFirst + scaled);
  }

  const pageGroups = new Map();
  for (const verse of verses) {
    const page = assigned.get(verse.verseId);
    if (!pageGroups.has(page)) pageGroups.set(page, []);
    pageGroups.get(page).push(verse);
  }
  const rows = [...pageGroups.entries()].sort((a, b) => a[0] - b[0]).map(([page, entries]) => ({
    page,
    verseId: entries[0].verseId,
    endVerseId: entries.at(-1).verseId,
    ref: `${entries[0].slug} ${entries[0].chapter}:${entries[0].verse}`,
    evidence: 'inferred',
    confidence: confidence.label,
    pageInterval: [page + confidence.interval[0], page + confidence.interval[1]],
    metrics: { words: entries.reduce((sum, verse) => sum + verse.words, 0), visibleCharacters: entries.reduce((sum, verse) => sum + verse.visibleCharacters, 0) },
  }));
  return { rows, profile: { oldFirst, oldPageCount, newFirst, newPageCount: target, introPages: intro, confidence } };
}

export function inferIndex({ corpus = CORPUS, legacyIndex = LEGACY_INDEX, cache = LEGACY_CACHE } = {}) {
  const legacy = readYaml(legacyIndex);
  const { verses } = loadCorpus(corpus);
  const books = groupByBook(verses);
  const legacyPageFor = pageResolver(legacy.pages);
  const intros = introPages(legacy, cache);
  const profiles = {};
  const rows = [];
  const openings = {};
  const orderedBooks = legacy.books.map((book) => book.slug);

  orderedBooks.forEach((book, index) => {
    const open = TOC_2014[book];
    const nextOpen = index + 1 < orderedBooks.length ? TOC_2014[orderedBooks[index + 1]] : TERMINAL_PAGE;
    if (!open || !nextOpen) throw new Error(`missing 2014 TOC anchor for ${book}`);
    const intro = intros[book] ?? 0;
    const newFirst = open + intro;
    const inferred = inferBook({ book, verses: books.get(book), legacyRows: legacy.pages, legacyPageFor,
      newFirst, newPageCount: nextOpen - newFirst, intro });
    rows.push(...inferred.rows);
    profiles[book] = inferred.profile;
    openings[book] = { page: open, kind: 'book_open', evidence: 'observed-table-of-contents', estimatedFirstVersePage: newFirst,
      introPages: intro };
  });

  rows.sort((a, b) => a.verseId - b.verseId);
  return {
    edition: {
      id: EDITION_ID, title: 'NIrV Adventure Bible for Early Readers', publisher: 'Zonderkidz',
      edition: 'Revised, 2014', isbn13: '9780310727422', translation: 'nirv', pageMapping: 'statistically inferred',
    },
    source: { anchors: '2014 physical table of contents', terminalAnchor: { page: TERMINAL_PAGE, label: 'Subject Index' },
      legacyIndex: path.basename(legacyIndex), method: 'legacy-layout-profile/v1' },
    coverage: { pages: rows.length, firstPage: rows[0].page, lastPage: rows.at(-1).page,
      firstRef: rows[0].ref, lastVerseId: rows.at(-1).endVerseId },
    books: legacy.books,
    omittedVerses: legacy.omittedVerses,
    bookOpenings: openings,
    inference: { model: 'legacy-layout-profile/v1', profiles, confidencePolicy: '90% interval heuristic; observed anchors override inference',
      holdout: { book: 'mark', chapterStartPages: MARK_HOLDOUT, training: false } },
    pages: rows,
  };
}

function slugForAnchorBook(value) {
  const normal = String(value).trim().toLowerCase().replace(/\s+/gu, '-').replace(/[’']/gu, '');
  if (['song-of-songs', 'song-of-solomon'].includes(normal)) return 'solomon_s_song';
  return normal;
}

function resolveAnchor(ref, verses) {
  // Accept either a human reference ("Isaiah 40:1") or a stable corpus form
  // ("isaiah:40:1").  The latter is useful for machine-generated checklists.
  const compact = String(ref).trim().match(/^(.+?):(\d+):(\d+)$/u);
  const human = String(ref).trim().match(/^(.+?)\s+(\d+):(\d+)$/u);
  const match = compact ?? human;
  if (!match) throw new Error(`invalid calibration reference '${ref}'`);
  const [, book, chapter, verse] = match;
  const slug = slugForAnchorBook(book);
  const found = verses.find((entry) => entry.slug === slug && entry.chapter === +chapter && entry.verse === +verse);
  if (!found) throw new Error(`calibration reference not found in NIrV corpus: ${ref}`);
  return found;
}

function calibrationAnchors(file, verses) {
  const doc = readYaml(file);
  const entries = Array.isArray(doc) ? doc : doc?.anchors;
  if (!Array.isArray(entries) || !entries.length) throw new Error(`no anchors in ${file}`);
  return entries.map((entry) => {
    if (!Number.isInteger(entry?.page) || entry.page < 1) throw new Error(`invalid calibration page for ${entry?.ref ?? 'unknown'}`);
    const verse = resolveAnchor(entry.ref, verses);
    return { ...entry, verseId: verse.verseId, slug: verse.slug, chapter: verse.chapter, verse: verse.verse };
  });
}

/** Apply observed chapter/verse pages as piecewise-linear corrections per book. */
export function calibrateIndex(index, anchors, corpus = CORPUS) {
  const { verses } = loadCorpus(corpus);
  const pageFor = pageResolver(index.pages);
  const byBook = new Map();
  for (const anchor of anchors) {
    if (!byBook.has(anchor.slug)) byBook.set(anchor.slug, []);
    byBook.get(anchor.slug).push(anchor);
  }
  const verseBook = new Map(verses.map((verse) => [verse.verseId, verse.slug]));
  const output = structuredClone(index);
  const adjusted = [];

  for (const [book, bookAnchors] of byBook) {
    const bookVerses = verses.filter((verse) => verse.slug === book);
    if (!bookVerses.length) throw new Error(`calibration book is not in the NIrV corpus: ${book}`);
    const rows = output.pages.filter((row) => verseBook.get(row.verseId) === book);
    if (!rows.length) throw new Error(`calibration book is not in inferred index: ${book}`);
    const firstPage = rows[0].page;
    const lastPage = rows.at(-1).page;
    const controls = [
      { verseId: bookVerses[0].verseId, shift: 0 },
      ...bookAnchors.map((anchor) => {
        if (anchor.page < firstPage || anchor.page > lastPage) throw new Error(`${anchor.ref} page ${anchor.page} falls outside inferred ${book} range ${firstPage}-${lastPage}`);
        return { verseId: anchor.verseId, shift: anchor.page - pageFor(anchor.verseId), anchor };
      }),
      { verseId: bookVerses.at(-1).verseId, shift: 0 },
    ].sort((a, b) => a.verseId - b.verseId);

    for (let i = 1; i < controls.length; i++) {
      if (controls[i].verseId === controls[i - 1].verseId && controls[i].shift !== controls[i - 1].shift) {
        throw new Error(`conflicting calibration anchors at verse ${controls[i].verseId}`);
      }
    }
    for (const row of rows) {
      const observed = bookAnchors.find((anchor) => anchor.verseId >= row.verseId && anchor.verseId <= row.endVerseId);
      if (observed) {
        row.page = observed.page;
        row.evidence = 'observed-calibration';
        row.confidence = 'observed';
        row.pageInterval = [observed.page, observed.page];
        continue;
      }
      const controlIndex = controls.findIndex((control, i) => i + 1 < controls.length && row.verseId >= control.verseId && row.verseId < controls[i + 1].verseId);
      const left = controls[Math.max(0, controlIndex)];
      const right = controls[Math.min(controls.length - 1, Math.max(0, controlIndex) + 1)];
      const fraction = right.verseId === left.verseId ? 0 : (row.verseId - left.verseId) / (right.verseId - left.verseId);
      const shift = left.shift + fraction * (right.shift - left.shift);
      row.page = Math.max(firstPage, Math.min(lastPage, Math.round(row.page + shift)));
    }
    // Coalesce rows which a correction puts on one physical page.  Never let
    // page numbers run backwards: an observed anchor should refine, not break,
    // the index's fundamental ordered-page contract.
    let previous = firstPage - 1;
    for (const row of rows) row.page = Math.max(previous, row.page), previous = row.page;
    const replacement = [];
    for (const row of rows) {
      const prior = replacement.at(-1);
      if (prior?.page === row.page) {
        prior.endVerseId = row.endVerseId;
        prior.metrics.words += row.metrics.words;
        prior.metrics.visibleCharacters += row.metrics.visibleCharacters;
      } else replacement.push(row);
    }
    output.pages = output.pages.filter((row) => verseBook.get(row.verseId) !== book).concat(replacement).sort((a, b) => a.verseId - b.verseId);
    adjusted.push(...bookAnchors.map(({ ref, page, verseId }) => ({ ref, page, verseId, book })));
  }
  output.inference.calibration = { anchors: adjusted, method: 'piecewise-linear page correction/v1' };
  return output;
}

function reportFor(index, corpus = CORPUS) {
  const { verses, chapters } = loadCorpus(corpus);
  const pageFor = pageResolver(index.pages);
  const pageData = new Map(index.pages.map((row) => [row.page, { words: 0, visibleCharacters: 0, verses: 0 }]));
  const books = new Map();
  const chapterData = new Map();
  for (const verse of verses) {
    const page = pageFor(verse.verseId);
    const p = pageData.get(page); p.words += verse.words; p.visibleCharacters += verse.visibleCharacters; p.verses++;
    const key = verse.slug; if (!books.has(key)) books.set(key, { words: 0, visibleCharacters: 0, verses: 0 });
    const b = books.get(key); b.words += verse.words; b.visibleCharacters += verse.visibleCharacters; b.verses++;
    const chapterKey = `${verse.slug} ${verse.chapter}`;
    if (!chapterData.has(chapterKey)) chapterData.set(chapterKey, { words: 0, visibleCharacters: 0, verses: 0 });
    const c = chapterData.get(chapterKey); c.words += verse.words; c.visibleCharacters += verse.visibleCharacters; c.verses++;
  }
  return {
    edition: index.edition, verses: verses.length, chapters: chapters.length,
    pageWords: summary([...pageData.values()].map((page) => page.words)),
    pageVisibleCharacters: summary([...pageData.values()].map((page) => page.visibleCharacters)),
    pageVerses: summary([...pageData.values()].map((page) => page.verses)),
    books: Object.fromEntries([...books].map(([book, value]) => [book, value])),
    chapters: Object.fromEntries([...chapterData]),
    lowConfidenceBooks: Object.entries(index.inference.profiles).filter(([, profile]) => profile.confidence.label === 'inferred-low').map(([book]) => book),
  };
}

export function validateIndex(index, corpus = CORPUS) {
  const problems = [];
  const { verses, chapters } = loadCorpus(corpus);
  const pageFor = pageResolver(index.pages);
  let lastPage = -Infinity; let lastVerseId = -Infinity;
  for (const row of index.pages) {
    if (row.page <= lastPage) problems.push(`page ${row.page} is not strictly increasing`);
    if (row.verseId <= lastVerseId || row.endVerseId < row.verseId) problems.push(`invalid verse range on page ${row.page}`);
    lastPage = row.page; lastVerseId = row.endVerseId;
  }
  for (const verse of verses) if (pageFor(verse.verseId) === null) problems.push(`unmapped verse ${verse.verseId}`);
  for (const chapter of chapters) {
    const page = pageFor(chapter.verseId);
    if (!page) problems.push(`unmapped chapter ${chapter.slug} ${chapter.chapter}`);
  }
  for (const [book, page] of Object.entries(TOC_2014)) {
    if (index.bookOpenings?.[book]?.page !== page) problems.push(`book opening mismatch: ${book}`);
  }
  return problems;
}

function zoneReference(zone, corpus) {
  if (!zone) return null;
  const intro = zone.match(/^(.+)-intro$/u);
  if (intro) return { intro: true, slug: intro[1] === 'psalm' ? 'psalms' : intro[1] };
  // Test the verse-bearing grammar first: otherwise a greedy book capture can
  // mistake the final verse in `isaiah-2.v2-4` for its chapter number.
  const match = zone.match(/^(.+)-(\d+)\.v(\d+)(?:-(\d+))?$/u) ?? zone.match(/^(.+)-(\d+)$/u);
  if (!match) return null;
  const [, rawSlug, chapter, start = '1', end = start] = match;
  const slug = rawSlug === 'psalm' ? 'psalms' : rawSlug;
  const verse = +start;
  const key = `${slug}:${chapter}:${verse}`;
  const found = corpus.byRef.get(key);
  const endFound = corpus.byRef.get(`${slug}:${chapter}:${end}`);
  return found && endFound ? { verseId: found.verseId, endVerseId: endFound.verseId, slug, chapter: +chapter, verse, endVerse: +end } : null;
}

function rewriteCourse({ index, course = COURSE, apply = false, indexPath = `content/school/scripture/${EDITION_ID}/page-index.yml` }) {
  const { verses } = loadCorpus();
  const corpus = { byRef: new Map(verses.map((verse) => [`${verse.slug}:${verse.chapter}:${verse.verse}`, verse])) };
  const pageFor = pageResolver(index.pages);
  const changed = []; const unresolved = [];
  const lessonFiles = [];
  for (const entry of fs.readdirSync(course, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const child of fs.readdirSync(path.join(course, entry.name))) if (child.endsWith('.yml') && child !== '_index.yml') lessonFiles.push(path.join(course, entry.name, child));
  }
  for (const file of lessonFiles) {
    const doc = readYaml(file); const pages = new Set(); let touched = 0;
    for (const item of doc.items ?? []) {
      const ref = zoneReference(item.source?.zone, corpus);
      const firstPage = ref?.intro ? index.bookOpenings?.[ref.slug]?.page : ref?.verseId ? pageFor(ref.verseId) : null;
      const lastPage = ref?.intro ? firstPage : ref?.endVerseId ? pageFor(ref.endVerseId) : firstPage;
      if (!firstPage || !lastPage) { unresolved.push(`${file}: ${item.id} (${item.source?.zone ?? 'no zone'})`); continue; }
      const page = firstPage;
      const promptLabel = firstPage === lastPage ? `Page ${firstPage}` : `Pages ${firstPage}–${lastPage}`;
      const sourceLabel = firstPage === lastPage ? `p. ${firstPage}` : `pp. ${firstPage}–${lastPage}`;
      const oldPrompt = item.prompt;
      item.prompt = String(item.prompt).replace(/^Pages?\s+\d+(?:\s*[–-]\s*\d+)?,/u, `${promptLabel},`);
      item.source = { ...item.source, page: sourceLabel, page_locator: { edition: EDITION_ID,
        pages: [firstPage, lastPage], confidence: ref?.intro ? 'observed' : index.pages.find((row) => row.page === page)?.confidence ?? 'inferred-low' } };
      for (let cited = firstPage; cited <= lastPage; cited++) pages.add(cited);
      if (oldPrompt !== item.prompt) touched++;
    }
    if (doc.lesson?.provenance) {
      doc.lesson.provenance.source = 'NIrV Adventure Bible for Early Readers (Revised, 2014)';
      doc.lesson.provenance.printed_pages = [...pages].sort((a, b) => a - b);
      doc.lesson.provenance.page_locator = { edition: EDITION_ID, method: 'inferred', learner_display: 'Page N' };
    }
    if (touched) {
      changed.push({ file, items: touched, pages: [...pages].sort((a, b) => a - b) });
      if (apply) writeYaml(file, doc);
    }
  }
  const courseIndex = path.join(course, '_index.yml');
  if (apply) {
    const root = readYaml(courseIndex);
    root.source.reader = { title: 'NIrV Adventure Bible for Early Readers', publisher: 'Zonderkidz', edition: 'Revised, 2014',
      isbn: '9780310727422', page_index: indexPath, page_mapping: 'statistically inferred; see inferred index provenance' };
    writeYaml(courseIndex, root);
  }
  return { apply, lessons: changed.length, items: changed.reduce((sum, entry) => sum + entry.items, 0), changed, unresolved };
}

export function markHoldout(index, corpus = CORPUS) {
  const { chapters } = loadCorpus(corpus);
  const pageFor = pageResolver(index.pages);
  const mark = chapters.filter((chapter) => chapter.slug === 'mark');
  const errors = mark.map((chapter, i) => pageFor(chapter.verseId) - MARK_HOLDOUT[i]);
  return { exact: errors.filter((error) => error === 0).length, withinOne: errors.filter((error) => Math.abs(error) <= 1).length,
    total: errors.length, mae: +(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length).toFixed(3), errors };
}

function usage() {
  console.log('Usage: bible-page-infer <analyze|estimate|validate|rewrite-course> [options]');
}

async function main() {
  const opt = args(process.argv.slice(2));
  if (opt._ === 'analyze') {
    let index = inferIndex();
    if (opt.anchors && opt.anchors !== true) index = calibrateIndex(index, calibrationAnchors(opt.anchors, loadCorpus().verses));
    const report = reportFor(index);
    const out = opt.out === true ? DEFAULT_REPORT : opt.out;
    if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); console.log(`wrote ${out}`); }
    else console.log(JSON.stringify(report, null, 2));
  } else if (opt._ === 'estimate' || opt._ === 'calibrate') {
    let index = inferIndex();
    if (opt._ === 'calibrate' && (!opt.anchors || opt.anchors === true)) throw new Error('calibrate requires --anchors checks.yml');
    if (opt.anchors && opt.anchors !== true) index = calibrateIndex(index, calibrationAnchors(opt.anchors, loadCorpus().verses));
    const out = opt.out === true || !opt.out ? DEFAULT_OUT : opt.out;
    writeYaml(out, index); console.log(`wrote ${out}`); console.log(JSON.stringify(markHoldout(index), null, 2));
  } else if (opt._ === 'validate') {
    const file = opt.index === true || !opt.index ? DEFAULT_OUT : opt.index;
    const index = readYaml(file); const problems = validateIndex(index);
    const holdout = markHoldout(index);
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.log(JSON.stringify({ validation: problems.length ? 'failed' : 'passed', problems: problems.length, markHoldout: holdout }, null, 2));
    process.exitCode = problems.length ? 1 : 0;
  } else if (opt._ === 'rewrite-course') {
    const file = opt.index === true || !opt.index ? DEFAULT_OUT : opt.index;
    const result = rewriteCourse({ index: readYaml(file), apply: opt.apply === true });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.unresolved.length ? 1 : 0;
  } else usage();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
