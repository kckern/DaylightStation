#!/usr/bin/env node
/**
 * glossika CLI — ingest the 2016 Glossika language assets.
 *
 * Reads the archived `korean.kckern.info` payload (sentence TSV, sentence audio,
 * and the surviving 2016–2017 voice recordings) and lands it in the shapes the
 * Glossika program expects, per
 * docs/_wip/plans/2026-07-21-glossika-program-design.md §2 and §6.
 *
 * Everything is scoped by corpus id, so a learner studying two courses never
 * has their counters or recordings collide. `content/language/{corpusId}.yml`
 * mirrors the existing `content/quizzes/{bankId}.yml` convention — type
 * directory, id as filename.
 *
 *   corpus      data/content/language/{corpusId}.yml
 *   audio       media/apps/school/language/{corpusId}/{NNNN}-{LANG}.mp3
 *   recordings  media/apps/school/language/{corpusId}/recordings/{userId}/{NNNN}-{LANG}.mp3
 *   log         data/users/{userId}/apps/school/language/{corpusId}/log/{YYYY-MM-DD}.yml
 *
 * Language codes are **data, never literals**: the corpus binds the ladder's
 * source/target roles to codes in its `languages:` block, sentence text is a
 * map keyed by those codes, and audio filenames take their `-{LANG}` suffix
 * from the same place. Nothing here assumes the strings EN or KR.
 *
 * Every command is idempotent: files already present at the destination with an
 * identical byte size are skipped, and backfilled log events replace their own
 * prior copies rather than accumulating duplicates.
 *
 * Usage:
 *   node cli/glossika.cli.mjs ingest-corpus  [--src path] [--corpus id] [--dry-run]
 *   node cli/glossika.cli.mjs ingest-audio   [--src path] [--corpus id] [--dry-run]
 *   node cli/glossika.cli.mjs import-legacy  [--src path] [--corpus id] [--dry-run]
 *   node cli/glossika.cli.mjs all            [--src path] [--corpus id] [--dry-run]
 *
 * Flags:
 *   --src <path>     source archive root (or set GLOSSIKA_SRC; no default)
 *   --corpus <id>    corpus id (default: glossika-korean)
 *   --dry-run        plan only — report what would be written, write nothing
 *   --help, -h       show this message
 *
 * Exit codes:
 *   0  success
 *   1  fatal error (bad source, failed encoding spot-check, write failure)
 *
 * @module cli/glossika
 */

import dotenv from 'dotenv';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';

import { initConfigService, configService } from '#system/config/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// ---------------------------------------------------------------------------
// Corpus registry
// ---------------------------------------------------------------------------

/**
 * Source archive root. Deliberately NOT a hardcoded default: the 2016 payload
 * lives in a personal cloud folder whose path is specific to one machine, and
 * baking that into a shared repo makes the tool a lie everywhere else. Set
 * GLOSSIKA_SRC (or pass --src) and the command reports plainly when neither
 * is present.
 */
const SRC_DEFAULT = process.env.GLOSSIKA_SRC || null;

const CORPUS_DEFAULT = 'glossika-korean';

/**
 * Per-corpus ingest description. `columns` maps the source TSV's data columns
 * (everything after `Sequence`) onto language codes in order — that mapping is
 * the only place the archive's column layout is encoded.
 */
const CORPORA = {
  'glossika-korean': {
    label: 'Glossika Korean',
    languages: { source: 'EN', target: 'KR' },
    tsvHeader: 'Sequence\tEnglish\tKorean',
    columns: ['EN', 'KR'],
    /** Legacy recording folder → household user id (design §6). */
    legacyUsers: [
      { folder: 'kckern', userId: 'kckern' },
      { folder: 'ekern', userId: 'elizabeth' },
    ],
    /** Encoding spot-checks — if these fail the CSV→YAML round trip is corrupt. */
    spotChecks: [
      { seq: 1, lang: 'KR', equals: '오늘 날씨가 좋아요.' },
      { seq: 3000, lang: 'KR', endsWith: '달려갔어요.' },
    ],
  },
};

const LEGACY_SOURCE = 'legacy-2017';

// ---------------------------------------------------------------------------
// Argument parsing — small inline parser, no extra dependency
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { _: [], src: SRC_DEFAULT, corpus: CORPUS_DEFAULT, dryRun: false, help: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--help':
      case '-h': opts.help = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--src': opts.src = args[++i]; break;
      case '--corpus': opts.corpus = args[++i]; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
        opts._.push(a);
    }
  }
  return opts;
}

const HELP = `glossika — ingest the 2016 Glossika assets

Usage:
  glossika.cli.mjs ingest-corpus  [--src path] [--corpus glossika-korean] [--dry-run]
  glossika.cli.mjs ingest-audio   [--src path] [--corpus glossika-korean] [--dry-run]
  glossika.cli.mjs import-legacy  [--src path] [--corpus glossika-korean] [--dry-run]
  glossika.cli.mjs all            [--src path] [--corpus glossika-korean] [--dry-run]

The source archive root must be given as --src or GLOSSIKA_SRC. It is the
folder holding data.csv, mp3/ and audio/ from the 2016 app.
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad4 = (n) => String(n).padStart(4, '0');

const log = (msg) => console.log(msg);

async function statOrNull(p) {
  try { return await fs.stat(p); } catch { return null; }
}

/**
 * Retry a Dropbox-backed filesystem op. Both the source archive and the
 * destination live in CloudStorage folders, where online-only files are
 * hydrated on demand — a cold file can ETIMEDOUT/EBUSY once and succeed on the
 * next attempt. Without this a single stall aborts a multi-thousand-file copy.
 */
async function withRetry(fn, { attempts = 5, baseDelayMs = 2000, label = '' } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (!['ETIMEDOUT', 'EBUSY', 'EAGAIN', 'EIO', 'ENETDOWN'].includes(err.code)) throw err;
      if (i === attempts) break;
      const delay = baseDelayMs * i;
      log(`        retry ${i}/${attempts - 1} after ${err.code} (${delay}ms) ${label}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Copy `src` → `dest` unless a file of identical size already sits there.
 * A partially written destination has the wrong size, so a re-run recopies it.
 * Returns 'copied' | 'skipped' | 'planned' | 'failed'.
 */
async function copyIfChanged(src, dest, { dryRun }, failures = null) {
  try {
    const srcStat = await withRetry(() => fs.stat(src), { label: path.basename(src) });
    const destStat = await statOrNull(dest);
    if (destStat && destStat.size === srcStat.size) return 'skipped';
    if (dryRun) return 'planned';
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await withRetry(() => fs.copyFile(src, dest), { label: path.basename(src) });
    return 'copied';
  } catch (err) {
    // One unreachable file must not abandon the rest of the batch; collect it
    // and report at the end so a re-run can pick up exactly what's missing.
    if (!failures) throw err;
    failures.push({ file: path.basename(src), code: err.code || 'ERR', message: err.message });
    return 'failed';
  }
}

async function writeYaml(dest, value, { dryRun }) {
  const body = yaml.dump(value, { lineWidth: -1, noRefs: true, quotingType: '"' });
  if (dryRun) return body;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body, 'utf8');
  return body;
}

async function readYaml(p) {
  try {
    return yaml.load(await fs.readFile(p, 'utf8')) ?? null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Local-time YYYY-MM-DD, used for the log shard filename. */
function localDateKey(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

// ---------------------------------------------------------------------------
// Paths — every destination is scoped by corpus id
// ---------------------------------------------------------------------------

function paths(corpusId) {
  const dataDir = configService.getDataDir();
  const mediaDir = configService.getMediaDir();
  const audioBase = `apps/school/language/${corpusId}`;
  return {
    dataDir,
    mediaDir,
    audioBase,
    corpus: join(dataDir, 'content', 'language', `${corpusId}.yml`),
    audioDir: join(mediaDir, ...audioBase.split('/')),
    recordingsDir: join(mediaDir, ...audioBase.split('/'), 'recordings'),
    userLogDir: (userId) =>
      join(dataDir, 'users', userId, 'apps', 'school', 'language', corpusId, 'log'),
  };
}

function corpusSpec(corpusId) {
  const spec = CORPORA[corpusId];
  if (!spec) {
    throw new Error(`Unknown corpus "${corpusId}". Known: ${Object.keys(CORPORA).join(', ')}`);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// ingest-corpus
// ---------------------------------------------------------------------------

/**
 * Parse the 2016 `data.csv` — a TSV whose data columns map onto language codes
 * via `spec.columns`. CRLF-terminated; a stray \r left on the last column would
 * poison the YAML.
 */
export function parseCorpusTsv(text, spec) {
  const lines = text.replace(/^﻿/, '').split('\n');
  const header = (lines.shift() || '').replace(/\r$/, '').trim();
  if (header !== spec.tsvHeader) {
    throw new Error(`Unexpected TSV header: ${JSON.stringify(header)} (expected ${JSON.stringify(spec.tsvHeader)})`);
  }
  const width = spec.columns.length + 1;
  const sentences = [];
  const problems = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return;
    const cols = line.split('\t');
    if (cols.length !== width) { problems.push(`line ${i + 2}: ${cols.length} columns`); return; }
    const seq = Number(cols[0].trim());
    if (!Number.isInteger(seq) || seq < 1) { problems.push(`line ${i + 2}: bad seq ${cols[0]}`); return; }
    const textMap = {};
    spec.columns.forEach((lang, c) => { textMap[lang] = cols[c + 1].trim(); });
    sentences.push({ seq, text: textMap });
  });
  sentences.sort((a, b) => a.seq - b.seq);
  return { sentences, problems };
}

/** Throws if the target-language text did not survive the read. */
function assertEncoding(sentences, spec) {
  const bySeq = new Map(sentences.map((s) => [s.seq, s]));
  for (const check of spec.spotChecks) {
    const row = bySeq.get(check.seq);
    if (!row) throw new Error(`Spot-check failed: seq ${check.seq} not found in corpus.`);
    const value = row.text?.[check.lang];
    if (check.equals !== undefined && value !== check.equals) {
      throw new Error(`Spot-check failed: seq ${check.seq} text.${check.lang} = ${JSON.stringify(value)}, expected ${JSON.stringify(check.equals)}`);
    }
    if (check.endsWith !== undefined && !String(value).endsWith(check.endsWith)) {
      throw new Error(`Spot-check failed: seq ${check.seq} text.${check.lang} = ${JSON.stringify(value)}, expected to end with ${JSON.stringify(check.endsWith)}`);
    }
  }
}

async function cmdIngestCorpus(opts) {
  const spec = corpusSpec(opts.corpus);
  const p = paths(opts.corpus);

  const srcCsv = join(opts.src, 'data.csv');
  const text = await withRetry(() => fs.readFile(srcCsv, 'utf8'), { label: 'data.csv' });
  const { sentences, problems } = parseCorpusTsv(text, spec);
  if (!sentences.length) throw new Error(`No sentences parsed from ${srcCsv}`);
  assertEncoding(sentences, spec);

  const corpus = {
    id: opts.corpus,
    label: spec.label,
    languages: { source: spec.languages.source, target: spec.languages.target },
    audio_base: p.audioBase,
    sentences,
  };

  await writeYaml(p.corpus, corpus, opts);

  // Round-trip verification — re-read from disk and re-run the spot-checks.
  let verified = null;
  if (!opts.dryRun) {
    const back = await readYaml(p.corpus);
    assertEncoding(back.sentences, spec);
    verified = back.sentences.length;
  }

  const seqs = sentences.map((s) => s.seq);
  const seqSet = new Set(seqs);
  const gaps = [];
  for (let i = seqs[0]; i <= seqs[seqs.length - 1]; i++) if (!seqSet.has(i)) gaps.push(i);

  log(`corpus  ${opts.dryRun ? '[dry-run] ' : ''}${p.corpus}`);
  log(`        sentences=${sentences.length} range=${seqs[0]}..${seqs[seqs.length - 1]}` +
      (gaps.length ? ` gaps=${gaps.length}` : ' (contiguous)') +
      (verified !== null ? ` verified=${verified}` : '') +
      ` langs=${spec.columns.join('/')}`);
  if (problems.length) log(`        parse problems: ${problems.slice(0, 10).join('; ')}`);

  return { sentences: sentences.length, verified, gaps, problems };
}

// ---------------------------------------------------------------------------
// ingest-audio
// ---------------------------------------------------------------------------

async function cmdIngestAudio(opts) {
  const spec = corpusSpec(opts.corpus);
  const p = paths(opts.corpus);
  const srcDir = join(opts.src, 'mp3');

  // Filenames carry the language code from the corpus spec, never a literal.
  const langAlt = spec.columns.join('|');
  const namePattern = new RegExp(`^\\d{4}-(${langAlt})\\.mp3$`);

  const names = (await fs.readdir(srcDir)).filter((n) => namePattern.test(n)).sort();
  if (!names.length) throw new Error(`No {NNNN}-{${langAlt}}.mp3 files under ${srcDir}`);

  const tally = { copied: 0, skipped: 0, planned: 0, failed: 0 };
  const failures = [];
  const seqs = new Set();
  let done = 0;
  for (const name of names) {
    seqs.add(Number(name.slice(0, 4)));
    tally[await copyIfChanged(join(srcDir, name), join(p.audioDir, name), opts, failures)]++;
    if (++done % 500 === 0) log(`        …${done}/${names.length}`);
  }

  const ordered = [...seqs].sort((a, b) => a - b);
  const nameSet = new Set(names);
  const missingPairs = ordered.filter((s) => spec.columns.some((lang) => !nameSet.has(`${pad4(s)}-${lang}.mp3`)));

  log(`audio   ${opts.dryRun ? '[dry-run] ' : ''}${p.audioDir}`);
  log(`        files=${names.length} seq=${ordered[0]}..${ordered[ordered.length - 1]} ` +
      `copied=${tally.copied} skipped=${tally.skipped}` +
      `${opts.dryRun ? ` planned=${tally.planned}` : ''}${tally.failed ? ` FAILED=${tally.failed}` : ''}`);
  if (missingPairs.length) log(`        incomplete pairs: ${missingPairs.slice(0, 20).join(', ')}`);
  if (failures.length) log(`        unreadable (re-run to retry): ${failures.slice(0, 20).map((f) => `${f.file}[${f.code}]`).join(', ')}`);

  return { files: names.length, seqCount: ordered.length, maxSeq: ordered[ordered.length - 1], ...tally, missingPairs, failures };
}

// ---------------------------------------------------------------------------
// import-legacy
// ---------------------------------------------------------------------------

/**
 * Merge backfilled events into one date shard, replacing any previous copy of
 * the same (seq, rung, source) triple so re-runs stay idempotent.
 */
export function mergeLegacyEvents(existing, incoming) {
  const isLegacyDupe = (e) => incoming.some(
    (n) => n.seq === e.seq && n.rung === e.rung && e.source === LEGACY_SOURCE,
  );
  const kept = (Array.isArray(existing) ? existing : []).filter((e) => !isLegacyDupe(e));
  return [...kept, ...incoming].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

async function cmdImportLegacy(opts) {
  const spec = corpusSpec(opts.corpus);
  const p = paths(opts.corpus);
  // The recording rung captures the learner speaking the TARGET language.
  const lang = spec.languages.target;
  const summary = [];

  for (const { folder, userId } of spec.legacyUsers) {
    const srcDir = join(opts.src, 'audio', folder);
    const srcPattern = new RegExp(`^${folder}_(\\d{4})-${lang}\\.mp3$`);
    const names = (await fs.readdir(srcDir)).filter((n) => srcPattern.test(n)).sort();

    const tally = { copied: 0, skipped: 0, planned: 0, failed: 0 };
    const failures = [];
    const shards = new Map(); // dateKey → events[]

    for (const name of names) {
      const seq = Number(name.match(srcPattern)[1]);
      const srcFile = join(srcDir, name);
      const destFile = join(p.recordingsDir, userId, `${pad4(seq)}-${lang}.mp3`);

      const result = await copyIfChanged(srcFile, destFile, opts, failures);
      tally[result]++;
      // Never log an event for a recording that isn't on disk — the log is the
      // evidence, and a claim without its artefact is worse than a gap.
      if (result === 'failed') continue;

      const { mtime } = await withRetry(() => fs.stat(srcFile), { label: name });
      const dateKey = localDateKey(mtime);
      const event = {
        at: mtime.toISOString(),
        seq,
        rung: 'recording',
        source: LEGACY_SOURCE,
        attributedTo: userId,
      };
      if (!shards.has(dateKey)) shards.set(dateKey, []);
      shards.get(dateKey).push(event);
    }

    const logDir = p.userLogDir(userId);
    for (const [dateKey, events] of shards) {
      const shardPath = join(logDir, `${dateKey}.yml`);
      const merged = mergeLegacyEvents(await readYaml(shardPath), events);
      await writeYaml(shardPath, merged, opts);
    }

    const dates = [...shards.keys()].sort();
    const eventCount = [...shards.values()].reduce((n, list) => n + list.length, 0);
    log(`legacy  ${opts.dryRun ? '[dry-run] ' : ''}${userId}`);
    log(`        recordings=${names.length} copied=${tally.copied} skipped=${tally.skipped}` +
        `${opts.dryRun ? ` planned=${tally.planned}` : ''}${tally.failed ? ` FAILED=${tally.failed}` : ''}`);
    log(`        events=${eventCount} shards=${shards.size} (${dates[0]} … ${dates[dates.length - 1]})`);
    log(`        → ${logDir}`);
    if (failures.length) log(`        unreadable (re-run to retry): ${failures.map((f) => `${f.file}[${f.code}]`).join(', ')}`);

    summary.push({ userId, recordings: names.length, events: eventCount, shards: shards.size, dates, ...tally, failures });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try { opts = parseArgs(process.argv); }
  catch (err) { console.error(err.message); process.stdout.write(HELP); process.exit(1); }

  const cmd = opts._[0];
  if (opts.help || !cmd) { process.stdout.write(HELP); process.exit(opts.help ? 0 : 1); }

  const baseDir = process.env.DAYLIGHT_BASE_PATH;
  if (!baseDir) { console.error('ERROR: DAYLIGHT_BASE_PATH not set in .env'); process.exit(1); }
  await initConfigService(join(baseDir, 'data'));

  if (!opts.src) {
    console.error('ERROR: no source archive. Pass --src <path> or set GLOSSIKA_SRC.');
    console.error('       It is the folder holding data.csv, mp3/ and audio/ from the 2016 app.');
    process.exit(1);
  }
  const srcStat = await statOrNull(opts.src);
  if (!srcStat?.isDirectory()) { console.error(`ERROR: source not found: ${opts.src}`); process.exit(1); }

  const started = Date.now();
  switch (cmd) {
    case 'ingest-corpus': await cmdIngestCorpus(opts); break;
    case 'ingest-audio':  await cmdIngestAudio(opts);  break;
    case 'import-legacy': await cmdImportLegacy(opts); break;
    case 'all':
      await cmdIngestCorpus(opts);
      await cmdIngestAudio(opts);
      await cmdImportLegacy(opts);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      process.stdout.write(HELP);
      process.exit(1);
  }
  log(`\nDONE in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
