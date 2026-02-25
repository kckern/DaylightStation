#!/usr/bin/env node
/**
 * import-version.mjs — Import a scripture version (data YAML + audio) into DaylightStation.
 *
 * Generates YAML data files from scripture_verses.csv + scripture_headings.csv,
 * and optionally copies matching audio files from /Volumes/Media/Scripture/.
 *
 * Usage:
 *   node import-version.mjs <version> [--audio "Source Version Name"] [--dry-run] [--volumes ot,nt]
 *
 * Examples:
 *   node import-version.mjs NIV --audio "NIV"
 *   node import-version.mjs ESV --audio "ESV" --volumes ot,nt
 *   node import-version.mjs NKJV --dry-run
 *   node import-version.mjs --list          # list available versions
 *
 * Data sources (in _inbox/):
 *   scripture_verses.csv   — verse text per version
 *   scripture_headings.csv — chapter/section headings per version
 *
 * Audio source:
 *   /Volumes/Media/Scripture/{Volume Name}/{Source Version Name}/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DROPBOX_BASE = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation';
const INBOX = path.join(DROPBOX_BASE, 'media/audio/readalong/scripture/_inbox');
const VERSES_CSV = path.join(INBOX, 'scripture_verses.csv');
const HEADINGS_CSV = path.join(INBOX, 'scripture_headings.csv');
const DATA_BASE = path.join(DROPBOX_BASE, 'data/content/readalong/scripture');
const AUDIO_BASE = path.join(DROPBOX_BASE, 'media/audio/readalong/scripture');
const MEDIA_SOURCE = '/Volumes/Media/Scripture';

const VOL_INFO = {
  ot: { id: 1, name: 'Old Testament',          slug: 'ot',  mediaDir: 'Old Testament' },
  nt: { id: 2, name: 'New Testament',          slug: 'nt',  mediaDir: 'New Testament' },
  bom: { id: 3, name: 'Book of Mormon',        slug: 'bom', mediaDir: 'Book of Mormon' },
  dc: { id: 4, name: 'Doctrine and Covenants', slug: 'dc',  mediaDir: 'Doctrine and Covenants' },
  pgp: { id: 5, name: 'Pearl of Great Price',  slug: 'pgp', mediaDir: 'Pearl of Great Price' },
};

// Map volume_id (from CSV book_id ranges) to our volume slug
// We'll build this from lds_scriptures_books.csv data baked in
const BOOK_TO_VOLUME = {};
const BOOK_SLUG = {};
// Books 1-39 = OT, 40-66 = NT, 67-81 = BOM, 82 = DC, 83-87 = PGP
const BOOK_RANGES = [
  { start: 1, end: 39, vol: 'ot' },
  { start: 40, end: 66, vol: 'nt' },
  { start: 67, end: 81, vol: 'bom' },
  { start: 82, end: 82, vol: 'dc' },
  { start: 83, end: 87, vol: 'pgp' },
];

// Book ID → slug mapping (from lds_scriptures_books.csv column 9)
const BOOK_SLUGS = {
  1:'genesis',2:'exodus',3:'leviticus',4:'numbers',5:'deuteronomy',
  6:'joshua',7:'judges',8:'ruth',9:'1-samuel',10:'2-samuel',
  11:'1-kings',12:'2-kings',13:'1-chronicles',14:'2-chronicles',
  15:'ezra',16:'nehemiah',17:'esther',18:'job',19:'psalms',20:'proverbs',
  21:'ecclesiastes',22:'song-of-solomon',23:'isaiah',24:'jeremiah',25:'lamentations',
  26:'ezekiel',27:'daniel',28:'hosea',29:'joel',30:'amos',31:'obadiah',
  32:'jonah',33:'micah',34:'nahum',35:'habakkuk',36:'zephaniah',37:'haggai',
  38:'zechariah',39:'malachi',
  40:'matthew',41:'mark',42:'luke',43:'john',44:'acts',45:'romans',
  46:'1-corinthians',47:'2-corinthians',48:'galatians',49:'ephesians',
  50:'philippians',51:'colossians',52:'1-thessalonians',53:'2-thessalonians',
  54:'1-timothy',55:'2-timothy',56:'titus',57:'philemon',58:'hebrews',
  59:'james',60:'1-peter',61:'2-peter',62:'1-john',63:'2-john',64:'3-john',
  65:'jude',66:'revelation',
  67:'1-nephi',68:'2-nephi',69:'jacob',70:'enos',71:'jarom',72:'omni',
  73:'words-of-mormon',74:'mosiah',75:'alma',76:'helaman',77:'3-nephi',
  78:'4-nephi',79:'mormon',80:'ether',81:'moroni',
  82:'doctrine-and-covenants',
  83:'moses',84:'abraham',85:'joseph-smith-matthew',86:'joseph-smith-history',
  87:'articles-of-faith',
};

for (const [id, slug] of Object.entries(BOOK_SLUGS)) {
  const bid = parseInt(id);
  BOOK_SLUG[bid] = slug;
  for (const range of BOOK_RANGES) {
    if (bid >= range.start && bid <= range.end) {
      BOOK_TO_VOLUME[bid] = range.vol;
      break;
    }
  }
}

// Audio source book name normalization (matches /Volumes/Media/Scripture file names)
function normalizeAudioBookName(name) {
  name = name.replace(/^The /, '');
  name = name.replace(/^1st/, '1').replace(/^2nd/, '2').replace(/^3rd/, '3').replace(/^4th/, '4');
  if (/^Section$/i.test(name)) return 'doctrine-and-covenants';
  name = name.toLowerCase().replace(/ /g, '-');
  if (name === 'psalm') name = 'psalms';
  return name;
}

// --- Parse TSV line (handles quoted fields with embedded tabs/newlines) ---
function parseTsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === '\t') { fields.push(current); current = ''; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

// --- Stream-parse a TSV file ---
async function parseTsv(filePath, filter, process) {
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }) });
  let headers = null;
  for await (const line of rl) {
    if (!headers) {
      headers = parseTsvLine(line.replace(/^\ufeff/, ''));
      continue;
    }
    const fields = parseTsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = fields[i] || ''; });
    if (filter(row)) process(row);
  }
}

// --- YAML generation ---
function escapeYaml(text) {
  if (!text) return "''";
  // If text contains special chars, quote it
  if (text.includes('"') || text.includes("'") || text.includes(':') ||
      text.includes('#') || text.includes('\n') || text.includes('{') ||
      text.includes('}') || text.includes('[') || text.includes(']') ||
      text.includes('*') || text.includes('&') || text.includes('!') ||
      text.includes('%') || text.includes('@') || text.includes('`') ||
      text.startsWith(' ') || text.endsWith(' ')) {
    // Use double quotes, escape internal double quotes
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return text;
}

function generateYaml(verses, headingsForChapter) {
  const lines = [];
  for (const v of verses) {
    const isFirst = v === verses[0];
    const heading = headingsForChapter[v.verse_id];

    if (isFirst && heading) {
      lines.push(`- headings:`);
      if (heading.heading) lines.push(`    heading: ${escapeYaml(heading.heading)}`);
      if (heading.title) lines.push(`    title: ${escapeYaml(heading.title)}`);
      lines.push(`    last: ${verses[verses.length - 1].verse}`);
      lines.push(`  verse_id: '${v.verse_id}'`);
    } else if (heading?.heading) {
      lines.push(`- headings:`);
      lines.push(`    heading: ${escapeYaml(heading.heading)}`);
      lines.push(`  verse_id: '${v.verse_id}'`);
    } else {
      lines.push(`- verse_id: '${v.verse_id}'`);
    }

    lines.push(`  verse: '${v.verse}'`);
    lines.push(`  format: ${v.format || 'prose'}`);
    lines.push(`  text: ${escapeYaml(v.text)}`);
  }
  return lines.join('\n') + '\n';
}

// --- Main ---
async function main() {
  const rawArgs = process.argv.slice(2);
  const flags = new Set();
  const namedArgs = {};
  const positional = [];
  const consumed = new Set(); // indices consumed by named args

  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--dry-run' || rawArgs[i] === '--list') { flags.add(rawArgs[i]); }
    else if (rawArgs[i] === '--audio' && rawArgs[i + 1]) { namedArgs.audio = rawArgs[i + 1]; consumed.add(i + 1); i++; }
    else if (rawArgs[i] === '--volumes' && rawArgs[i + 1]) { namedArgs.volumes = rawArgs[i + 1]; consumed.add(i + 1); i++; }
    else if (rawArgs[i] === '--slug' && rawArgs[i + 1]) { namedArgs.slug = rawArgs[i + 1]; consumed.add(i + 1); i++; }
    else if (!rawArgs[i].startsWith('--') && !consumed.has(i)) { positional.push(rawArgs[i]); }
  }
  const dryRun = flags.has('--dry-run');

  if (flags.has('--list')) {
    console.log('Scanning available versions in scripture_verses.csv...');
    const versions = {};
    await parseTsv(VERSES_CSV, () => true, (row) => {
      const v = row.version;
      if (!versions[v]) versions[v] = 0;
      versions[v]++;
    });
    console.log(`\n${Object.keys(versions).length} versions:\n`);
    for (const [v, count] of Object.entries(versions).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v.padEnd(12)} ${count} verses`);
    }

    // Show audio sources
    console.log('\nAudio sources in /Volumes/Media/Scripture/:');
    for (const [vol, info] of Object.entries(VOL_INFO)) {
      const srcDir = path.join(MEDIA_SOURCE, info.mediaDir);
      if (fs.existsSync(srcDir)) {
        console.log(`  ${vol} (${info.mediaDir}):`);
        fs.readdirSync(srcDir)
          .filter(f => { try { return fs.statSync(path.join(srcDir, f)).isDirectory(); } catch { return false; } })
          .forEach(f => console.log(`    ${f}`));
      }
    }
    return;
  }

  const VERSION = positional[0];
  if (!VERSION) {
    console.error('Usage: node import-version.mjs <version> [--audio "Source Name"] [--slug target-slug] [--volumes ot,nt] [--dry-run]');
    console.error('       node import-version.mjs --list');
    process.exit(1);
  }

  const targetSlug = namedArgs.slug || VERSION.toLowerCase();
  const volumeFilter = namedArgs.volumes ? new Set(namedArgs.volumes.split(',')) : null;

  console.log(`Version: ${VERSION}`);
  console.log(`Target slug: ${targetSlug}`);
  console.log(`Volumes: ${volumeFilter ? [...volumeFilter].join(', ') : 'all'}`);
  if (namedArgs.audio) console.log(`Audio source: "${namedArgs.audio}"`);
  if (dryRun) console.log('DRY RUN — no files will be written\n');

  // --- Phase 1: Load verses for this version ---
  console.log('Loading verses...');
  // Group by: volume → book_slug → chapter → [verses]
  const chapters = {}; // key: "vol/book_slug/chapter" → { verses: [], firstVerseId }
  let verseCount = 0;

  await parseTsv(VERSES_CSV, (row) => row.version === VERSION, (row) => {
    const bookId = parseInt(row.book_id);
    const vol = BOOK_TO_VOLUME[bookId];
    if (!vol) return;
    if (volumeFilter && !volumeFilter.has(vol)) return;

    const bookSlug = BOOK_SLUG[bookId];
    const chapter = row.chapter;
    const key = `${vol}/${bookSlug}/${chapter}`;

    if (!chapters[key]) chapters[key] = { verses: [], vol, bookSlug, chapter };
    const text = row.text || '';
    chapters[key].verses.push({
      verse_id: row.verse_id,
      verse: row.verse,
      format: row.format || 'prose',
      text: text
    });
    verseCount++;
  });

  console.log(`  ${verseCount} verses across ${Object.keys(chapters).length} chapters`);

  // --- Phase 2: Load headings for this version ---
  console.log('Loading headings...');
  // key: verse_id → { heading, title, headnote, summary }
  const headings = {};
  await parseTsv(HEADINGS_CSV, (row) => row.version === VERSION, (row) => {
    const vid = row.verse_id;
    if (!headings[vid]) headings[vid] = {};
    if (row.type === 'heading') headings[vid].heading = row.text;
    if (row.type === 'title') headings[vid].title = row.text;
    if (row.type === 'headnote') headings[vid].headnote = row.text;
    if (row.type === 'summary') headings[vid].summary = row.text;
  });
  console.log(`  ${Object.keys(headings).length} heading entries`);

  // --- Phase 3: Generate YAML data files ---
  console.log('\nGenerating YAML data files...');
  let yamlWritten = 0, yamlSkipped = 0;

  for (const [key, chap] of Object.entries(chapters)) {
    if (chap.verses.length === 0) continue;

    // First verse_id in chapter, zero-padded to 5 digits
    const firstVid = chap.verses[0].verse_id;
    const padded = String(firstVid).padStart(5, '0');
    const fileName = `${padded}-${chap.bookSlug}-${chap.chapter}.yml`;
    const dirPath = path.join(DATA_BASE, chap.vol, targetSlug);
    const filePath = path.join(dirPath, fileName);

    // Collect headings for verses in this chapter
    const chapterHeadings = {};
    for (const v of chap.verses) {
      if (headings[v.verse_id]) chapterHeadings[v.verse_id] = headings[v.verse_id];
    }

    const yaml = generateYaml(chap.verses, chapterHeadings);

    if (dryRun) {
      if (yamlWritten < 3) console.log(`  WRITE: ${chap.vol}/${targetSlug}/${fileName} (${chap.verses.length} verses)`);
      yamlWritten++;
    } else {
      if (fs.existsSync(filePath)) { yamlSkipped++; continue; }
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, yaml);
      yamlWritten++;
    }
  }

  if (dryRun && yamlWritten > 3) console.log(`  ... and ${yamlWritten - 3} more`);
  console.log(`  YAML: ${yamlWritten} written, ${yamlSkipped} skipped (exist)`);

  // --- Phase 4: Copy audio files (if --audio specified) ---
  if (!namedArgs.audio) {
    console.log('\nNo --audio specified, skipping audio copy.');
    console.log('Done.');
    return;
  }

  console.log(`\nCopying audio from "${namedArgs.audio}"...`);

  // Build verse_id lookup from the chapters we just processed
  // key: "bookSlug:chapter" → padded filename prefix
  const audioMap = {};
  for (const [, chap] of Object.entries(chapters)) {
    const firstVid = String(chap.verses[0].verse_id).padStart(5, '0');
    audioMap[`${chap.bookSlug}:${chap.chapter}`] = `${firstVid}-${chap.bookSlug}-${chap.chapter}`;
  }

  let audioCopied = 0, audioSkipped = 0, audioMissing = 0;

  for (const vol of Object.keys(VOL_INFO)) {
    if (volumeFilter && !volumeFilter.has(vol)) continue;

    const srcDir = path.join(MEDIA_SOURCE, VOL_INFO[vol].mediaDir, namedArgs.audio);
    if (!fs.existsSync(srcDir)) {
      console.log(`  No audio source for ${vol}: ${srcDir}`);
      continue;
    }

    const targetDir = path.join(AUDIO_BASE, vol, targetSlug);

    const files = fs.readdirSync(srcDir).filter(f => /\.(mp3|m4a)$/i.test(f)).sort();
    for (const filename of files) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);

      // Parse: "NN-NN Book Name Chapter" or "NN-NN Book Name" (single-chapter)
      const namePart = base.replace(/^\d+-\d+\s+/, '');
      const words = namePart.split(' ');
      const lastWord = words[words.length - 1];
      let chapter, bookName;
      if (/^\d+$/.test(lastWord)) {
        chapter = lastWord;
        bookName = words.slice(0, -1).join(' ');
      } else {
        chapter = '1';
        bookName = namePart;
      }

      // DC special
      const bookSlug = (vol === 'dc' && /^Section$/i.test(bookName))
        ? 'doctrine-and-covenants'
        : normalizeAudioBookName(bookName);

      const key = `${bookSlug}:${chapter}`;
      if (audioMap[key]) {
        const targetName = `${audioMap[key]}${ext}`;
        const targetPath = path.join(targetDir, targetName);
        if (fs.existsSync(targetPath)) {
          audioSkipped++;
        } else {
          if (dryRun) {
            if (audioCopied < 5) console.log(`  COPY: ${filename} → ${vol}/${targetSlug}/${targetName}`);
            audioCopied++;
          } else {
            fs.mkdirSync(targetDir, { recursive: true });
            fs.copyFileSync(path.join(srcDir, filename), targetPath);
            audioCopied++;
          }
        }
      } else {
        if (audioMissing < 10) console.log(`  SKIP (no match): ${filename} → ${bookSlug}:${chapter}`);
        audioMissing++;
      }
    }
  }

  if (dryRun && audioCopied > 5) console.log(`  ... and ${audioCopied - 5} more`);
  console.log(`  Audio: ${audioCopied} ${dryRun ? 'would copy' : 'copied'}, ${audioSkipped} skipped, ${audioMissing} no match`);
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
