#!/usr/bin/env node

/**
 * Loop-library harmonic-timeline enrichment pass (Producer overhaul §4b/§6).
 *
 * Reads <loopsDir>/index.yml, parses each harmonic entry's .mid (all tracks
 * flattened, same note shape as frontend useLoopLibrary.loadNotes), computes
 * shared/music/harmonicTimeline over it, and writes the result back into the
 * entry as FLAT keys (diff-friendly):
 *
 *   timeline:     slots array — one root-relative pc set per beat (compact,
 *                 inner arrays dumped flow-style: `- [0, 4, 7]`)
 *   timelineRoot: absolute detected root pitch class 0..11
 *   specificity:  'root' | 'fifth' | 'triad' | 'extended'
 *
 * Skipped entirely: type 'groove' / 'percussion' (no harmonic content).
 *
 * AMBIGUITY RULE — an entry gets `needsReview: true` + `needsReviewReason`
 * (and its timeline/timelineRoot/specificity keys are REMOVED, not written)
 * when any of:
 *   parse-fail    — the .mid can't be read/parsed, or contains zero notes
 *                   (NB: on Dropbox CloudStorage a read failure may just be an
 *                   online-only file; rerun after materializing — this pass is
 *                   idempotent, flagged entries are recomputed every run)
 *   engine-throw  — harmonicTimeline threw (RangeError slot-cap/ppq, TypeError)
 *   root-mismatch — the computed root contradicts the entry's declared
 *                   canonicalKey. The canonical key names a relative pair
 *                   ("C Major - A Minor", "CMaj_AMin"), so BOTH the major and
 *                   the relative-minor tonic pcs count as declared; a computed
 *                   root outside that set is a strong ambiguity signal — we
 *                   flag rather than trust either side. Entries with no
 *                   parseable canonicalKey skip this check (computed root is
 *                   trusted).
 *
 * Idempotent: always recomputes and updates the same flat keys in place; a
 * clean recompute clears any earlier needsReview flag. Before writing, the
 * index is backed up to index.yml.bak-YYYYMMDD-HHmmss.
 *
 * Usage:
 *   node cli/loop-enrich.cli.mjs --dry-run              # compute + report, write nothing
 *   node cli/loop-enrich.cli.mjs --dry-run --sample=5   # also print 5 sample analyses
 *   node cli/loop-enrich.cli.mjs                        # real run: backup + write index.yml
 *   node cli/loop-enrich.cli.mjs --dir=/path/to/loops   # override loops dir
 *
 * Exit codes: 0 on success (flagged entries are still success), 1 when the
 * index can't be read or the output can't be written.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import midiPkg from '@tonejs/midi';

import { harmonicTimeline } from '../shared/music/harmonicTimeline.mjs';

const { Midi } = midiPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

// ---- args ----
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const DRY = flag('dry-run') || flag('dry');
const SAMPLE = Number(opt('sample', 0)) || 0;
const DIR = path.resolve(opt('dir', path.join(process.env.DAYLIGHT_BASE_PATH || '', 'media/midi/loops')));
const INDEX = path.join(DIR, 'index.yml');

// ---- key parsing ----
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Declared tonic pitch classes of a canonicalKey string. Handles all formats
 * present in the index: "C Major - A Minor", "CMaj_AMin", "CMajor",
 * "DbMaj_BbMin", "G# Minor"… Returns [] when nothing parses (e.g. null).
 */
function declaredPcs(canonicalKey) {
  if (!canonicalKey || typeof canonicalKey !== 'string') return [];
  const pcs = new Set();
  for (const m of canonicalKey.matchAll(/([A-G])([#b]?)\s*(?:Maj(?:or)?|Min(?:or)?)/g)) {
    const pc = LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    pcs.add(((pc % 12) + 12) % 12);
  }
  return [...pcs];
}

const SKIP_TYPES = new Set(['groove', 'percussion']);

// ---- load index ----
let entries;
try {
  entries = yaml.load(readFileSync(INDEX, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('index.yml did not parse to an array');
} catch (err) {
  console.error(`Cannot read loop index at ${INDEX}: ${err.message}`);
  process.exit(1);
}
console.log(`Loops dir: ${DIR}`);
console.log(`Index:     ${entries.length} entries  (${DRY ? 'DRY-RUN' : 'REAL RUN'})\n`);

// ---- enrichment pass ----
const t0 = Date.now();
const perType = new Map(); // type -> { analyzed, parseFail, engineThrow, rootMismatch, skipped }
const specHist = { root: 0, fifth: 0, triad: 0, extended: 0 };
const samples = [];
let processed = 0;

const bucket = (type) => {
  if (!perType.has(type)) perType.set(type, { analyzed: 0, parseFail: 0, engineThrow: 0, rootMismatch: 0, skipped: 0 });
  return perType.get(type);
};

const clearComputed = (entry) => {
  delete entry.timeline;
  delete entry.timelineRoot;
  delete entry.specificity;
};

const flagEntry = (entry, reason) => {
  clearComputed(entry);
  entry.needsReview = true;
  entry.needsReviewReason = reason;
};

for (const entry of entries) {
  const stats = bucket(entry.type || 'unknown');
  if (SKIP_TYPES.has(entry.type)) {
    stats.skipped += 1;
    continue;
  }

  // Read + parse the .mid — per-file failures are counted, never fatal
  // (Dropbox online-only files can transiently fail to read).
  let notes = null;
  let ppq = 480;
  try {
    const midi = new Midi(readFileSync(path.join(DIR, entry.path)));
    ppq = midi.header.ppq || 480;
    notes = midi.tracks.flatMap((tr) => tr.notes.map((n) => ({
      ticks: n.ticks, durationTicks: n.durationTicks, midi: n.midi,
    })));
  } catch {
    notes = null;
  }
  if (!notes || notes.length === 0) {
    stats.parseFail += 1;
    flagEntry(entry, 'parse-fail');
    continue;
  }

  let result;
  try {
    result = harmonicTimeline(notes, ppq);
  } catch (err) {
    stats.engineThrow += 1;
    flagEntry(entry, `engine-throw: ${err.message}`);
    continue;
  }

  const declared = declaredPcs(entry.canonicalKey);
  if (declared.length > 0 && !declared.includes(result.root)) {
    stats.rootMismatch += 1;
    flagEntry(entry, `root-mismatch: computed ${NOTE_NAMES[result.root]} vs declared ${entry.canonicalKey}`);
    continue;
  }

  stats.analyzed += 1;
  specHist[result.specificity] += 1;
  entry.timeline = result.slots;
  entry.timelineRoot = result.root;
  entry.specificity = result.specificity;
  delete entry.needsReview;
  delete entry.needsReviewReason;

  if (SAMPLE > 0) {
    samples.push({
      slug: entry.slug,
      declaredKey: entry.canonicalKey,
      root: result.root,
      specificity: result.specificity,
      firstSlots: result.slots.slice(0, 4),
      slotCount: result.slots.length,
    });
  }

  processed += 1;
  if (processed % 500 === 0) console.log(`  …${processed} analyzed`);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ---- report ----
const pad = (v, w) => String(v).padStart(w);
console.log('\n=== LOOP ENRICHMENT REPORT ===');
console.log(`${'type'.padEnd(18)} ${pad('total', 6)} ${pad('analyzed', 9)} ${pad('flagged', 8)} ${pad('parse', 6)} ${pad('throw', 6)} ${pad('root≠', 6)} ${pad('skipped', 8)}`);
let totals = { total: 0, analyzed: 0, flagged: 0, parseFail: 0, engineThrow: 0, rootMismatch: 0, skipped: 0 };
for (const [type, s] of [...perType.entries()].sort()) {
  const flagged = s.parseFail + s.engineThrow + s.rootMismatch;
  const total = s.analyzed + flagged + s.skipped;
  console.log(`${type.padEnd(18)} ${pad(total, 6)} ${pad(s.analyzed, 9)} ${pad(flagged, 8)} ${pad(s.parseFail, 6)} ${pad(s.engineThrow, 6)} ${pad(s.rootMismatch, 6)} ${pad(s.skipped, 8)}`);
  totals.total += total; totals.analyzed += s.analyzed; totals.flagged += flagged;
  totals.parseFail += s.parseFail; totals.engineThrow += s.engineThrow;
  totals.rootMismatch += s.rootMismatch; totals.skipped += s.skipped;
}
console.log(`${'TOTAL'.padEnd(18)} ${pad(totals.total, 6)} ${pad(totals.analyzed, 9)} ${pad(totals.flagged, 8)} ${pad(totals.parseFail, 6)} ${pad(totals.engineThrow, 6)} ${pad(totals.rootMismatch, 6)} ${pad(totals.skipped, 8)}`);

console.log('\nSpecificity histogram (analyzed entries):');
for (const k of ['root', 'fifth', 'triad', 'extended']) {
  console.log(`  ${k.padEnd(9)} ${pad(specHist[k], 6)}`);
}
console.log(`\nElapsed: ${elapsed}s`);

if (SAMPLE > 0) {
  console.log(`\nSample analyses (${Math.min(SAMPLE, samples.length)} of ${samples.length}):`);
  const step = Math.max(1, Math.floor(samples.length / SAMPLE));
  for (const s of samples.filter((_, i) => i % step === 0).slice(0, SAMPLE)) {
    console.log(`  ${s.slug}`);
    console.log(`    declared: ${s.declaredKey} | computed root: ${NOTE_NAMES[s.root]} (${s.root}) | specificity: ${s.specificity} | slots: ${s.slotCount}`);
    console.log(`    first 4 slots: ${JSON.stringify(s.firstSlots)}`);
  }
}

// ---- write ----
if (DRY) {
  console.log('\nDry-run only — nothing written. Re-run without --dry-run to persist.');
  process.exit(0);
}

try {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})/, '$1-');
  const backup = `${INDEX}.bak-${ts}`;
  copyFileSync(INDEX, backup);
  console.log(`\nBackup: ${backup}`);
  // flowLevel 3 keeps every existing field block-style (no depth-3 collections
  // pre-existed) while rendering timeline's inner pc sets flow: `- [0, 4, 7]`.
  writeFileSync(INDEX, yaml.dump(entries, { lineWidth: 120, noRefs: true, flowLevel: 3 }));
  console.log(`Wrote ${entries.length} entries to ${INDEX}`);
} catch (err) {
  console.error(`Failed to write index: ${err.message}`);
  process.exit(1);
}
