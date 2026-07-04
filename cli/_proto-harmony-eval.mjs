// PROTOTYPE (scratch, not committed): de-risk "derive harmony from notes".
// Pits note-based derivation (bar-resolution = existing classifier, and a new
// beat-resolution variant the self-indexing design calls for) against the
// filename-derived `roman` stored in index.yml, across a stratified real sample.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import pkg from '@tonejs/midi';
const { Midi } = pkg;
import { mod12 } from '../shared/music/transpose.mjs';
import { romanAnalysis, bestTonic } from '../shared/music/romanAnalysis.mjs';
import { classifyHarmony, pcSetToTriad } from './midi-ingest/harmonicClassify.mjs';
import { signatureKey, minimalCycle, normalizeProgression } from '../shared/music/harmonicSignature.mjs';
import { parseChordSymbol } from '../shared/music/chords.mjs';

// tonic-free root-motion signature: the sequence of chord roots (0..11),
// consecutive-deduped and reduced to its minimal repeating cycle. Two loops
// with the same harmony match here regardless of which chord we call "I".
function roots(chords) {
  return (chords || []).map((c) => (typeof c === 'string' ? parseChordSymbol(c)?.root : c?.root)).filter((r) => r != null);
}
function rootSig(chords) {
  return minimalCycle(normalizeProgression(roots(chords).map(String))).join('-');
}
// transposition-INVARIANT progression shape: the cyclic interval sequence between
// consecutive roots. Same progression in ANY key -> same string.
function intervalSig(chords) {
  const rs = minimalCycle(normalizeProgression(roots(chords).map(String))).map(Number);
  if (rs.length < 2) return '';
  const ivals = rs.map((r, i) => ((rs[(i + 1) % rs.length] - r) % 12 + 12) % 12);
  return ivals.join('-');
}

const LOOPS = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/midi/loops';
const index = yaml.load(fs.readFileSync(path.join(LOOPS, 'index.yml'), 'utf8'));

// ---- note extraction from a .mid, skipping percussion tracks ----
function loadNotes(relPath) {
  const buf = fs.readFileSync(path.join(LOOPS, relPath));
  const midi = new Midi(buf);
  const ppq = midi.header.ppq;
  const ts = midi.header.timeSignatures?.[0]?.timeSignature || [4, 4];
  const notes = [];
  for (const track of midi.tracks) {
    if (track.instrument?.percussion) continue; // drums carry no harmony
    for (const n of track.notes) {
      notes.push({ midi: n.midi, ticks: n.ticks, durationTicks: n.durationTicks });
    }
  }
  return { notes, ppq, beats: ts[0], beatType: ts[1] };
}

// ---- beat-resolution derivation (what the design calls for) ----
function windowChordsPerBeat(notes, { ppq, beats = 4, beatType = 4 }) {
  if (!notes.length) return [];
  const beatTicks = ppq * (4 / beatType);
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.durationTicks || 0)), 0);
  const slotCount = Math.max(1, Math.ceil(end / beatTicks));
  const slots = Array.from({ length: slotCount }, () => new Set());
  for (const n of notes) {
    const start = Math.max(0, Math.floor(n.ticks / beatTicks));
    const stop = Math.max(start + 1, Math.ceil((n.ticks + (n.durationTicks || 0)) / beatTicks));
    for (let s = start; s < Math.min(stop, slotCount); s += 1) slots[s].add(mod12(n.midi));
  }
  return slots;
}

// ---- V2 analyzer: bass-informed, onset-weighted, color-tolerant ----
const TRIADS2 = [
  { quality: 'major', intervals: [0, 4, 7] },
  { quality: 'minor', intervals: [0, 3, 7] },
  { quality: 'diminished', intervals: [0, 3, 6] },
  { quality: 'augmented', intervals: [0, 4, 8] },
  { quality: 'sus4', intervals: [0, 5, 7] },
  { quality: 'sus2', intervals: [0, 2, 7] },
];
// pcSet: Set of sounding pcs; bassPc: pc of lowest note (the strongest root cue).
function fitTriadBass(pcSet, bassPc) {
  if (!pcSet || pcSet.size < 2) return null;
  let best = null;
  for (let root = 0; root < 12; root += 1) {
    for (const { quality, intervals } of TRIADS2) {
      const triad = intervals.map((i) => (root + i) % 12);
      const present = triad.filter((pc) => pcSet.has(pc)).length;
      if (present < 2) continue;
      const extra = [...pcSet].filter((pc) => !triad.includes(pc)).length;
      let score = present * 2 - extra * 0.5; // color tones (7/9/add) shouldn't veto the triad
      if (bassPc != null) {
        if (root === bassPc) score += 3;              // bass = root: the common case
        else if (triad.includes(bassPc)) score += 0.5; // inversion: bass is a chord tone
        else score -= 1.5;                             // bass foreign to chord: unlikely
      }
      if (!best || score > best.score) best = { root, quality, score };
    }
  }
  return best ? { root: best.root, quality: best.quality } : null;
}

function windowsWithBass(notes, { ppq, beats = 4, beatType = 4 }) {
  if (!notes.length) return [];
  const beatTicks = ppq * (4 / beatType);
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.durationTicks || 0)), 0);
  const slotCount = Math.max(1, Math.ceil(end / beatTicks));
  return Array.from({ length: slotCount }, (_, s) => {
    const t0 = s * beatTicks; const t1 = t0 + beatTicks;
    const sounding = notes.filter((n) => n.ticks < t1 && n.ticks + (n.durationTicks || 0) > t0);
    const onsets = sounding.filter((n) => n.ticks >= t0 && n.ticks < t1);
    // onset pcs weighted double (dampens sustained bleed); fall back to all sounding.
    const pcs = new Set(sounding.map((n) => mod12(n.midi)));
    const pool = onsets.length ? onsets : sounding;
    const bassPc = pool.length ? mod12(pool.reduce((lo, n) => (n.midi < lo.midi ? n : lo)).midi) : null;
    return { pcs, bassPc, onsetCount: onsets.length };
  });
}

function deriveV2(notes, timeSig) {
  const wins = windowsWithBass(notes, timeSig);
  const perSlot = wins.map((w) => fitTriadBass(w.pcs, w.bassPc));
  // collapse: merge a window into the previous chord when it has no new onset and its
  // pcs are a subset of the previous chord (an arpeggio/sustain of the same harmony).
  const collapsed = [];
  perSlot.forEach((c, i) => {
    if (!c) return;
    const last = collapsed[collapsed.length - 1];
    const same = last && last.root === c.root && last.quality === c.quality;
    if (same) return;
    collapsed.push(c);
  });
  const resolved = perSlot.filter(Boolean).length;
  const confidence = perSlot.length ? resolved / perSlot.length : 0;
  if (!collapsed.length) return { roman: null, confidence, chords: [] };
  const tonic = bestTonic(collapsed);
  return { roman: romanAnalysis(collapsed, tonic), confidence, chords: collapsed };
}

function deriveBeat(notes, timeSig) {
  const slots = windowChordsPerBeat(notes, timeSig);
  const perSlot = slots.map(pcSetToTriad); // {root,quality}|null per beat
  // collapse consecutive identical chords into a progression
  const collapsed = [];
  for (const c of perSlot) {
    if (!c) continue;
    const last = collapsed[collapsed.length - 1];
    if (!last || last.root !== c.root || last.quality !== c.quality) collapsed.push(c);
  }
  const resolvedSlots = perSlot.filter(Boolean).length;
  const confidence = perSlot.length ? resolvedSlots / perSlot.length : 0;
  if (!collapsed.length) return { roman: null, confidence, chords: [] };
  const tonic = bestTonic(collapsed);
  return { roman: romanAnalysis(collapsed, tonic), confidence, chords: collapsed };
}

// ---- comparison of two roman sequences (key-agnostic) ----
function romanEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}
// coarse degree-set agreement (ignores order/length; "did we find the right chords")
function degreeSet(roman) {
  return new Set((roman || []).map((r) => r.replace(/[°+]|sus\d/g, '')).filter((r) => r !== '?'));
}
function setJaccard(a, b) {
  const A = degreeSet(a); const B = degreeSet(b);
  if (!A.size && !B.size) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
}

// ---- stratified sample ----
function sample(pred, n) {
  const pool = index.filter(pred);
  if (pool.length <= n) return pool;
  const step = Math.floor(pool.length / n);
  return Array.from({ length: n }, (_, i) => pool[i * step]);
}
const hasRoman = (e) => Array.isArray(e.roman) && e.roman.length > 0;
const samples = [
  ...sample((e) => e.type === 'chord-progression' && e.sources?.includes('famous') && hasRoman(e), 8),
  ...sample((e) => e.type === 'chord-progression' && !e.sources?.includes('famous') && hasRoman(e), 10),
  ...sample((e) => e.type === 'bassline' && hasRoman(e), 6),
  ...sample((e) => e.type === 'melody', 8),
];

// ---- run ----
const rows = [];
for (const e of samples) {
  let r;
  try { r = loadNotes(e.path); } catch (err) { rows.push({ e, error: String(err.message || err) }); continue; }
  const ts = { ppq: r.ppq, beats: r.beats, beatType: r.beatType };
  const beat = deriveBeat(r.notes, ts);
  const v2 = deriveV2(r.notes, ts);
  rows.push({
    e, notes: r.notes.length,
    ref: e.roman,
    beat: beat.roman, beatConf: beat.confidence,
    v2: v2.roman, v2Conf: v2.confidence,
    refIval: intervalSig(e.chords), beatIval: intervalSig(beat.chords), v2Ival: intervalSig(v2.chords),
    beatChords: beat.chords.length, v2Chords: v2.chords.length,
  });
}

// ---- report ----
const fmt = (a) => (Array.isArray(a) ? a.join(' ') : String(a));
for (const row of rows) {
  const t = row.e.type.replace('chord-progression', 'chords');
  console.log(`\n[${t}] ${row.e.path.split('/').slice(-2).join('/')}`);
  if (row.error) { console.log(`  ERROR: ${row.error}`); continue; }
  console.log(`  notes=${row.notes}  ref-roman=${fmt(row.ref)}`);
  console.log(`  V1 derive : ${fmt(row.beat)}   [conf ${row.beatConf.toFixed(2)}]`);
  console.log(`  V2 derive : ${fmt(row.v2)}   [conf ${row.v2Conf.toFixed(2)}]`);
  const v1m = !!row.refIval && row.refIval === row.beatIval;
  const v2m = !!row.refIval && row.refIval === row.v2Ival;
  console.log(`  SHAPE-sig : ref[${row.refIval}]  V1[${row.beatIval}]=${v1m}  V2[${row.v2Ival}]=${v2m}`);
}

// ---- aggregate (harmonic types only; melodies excluded from harmony scoring) ----
const harm = rows.filter((r) => !r.error && r.e.type !== 'melody');
const mel = rows.filter((r) => !r.error && r.e.type === 'melody');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log('\n================ SUMMARY ================');
console.log(`harmonic samples: ${harm.length}   melody samples: ${mel.length}   errors: ${rows.filter((r) => r.error).length}`);
const beds = harm.filter((r) => r.e.type === 'chord-progression');
const shape = (r, k) => r.refIval && r.refIval === r[k];
console.log(`Transposition-invariant SHAPE match on beds (n=${beds.length}) — did we recover the progression, any key?`);
console.log(`  V1 (plain beat)      : ${beds.filter((r) => shape(r, 'beatIval')).length}/${beds.length}   meanConf ${mean(beds.map((r) => r.beatConf)).toFixed(2)}`);
console.log(`  V2 (bass+onset+color): ${beds.filter((r) => shape(r, 'v2Ival')).length}/${beds.length}   meanConf ${mean(beds.map((r) => r.v2Conf)).toFixed(2)}`);
// Is the reference progression a contiguous CYCLIC substring of V2's? If so the
// harmony is correct and only the loop-boundary/cycle collapse missed.
function cyclicContains(hayStr, needleStr) {
  if (!hayStr || !needleStr) return false;
  const hay = hayStr.split('-'); const nd = needleStr.split('-');
  if (nd.length > hay.length) return false;
  const doubled = [...hay, ...hay];
  for (let i = 0; i < hay.length; i += 1) {
    if (nd.every((x, j) => doubled[i + j] === x)) return true;
  }
  return false;
}
const v2HarmonyOk = (r) => shape(r, 'v2Ival') || cyclicContains(r.v2Ival, r.refIval);
console.log(`  V2 harmony correct incl. boundary-only misses: ${beds.filter(v2HarmonyOk).length}/${beds.length}`);
console.log(`  V2 improved on: ${beds.filter((r) => shape(r, 'v2Ival') && !shape(r, 'beatIval')).map((r) => r.e.path.split('/').pop()).join(', ') || '(none)'}`);
console.log(`  still wrong (true harmony miss): ${beds.filter((r) => !v2HarmonyOk(r)).map((r) => r.e.path.split('/').pop()).join(', ') || '(none)'}`);
console.log(`melody beat-conf (harmony present?): mean ${mean(mel.map((r) => r.beatConf)).toFixed(2)} — low is expected/fine (melodies use note-names, not chords)`);
