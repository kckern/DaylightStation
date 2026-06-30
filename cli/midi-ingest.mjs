#!/usr/bin/env node

/**
 * MIDI Loop Library — ingest / organize / convert
 *
 * Reads the raw producer MIDI packs, parses metadata from their filenames,
 * collapses the 12-key redundancy by canonical pitch-class signature, transposes
 * the chosen member to the canonical key (C major / A minor), and writes a clean
 * kebab-case, role-first tree plus a queryable index.yml.
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
import { canonicalShift, noteSignature, mergeLoopGroup, targetPath } from './midi-ingest/ingestCore.mjs';
import { romanAnalysis, bestTonic } from '../shared/music/romanAnalysis.mjs';
import { mod12 } from '../shared/music/transpose.mjs';

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

function readNotes(absPath) {
  const midi = new Midi(readFileSync(absPath));
  const notes = [];
  for (const tr of midi.tracks) for (const n of tr.notes) notes.push({ ticks: n.ticks, midi: n.midi });
  return notes;
}

/** Write a canonical (transposed to C) copy of `member` to `dest`. */
function writeCanonical(member, dest) {
  const shift = canonicalShift(majorTonicOf(member.meta.key));
  mkdirSync(path.dirname(dest), { recursive: true });
  if (shift === 0) { copyFileSync(member.abs, dest); return; }
  const midi = new Midi(readFileSync(member.abs));
  for (const tr of midi.tracks) {
    const shifted = tr.notes.map((n) => ({ midi: n.midi + shift, ticks: n.ticks, durationTicks: n.durationTicks, velocity: n.velocity }));
    tr.notes.length = 0;
    for (const n of shifted) tr.addNote(n);
  }
  writeFileSync(dest, Buffer.from(midi.toArray()));
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
let read = 0; let failed = 0;
for (const rel of files) {
  const meta = filenameToLoopMeta(rel);
  let notes;
  try { notes = readNotes(path.join(SRC, rel)); } catch { failed += 1; continue; }
  const shift = canonicalShift(majorTonicOf(meta.key));
  const sig = `${meta.type}|${noteSignature(notes, shift)}`;
  if (!groups.has(sig)) groups.set(sig, []);
  groups.get(sig).push({ meta, abs: path.join(SRC, rel), noteCount: notes.length });
  read += 1;
  if (read % 5000 === 0) console.log(`  …${read}/${files.length}`);
}

// ---- merge + plan ----
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

  // Roman signature is derived from the chords' own key (some packs spell chords
  // in the original key inside a transposed-to-C folder), not the folder/canonical key.
  const roman = merged.chords ? romanAnalysis(merged.chords, bestTonic(merged.chords)) : null;
  byType[merged.type] = (byType[merged.type] || 0) + 1;
  byRole[dest.split('/')[0]] = (byRole[dest.split('/')[0]] || 0) + 1;

  index.push({
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
  });

  if (WRITE) {
    const canonicalMember = members.find((m) => m.meta.key?.major === 0) || members[0];
    writeCanonical(canonicalMember, path.join(OUT, dest));
  }
}

// ---- report ----
console.log('\n=== INGEST SUMMARY ===');
console.log(`read OK:        ${read}   (failed: ${failed})`);
console.log(`unique ideas:   ${index.length}   (collapsed ${read} → ${index.length}, ${(100 * (1 - index.length / read)).toFixed(1)}% redundancy removed)`);
console.log('by type:', byType);
console.log('by role dir:', byRole);
console.log('sample entries:');
for (const e of index.slice(0, 5)) console.log('  ', e.path, '|', e.roman ? e.roman.join(' ') : (e.degrees ? `deg ${e.degrees.join('-')}` : ''), '| keys:', e.availableKeys.length);

if (WRITE) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'index.yml'), yaml.dump(index, { lineWidth: 120, noRefs: true }));
  console.log(`\nWrote ${index.length} loops + index.yml to ${OUT}`);
} else {
  console.log('\nDry-run only. Re-run with --write to persist the canonical tree + index.yml.');
}
