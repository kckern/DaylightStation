#!/usr/bin/env node
// Render the printable verse -> page index for a physical Bible edition.
//
// Reads the YAML index produced by the readalong corpus' build-page-index.py
// and typesets a booklet sized to the book itself, so it can be printed and
// bound into the back. Page numbers are the printed book's own.
//
// Usage: node cli/bible-page-index-pdf.mjs [out.pdf]

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import PDFDocument from 'pdfkit';

const INDEX =
  process.env.PAGE_INDEX ||
  '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/school/scripture/nirv-adventure-early-readers/page-index.yml';
const CORPUS = process.env.NIRV_CORPUS || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/readalong/scripture';
const OUT = process.argv[2] || path.join(process.cwd(), 'nirv-adventure-page-index.pdf');

// Trimmed to the book's own page size so the printed sheets bind in flush.
const PAGE = { width: 372.8, height: 574.4 };
const MARGIN = { top: 34, bottom: 16, left: 30, right: 30 };
const INK = '#111111';
const MUTED = '#6b6b6b';
const RULE = '#c9c9c9';

const doc = yaml.load(fs.readFileSync(INDEX, 'utf8'));
const rows = doc.pages;
const starts = rows.map((r) => r.verseId);

// Which printed page holds a given verse: the last page that begins at or
// before it. The index tiles the whole canon, so this always resolves.
function pageFor(verseId) {
  let lo = 0;
  let hi = starts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= verseId) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return rows[found].page;
}

function displayName(slug) {
  if (slug === 'solomon_s_song') return 'Solomon’s Song';
  return slug
    .split('-')
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

// Every chapter, in canonical order, from the corpus filenames.
const chapters = [];
for (const volume of ['ot', 'nt']) {
  const dir = path.join(CORPUS, volume, 'nirv');
  for (const name of fs.readdirSync(dir)) {
    const match = name.match(/^(\d+)-(.+)-(\d+)\.yml$/);
    if (match) chapters.push({ verseId: +match[1], slug: match[2], chapter: +match[3] });
  }
}
chapters.sort((a, b) => a.verseId - b.verseId);

const books = [];
for (const entry of chapters) {
  let book = books[books.length - 1];
  if (!book || book.slug !== entry.slug) {
    book = { slug: entry.slug, name: displayName(entry.slug), chapters: [] };
    books.push(book);
  }
  book.chapters.push({ chapter: entry.chapter, page: pageFor(entry.verseId) });
}

// ---------------------------------------------------------------- typesetting

const pdf = new PDFDocument({ size: [PAGE.width, PAGE.height], margins: MARGIN, autoFirstPage: false });
pdf.pipe(fs.createWriteStream(OUT));

const CONTENT_W = PAGE.width - MARGIN.left - MARGIN.right;
const CONTENT_BOTTOM = PAGE.height - 44;
let folio = 0;

function newPage() {
  pdf.addPage();
  folio += 1;
  if (folio > 1) {
    pdf.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(String(folio), MARGIN.left, PAGE.height - 30, { width: CONTENT_W, align: 'center', lineBreak: false });
  }
}

function heading(text, sub) {
  pdf.font('Helvetica-Bold').fontSize(15).fillColor(INK)
    .text(text, MARGIN.left, MARGIN.top, { width: CONTENT_W });
  let y = pdf.y + 2;
  if (sub) {
    pdf.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(sub, MARGIN.left, y, { width: CONTENT_W });
    y = pdf.y + 3;
  }
  pdf.moveTo(MARGIN.left, y).lineTo(MARGIN.left + CONTENT_W, y).lineWidth(0.6).strokeColor(RULE).stroke();
  return y + 9;
}

// ---- Section 1: where each book begins ----
newPage();
let y = heading('Where Each Book Begins', 'Page numbers are this Bible’s own printed page numbers.');

{
  const cols = 2;
  const gutter = 16;
  const colW = (CONTENT_W - gutter * (cols - 1)) / cols;
  const lineH = 12.4;
  const perCol = Math.ceil(books.length / cols);
  const top = y;
  books.forEach((book, i) => {
    const col = Math.floor(i / perCol);
    const x = MARGIN.left + col * (colW + gutter);
    const yy = top + (i % perCol) * lineH;
    const page = String(book.chapters[0].page);
    pdf.font('Helvetica').fontSize(8.6).fillColor(INK).text(book.name, x, yy, { width: colW - 26, lineBreak: false });
    const nameW = pdf.widthOfString(book.name);
    const pageW = pdf.widthOfString(page);
    const dotsFrom = x + nameW + 3;
    const dotsTo = x + colW - pageW - 3;
    if (dotsTo > dotsFrom) {
      pdf.fillColor(RULE).fontSize(8.6);
      const dot = pdf.widthOfString('.');
      let dots = '';
      while (pdf.widthOfString(dots) + dot < dotsTo - dotsFrom) dots += '.';
      pdf.text(dots, dotsFrom, yy, { width: dotsTo - dotsFrom, lineBreak: false });
    }
    pdf.fillColor(INK).text(page, x + colW - pageW - 1, yy, { lineBreak: false });
  });
}

// ---- Section 2: every chapter ----
newPage();
y = heading('Chapter Index', 'Each chapter and the page it starts on.');

const COLS = 3;
const GUTTER = 12;
const COL_W = (CONTENT_W - GUTTER * (COLS - 1)) / COLS;
const LINE = 9.6;
const BOOK_GAP = 5;

let col = 0;
let cursorY = y;
const colX = (c) => MARGIN.left + c * (COL_W + GUTTER);

function ensureRoom(needed) {
  if (cursorY + needed <= CONTENT_BOTTOM) return;
  col += 1;
  if (col >= COLS) {
    newPage();
    cursorY = heading('Chapter Index', null);
    col = 0;
  } else {
    cursorY = y;
  }
}

for (const book of books) {
  ensureRoom(LINE * 2.6);
  pdf.font('Helvetica-Bold').fontSize(8.2).fillColor(INK)
    .text(book.name.toUpperCase(), colX(col), cursorY, { width: COL_W, lineBreak: false });
  cursorY += LINE + 1.4;

  // Chapters run in fixed-width slots so the numbers line up as a grid.
  const slots = 3;
  const slotW = COL_W / slots;
  for (let i = 0; i < book.chapters.length; i += slots) {
    ensureRoom(LINE);
    const group = book.chapters.slice(i, i + slots);
    group.forEach((entry, k) => {
      const x = colX(col) + k * slotW;
      pdf.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(String(entry.chapter), x, cursorY, { width: 11, align: 'right', lineBreak: false });
      pdf.font('Helvetica').fontSize(7.4).fillColor(INK)
        .text(String(entry.page), x + 13, cursorY, { width: slotW - 15, lineBreak: false });
    });
    cursorY += LINE;
  }
  cursorY += BOOK_GAP;
}

pdf.end();
console.log(`wrote ${OUT}`);
console.log(`  books ${books.length}, chapters ${chapters.length}, source pages ${rows.length}`);
