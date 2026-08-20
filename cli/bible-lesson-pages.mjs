#!/usr/bin/env node
// "Today we're studying X, Y and Z" -> which printed pages to turn to.
//
// Detects scripture references in free text, resolves them through the physical
// page index, and reports the page (or page span) a student should open to.
//
// Usage: node cli/bible-lesson-pages.mjs "Today we're studying Mark 3:15 and Psalm 23."

import fs from 'node:fs';
import yaml from 'js-yaml';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sg = require('scripture-guide');

const INDEX =
  process.env.PAGE_INDEX ||
  '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/school/scripture/nirv-adventure-early-readers/page-index.yml';

const index = yaml.load(fs.readFileSync(INDEX, 'utf8'));
const rows = index.pages;
const starts = rows.map((r) => r.verseId);
const omitted = new Set(index.omittedVerses || []);
const books = index.books || [];

// scripture-guide renders this book as "solomon_s_song" and cannot parse any of
// its ordinary English names — it even throws inside detectReferences. Rewrite
// the wording before it ever reaches the parser.
const SONG = /\b(?:the\s+)?song\s+of\s+(?:songs|solomon)\b/gi;
const deSong = (text) => text.replace(SONG, 'solomon_s_song');
const reSong = (ref) => ref.replace(/solomon_s_song/gi, 'Song of Songs');

function displayName(slug) {
  if (slug === 'solomon_s_song') return 'Song of Songs';
  return slug
    .split('-')
    .map((p) => (/^\d+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

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

export function extractRefs(text) {
  const cleaned = deSong(text);
  const found = [];

  // Lift Song of Songs references out first and blank them from the text. The
  // parser knows neither the book's English names nor scripture-guide's own
  // "solomon_s_song", and left in place the trailing "2:1" gets picked up as a
  // stray implied reference against whatever book was mentioned before it.
  let remainder = cleaned;
  for (const m of cleaned.matchAll(/solomon_s_song\s+\d+(?::\d+(?:\s*[-–]\s*\d+)?)?/gi)) {
    found.push(m[0]);
    remainder = remainder.replace(m[0], ' '.repeat(m[0].length));
  }

  let marked = '';
  try {
    marked = String(sg.detectReferences(remainder));
  } catch {
    marked = '';
  }
  for (const group of marked.matchAll(/\[([^\]]+)\]/g)) {
    for (const ref of group[1].split(';')) {
      if (ref.trim()) found.push(ref.trim());
    }
  }

  // A bare book name carries no chapter, so the parser ignores it — but
  // "we're reading Jude today" is exactly how a lesson gets announced.
  // Longest names first, blanking each match, so "3 John" is not also read
  // as a bare "John".
  const already = found.join(' ').toLowerCase();
  let residue = remainder.replace(SONG, 'Song of Songs');
  const named = [...books]
    .map((b) => displayName(b.slug))
    .sort((a, b) => b.length - a.length);
  for (const name of named) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\s*\\d)`, 'i');
    const hit = residue.match(pattern);
    if (!hit) continue;
    residue = residue.replace(pattern, ' '.repeat(hit[0].length));
    if (!already.includes(name.toLowerCase())) found.push(name);
  }
  return found;
}

export function resolve(ref) {
  // A bare book name never parses as a reference; resolve it from the index.
  const whole = books.find((b) => displayName(b.slug).toLowerCase() === ref.trim().toLowerCase());
  if (whole) {
    const first = pageFor(whole.firstVerseId);
    const last = pageFor(whole.lastVerseId);
    return { ref: displayName(whole.slug), wholeBook: true, first, last, pages: [first, last] };
  }

  let parsed;
  try {
    parsed = sg.lookupReference(deSong(ref));
  } catch (err) {
    return { ref, error: err.message };
  }
  if (parsed?.error || !parsed?.verse_ids?.length) {
    return { ref, error: parsed?.error || 'not recognised' };
  }

  const ids = parsed.verse_ids;
  const printed = ids.filter((v) => !omitted.has(v));
  const label = reSong(sg.generateReference(ids) || ref);

  if (!printed.length) {
    return { ref: label, missing: true, error: 'this verse is not printed in the NIrV' };
  }
  const pages = [...new Set(printed.map(pageFor).filter((p) => p !== null))].sort((a, b) => a - b);
  if (!pages.length) return { ref: label, error: 'outside the indexed edition' };

  return {
    ref: label,
    verses: printed.length,
    dropped: ids.length - printed.length,
    first: pages[0],
    last: pages[pages.length - 1],
    pages,
  };
}

export function lesson(text) {
  return extractRefs(text).map(resolve);
}

function describe(r) {
  if (r.missing) return `${r.ref.padEnd(24)} —  ${r.error}`;
  if (r.error) return `${r.ref.padEnd(24)} !! ${r.error}`;
  const span = r.first === r.last ? `page ${r.first}` : `pages ${r.first}–${r.last}`;
  const note = r.dropped ? `  (${r.dropped} verse${r.dropped > 1 ? 's' : ''} not printed in the NIrV)` : '';
  return `${r.ref.padEnd(24)} ${span}${note}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv.slice(2).join(' ');
  if (!text) {
    console.error('Usage: bible-lesson-pages.mjs "Today we are studying ..."');
    process.exit(1);
  }
  const found = lesson(text);
  if (!found.length) {
    console.log('No scripture references detected.');
    process.exit(0);
  }
  for (const r of found) console.log('  ' + describe(r));
}
