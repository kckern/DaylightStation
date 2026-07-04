// PROTOTYPE (scratch): does melody<->bed chord-tone fit DISCRIMINATE, or does
// everything-fit-everything (making the melody gate useless)? Score many melodies
// against several distinct beds; if the top melodies differ per bed and scores
// spread, the gate is informative.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { readMidi, analyzeHarmony } from './midi-to-musicxml.mjs';

const LOOPS = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/midi/_workspace/loops-midi';
const idx = yaml.load(fs.readFileSync(path.join(LOOPS, 'index.yml'), 'utf8'));
const TRIAD = { major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7] };

function beatChords(notes, ppq, beats, beatType) {
  const { runs } = analyzeHarmony(notes, ppq, beats, beatType, false);
  const perBeat = [];
  for (const r of runs) for (let i = 0; i < r.beats; i += 1) perBeat.push(new Set((TRIAD[r.quality] || [0]).map((iv) => (r.root + iv) % 12)));
  return perBeat;
}
function melodyLine(notes, ppq, beats, beatType) {
  const bt = ppq * (4 / beatType);
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.durationTicks || 0)), 0);
  const cnt = Math.max(1, Math.ceil(end / bt));
  return Array.from({ length: cnt }, (_, s) => {
    const on = notes.filter((n) => n.ticks >= s * bt && n.ticks < (s + 1) * bt);
    return on.length ? on.reduce((a, b) => (b.midi > a.midi ? b : a)).midi % 12 : null;
  });
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
function fit(mel, bed) {
  if (!mel.length || !bed.length) return 0;
  const L = mel.length * bed.length / gcd(mel.length, bed.length);
  let notes = 0; let hit = 0;
  for (let i = 0; i < L; i += 1) { const m = mel[i % mel.length]; if (m == null) continue; notes += 1; if (bed[i % bed.length].has(m)) hit += 1; }
  return notes ? hit / notes : 0;
}

// three distinct beds
const beds = ['A-F-C-G', 'C-G-A-F', 'D-A-B'].map((k) => idx.find((e) => e.type === 'chord-progression')); // placeholder; pick real below
const chosen = [];
for (const key of [[9, 5, 0, 7], [0, 7, 9, 5], [2, 9, 11]]) { // Am-F-C-G, C-G-Am-F, Dm-Am-Bdim-ish
  const found = idx.find((e) => {
    if (e.type !== 'chord-progression') return false;
    try { const m = readMidi(path.join(LOOPS, e.path)); const { runs } = analyzeHarmony(m.pitched, m.ppq, m.beats, m.beatType, false); const roots = runs.map((r) => r.root); return roots.length >= 3 && roots.length <= 5; } catch { return false; }
  });
  if (found) chosen.push(found);
}
// just take 3 different real beds
const bedEntries = idx.filter((e) => e.type === 'chord-progression').filter((_, i) => [10, 200, 800].includes(i)).slice(0, 3);
const melodies = idx.filter((e) => e.type === 'melody').filter((_, i) => i % 4 === 0); // ~290

const bedData = bedEntries.map((e) => { const m = readMidi(path.join(LOOPS, e.path)); return { e, bed: beatChords(m.pitched, m.ppq, m.beats, m.beatType) }; });
const melData = melodies.map((e) => { try { const m = readMidi(path.join(LOOPS, e.path)); return { e, mel: melodyLine(m.pitched, m.ppq, m.beats, m.beatType) }; } catch { return null; } }).filter(Boolean);

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const mu = mean(a); return Math.sqrt(mean(a.map((x) => (x - mu) ** 2))); };
const tops = [];
for (const { e, bed } of bedData) {
  const scored = melData.map((md) => ({ slug: md.e.slug, f: fit(md.mel, bed) })).sort((a, b) => b.f - a.f);
  const fits = scored.map((s) => s.f);
  console.log(`\nBED ${e.slug.slice(0, 40)} (${bed.length} beats)`);
  console.log(`  melody-fit over ${melData.length} melodies: mean ${(mean(fits) * 100).toFixed(0)}%  std ${(std(fits) * 100).toFixed(0)}%  >=80%: ${fits.filter((f) => f >= 0.8).length}  <50%: ${fits.filter((f) => f < 0.5).length}`);
  tops.push(new Set(scored.slice(0, 30).map((s) => s.slug)));
}
// discrimination: overlap of top-30 melodies between beds (low = discriminating)
function jac(a, b) { const i = [...a].filter((x) => b.has(x)).length; return i / new Set([...a, ...b]).size; }
console.log(`\nTop-30 melody overlap between beds (Jaccard; LOW = matching discriminates):`);
console.log(`  bed1 vs bed2: ${(jac(tops[0], tops[1]) * 100).toFixed(0)}%   bed1 vs bed3: ${(jac(tops[0], tops[2]) * 100).toFixed(0)}%   bed2 vs bed3: ${(jac(tops[1], tops[2]) * 100).toFixed(0)}%`);
