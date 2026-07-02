#!/usr/bin/env node

/**
 * MIDI Loop Library — ingest / organize / convert
 *
 * Reads the raw producer MIDI packs, parses metadata from their filenames,
 * collapses the 12-key redundancy by canonical pitch-class signature, transposes
 * the chosen member to the canonical key (C major / A minor), and writes a clean
 * kebab-case, role-first tree plus a queryable index.yml.
 *
 * PERCUSSION ROUTING — no flag needed; detection is content-based, matching the
 * heuristic (filename/folder) routing used for harmonic types. Each track is
 * drum-detected via shared/music/percussion.isDrumTrack (channel 9 authoritative;
 * ≥60% GM_DRUM pitch coverage as fallback). A whole FILE ingests as type
 * 'groove' only when it has CHANNEL-9 drum evidence AND its drum-detected
 * tracks carry ≥90% of its notes; files mixing channel-9 drums with substantial
 * pitched material are SKIPPED with a report line (never silently converted).
 * Coverage-only detections (no channel-9 track anywhere) NEVER flip a file to
 * groove — basslines/riffs in the 36–51 region routinely fake the coverage bar
 * (76 confirmed false positives on the real packs) — they stay harmonic and
 * are only counted in the report as hygiene suggestions. Grooves land under
 * percussion/ in the tree, carry feel ('straight'|'swing' via detectFeel) +
 * barSpan + bpm, and get NO key/roman/transposition fields — the canonical-key
 * transposition step copies them verbatim (transposing would remap drum pieces).
 *
 * WRITE SAFETY — enrichment fields (timeline/title/signature/…) are
 * loop-enrich's + enrich-index's domain; the ingest never computes them, but a
 * re-ingest --write PRESERVES them: before overwriting index.yml it (a) backs
 * the old index up to index.yml.bak-YYYYMMDD-HHmmss, and (b) carries each
 * entry's enrichment fields forward from the old index (matched by slug) when
 * the produced .mid bytes are identical to the old entry's file. Changed
 * content drops the stale enrichment for the next enrichment run to recompute.
 *
 * Dry-run by default (prints stats only). Pass --write to persist.
 *
 * Usage:
 *   node cli/midi-ingest.mjs                       # dry-run over the whole tree
 *   node cli/midi-ingest.mjs --limit=3000          # dry-run, first N files (fast)
 *   node cli/midi-ingest.mjs --write               # write canonical tree + index.yml
 *   node cli/midi-ingest.mjs --src=PATH --out=PATH # override source / destination
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import midiPkg from '@tonejs/midi';

import { filenameToLoopMeta } from './midi-ingest/loopMeta.mjs';
import {
  canonicalShift, noteSignature, mergeLoopGroup, targetPath,
  classifyDrums, pickEnrichment, slugMap,
} from './midi-ingest/ingestCore.mjs';
import { romanAnalysis, bestTonic } from '../shared/music/romanAnalysis.mjs';
import { mod12 } from '../shared/music/transpose.mjs';
import { isDrumTrack, detectFeel } from '../shared/music/percussion.mjs';

const { Midi } = midiPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

// ---- args ----
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const WRITE = flag('write');
const LIMIT = Number(opt('limit', 0)) || 0;
const SRC = path.resolve(opt('src', path.join(process.env.DAYLIGHT_BASE_PATH || '', 'media/midi')));
const OUT = path.resolve(opt('out', path.join(SRC, 'loops')));

// ---- helpers ----
const majorTonicOf = (key) => {
  if (!key) return 0;
  if (key.major !== null && key.major !== undefined) return key.major;
  if (key.minor !== null && key.minor !== undefined) return mod12(key.minor + 3);
  return 0;
};

function readMidiFile(absPath) {
  const midi = new Midi(readFileSync(absPath));
  const tracks = midi.tracks.map((tr) => ({
    channel: tr.channel,
    notes: tr.notes.map((n) => ({ ticks: n.ticks, midi: n.midi, durationTicks: n.durationTicks })),
  }));
  const ts = midi.header.timeSignatures?.[0]?.timeSignature || [4, 4];
  const tempo = midi.header.tempos?.[0]?.bpm;
  return {
    tracks,
    notes: tracks.flatMap((tr) => tr.notes),
    ppq: midi.header.ppq || 480,
    headerBpm: Number.isFinite(tempo) ? Math.round(tempo) : null,
    timeSig: ts,
  };
}

/** Whole-bar span covering the notes' tick extent (timeSig [beats, beatType]
 * from the header; same bar math as harmonicClassify's windowing). */
function barSpanOf(notes, ppq, timeSig) {
  const [beats, beatType] = timeSig;
  const ticksPerBar = (beats * ppq * 4) / beatType || ppq * 4;
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.durationTicks || 0)), 0);
  return Math.max(1, Math.ceil(end / ticksPerBar));
}

/** Bytes of the canonical (transposed to C) copy of `member`. Shift 0 returns
 * the source bytes verbatim, so unchanged content is byte-stable across runs
 * (which is what the enrichment carry-over compares on). */
function canonicalBytes(member) {
  const shift = canonicalShift(majorTonicOf(member.meta.key));
  const src = readFileSync(member.abs);
  if (shift === 0) return src;
  const midi = new Midi(src);
  for (const tr of midi.tracks) {
    const shifted = tr.notes.map((n) => ({ midi: n.midi + shift, ticks: n.ticks, durationTicks: n.durationTicks, velocity: n.velocity }));
    tr.notes.length = 0;
    for (const n of shifted) tr.addNote(n);
  }
  return Buffer.from(midi.toArray());
}

// ---- walk source ----
if (!SRC || !existsSync(SRC)) {
  console.error(`Source MIDI dir not found: ${SRC}\nSet DAYLIGHT_BASE_PATH or pass --src=PATH`);
  process.exit(1);
}
console.log(`Source: ${SRC}`);
console.log(`Output: ${OUT}  (${WRITE ? 'WRITE' : 'dry-run'})`);

let files = execSync(`find "${SRC}" -name '*.mid'`, { maxBuffer: 1 << 30 })
  .toString().trim().split('\n')
  .map((p) => p.slice(SRC.length + 1))
  .filter((p) => p && !p.startsWith('loops/') && !p.startsWith('_archive/'));
if (LIMIT) files = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / LIMIT)) === 0).slice(0, LIMIT);
console.log(`Scanning ${files.length} MIDI files…`);

// ---- group by canonical signature ----
const groups = new Map();
const mixedSkipped = []; // { rel, ratio } — ch-9 drum+pitched files we refuse to auto-route
let coverageSuggestions = 0; // drum-looking files with NO channel-9 evidence (stay harmonic)
let read = 0; let failed = 0;
for (const rel of files) {
  const meta = filenameToLoopMeta(rel);
  let parsed;
  try { parsed = readMidiFile(path.join(SRC, rel)); } catch { failed += 1; continue; }
  const { tracks, notes, ppq, headerBpm, timeSig } = parsed;

  const drums = classifyDrums(tracks);
  if (drums.kind === 'mixed') {
    mixedSkipped.push({ rel, ratio: drums.ratio });
    continue;
  }
  if (drums.coverageSuggestion) coverageSuggestions += 1;

  let sig;
  let groove = null;
  if (drums.kind === 'groove') {
    // Percussion is key-less: strip harmonic metadata so the merge/index and
    // transposition steps never see key/chords/degrees on a groove.
    meta.type = 'groove';
    meta.key = null;
    meta.chords = null;
    meta.degrees = null;
    const drumNotes = tracks
      .filter((tr) => tr.notes.length > 0 && isDrumTrack({ channel: tr.channel, notes: tr.notes }))
      .flatMap((tr) => tr.notes);
    groove = {
      feel: detectFeel(drumNotes.map((n) => n.ticks), ppq),
      barSpan: barSpanOf(notes, ppq, timeSig),
      headerBpm,
    };
    sig = `groove|${noteSignature(notes, 0)}`; // no canonical shift for drums
  } else {
    const shift = canonicalShift(majorTonicOf(meta.key));
    sig = `${meta.type}|${noteSignature(notes, shift)}`;
  }

  if (!groups.has(sig)) groups.set(sig, []);
  groups.get(sig).push({ meta, abs: path.join(SRC, rel), noteCount: notes.length, groove });
  read += 1;
  if (read % 5000 === 0) console.log(`  …${read}/${files.length}`);
}

// ---- merge + plan ----
// Enrichment carry-over (WRITE only): entries matched by slug to the previous
// index keep their loop-enrich/enrich-index fields when the produced bytes are
// identical to the old entry's file. See WRITE SAFETY in the header.
const oldIndexPath = path.join(OUT, 'index.yml');
let oldBySlug = new Map();
if (WRITE && existsSync(oldIndexPath)) {
  try { oldBySlug = slugMap(yaml.load(readFileSync(oldIndexPath, 'utf8')) || []); }
  catch (err) { console.warn(`Could not read old index for enrichment carry-over: ${err.message}`); }
}
let enrichmentKept = 0; let enrichmentDropped = 0;

const usedPaths = new Set();
const index = [];
const byType = {};
const byRole = {};
for (const members of groups.values()) {
  const merged = mergeLoopGroup(members.map((m) => m.meta));
  let dest = targetPath(merged);
  let n = 1;
  while (usedPaths.has(dest)) { // slug collision across distinct ideas
    const ext = dest.endsWith('.mid') ? '.mid' : '';
    dest = `${dest.replace(/\.mid$/, '')}-${++n}${ext}`;
  }
  usedPaths.add(dest);

  byType[merged.type] = (byType[merged.type] || 0) + 1;
  byRole[dest.split('/')[0]] = (byRole[dest.split('/')[0]] || 0) + 1;

  let entry;
  if (merged.type === 'groove') {
    // Percussion entry: feel + barSpan instead of key/roman/transposition
    // fields (grooves are key-less; nothing to transpose or analyze). All
    // grooves are channel-9-backed by construction (classifyDrums gate).
    const groove = members.find((m) => m.groove)?.groove || {};
    entry = {
      slug: merged.slug,
      path: dest,
      type: 'groove',
      sources: merged.sources,
      feel: groove.feel || 'straight',
      barSpan: groove.barSpan || 1,
      bpm: merged.bpm || groove.headerBpm || null,
      mood: merged.mood || null,
      descriptor: merged.descriptor || null,
      copies: members.length,
      origin: members[0].meta.sourcePath,
    };
  } else {
    // Roman signature is derived from the chords' own key (some packs spell chords
    // in the original key inside a transposed-to-C folder), not the folder/canonical key.
    const roman = merged.chords ? romanAnalysis(merged.chords, bestTonic(merged.chords)) : null;
    entry = {
      slug: merged.slug,
      path: dest,
      type: merged.type,
      sources: merged.sources,
      canonicalKey: merged.key?.raw || null,
      availableKeys: merged.availableKeys,
      chords: merged.chords || null,
      roman,
      degrees: merged.degrees || null,
      mood: merged.mood || null,
      descriptor: merged.descriptor || null,
      bpm: merged.bpm || null,
      reverb: merged.reverb || null,
      artist: merged.artist || null,
      copies: members.length,
      origin: members[0].meta.sourcePath,
    };
  }

  if (WRITE) {
    // Grooves copy verbatim — the canonical-key transposition step must SKIP
    // them (shifting pitches would remap kick/snare/hat onto different drum
    // pieces). Harmonic entries transpose their canonical member to C.
    const bytes = merged.type === 'groove'
      ? readFileSync(members[0].abs)
      : canonicalBytes(members.find((m) => m.meta.key?.major === 0) || members[0]);

    const oldEntry = oldBySlug.get(entry.slug);
    if (oldEntry) {
      const oldFile = path.join(OUT, oldEntry.path);
      if (existsSync(oldFile) && readFileSync(oldFile).equals(bytes)) {
        Object.assign(entry, pickEnrichment(oldEntry)); // content unchanged → keep enrichment
        enrichmentKept += 1;
      } else {
        enrichmentDropped += 1; // content changed → stale enrichment; re-run loop-enrich
      }
    }

    const dst = path.join(OUT, dest);
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, bytes);
  }

  index.push(entry);
}

// ---- report ----
console.log('\n=== INGEST SUMMARY ===');
console.log(`read OK:        ${read}   (failed: ${failed})`);
console.log(`unique ideas:   ${index.length}   (collapsed ${read} → ${index.length}, ${(100 * (1 - index.length / read)).toFixed(1)}% redundancy removed)`);
console.log('by type:', byType);
console.log('by role dir:', byRole);
console.log('sample entries:');
for (const e of index.slice(0, 5)) {
  const detail = e.type === 'groove'
    ? `groove ${e.feel} (${e.barSpan} bar${e.barSpan === 1 ? '' : 's'})`
    : `${e.roman ? e.roman.join(' ') : (e.degrees ? `deg ${e.degrees.join('-')}` : '')} | keys: ${e.availableKeys.length}`;
  console.log('  ', e.path, '|', detail);
}

const grooves = index.filter((e) => e.type === 'groove');
console.log('\n=== GROOVES ===');
console.log(`grooves:        ${grooves.length}  (all channel-9 backed)`);
if (grooves.length > 0) {
  const feelDist = {};
  for (const g of grooves) feelDist[g.feel] = (feelDist[g.feel] || 0) + 1;
  console.log('feel:          ', feelDist);
}
if (coverageSuggestions > 0) {
  console.log(`coverage-only:  ${coverageSuggestions} files look drummy by GM-pitch coverage but have no channel-9 track — kept harmonic (heuristic false-positive zone)`);
}
if (mixedSkipped.length > 0) {
  console.log(`mixed skipped:  ${mixedSkipped.length}  (channel-9 drums + pitched material in one file; not auto-routed)`);
  for (const m of mixedSkipped) console.log(`   SKIP mixed: ${m.rel}  (drum share ${(100 * m.ratio).toFixed(0)}%)`);
}

if (WRITE) {
  mkdirSync(OUT, { recursive: true });
  if (existsSync(oldIndexPath)) {
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const bak = `${oldIndexPath}.bak-${ts}`;
    copyFileSync(oldIndexPath, bak);
    console.log(`\nBacked up previous index → ${path.basename(bak)}`);
  }
  writeFileSync(oldIndexPath, yaml.dump(index, { lineWidth: 120, noRefs: true }));
  console.log(`Wrote ${index.length} loops + index.yml to ${OUT}`);
  if (enrichmentKept + enrichmentDropped > 0) {
    console.log(`enrichment: carried forward ${enrichmentKept}, dropped ${enrichmentDropped} (content changed — re-run loop-enrich + enrich-index)`);
  }
} else {
  console.log('\nDry-run only. Re-run with --write to persist the canonical tree + index.yml.');
}
