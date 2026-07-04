// PROTOTYPE (scratch): does the compatibility engine actually work on real data?
// Pick a bassline; find harmonically-matching chord beds; then melodies that fit
// those beds. Everything derived FROM NOTES IN C (the correct, comparable substrate
// — the stored index roman is in the original vendor key and not comparable).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import pkg from '@tonejs/midi';
import { mod12 } from '../shared/music/transpose.mjs';
import { minimalCycle, normalizeProgression } from '../shared/music/harmonicSignature.mjs';

const { Midi } = pkg;
const LOOPS = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/midi/loops';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CMAJ = new Set([0, 2, 4, 5, 7, 9, 11]);

function readNotes(rel) {
  const midi = new Midi(fs.readFileSync(path.join(LOOPS, rel)));
  const ppq = midi.header.ppq;
  const ts = midi.header.timeSignatures?.[0]?.timeSignature || [4, 4];
  const notes = [];
  for (const t of midi.tracks) { if (t.instrument?.percussion) continue; for (const n of t.notes) notes.push({ midi: n.midi, ticks: n.ticks, dur: n.durationTicks }); }
  return { notes, ppq, beats: ts[0], beatType: ts[1] };
}

const TRIADS = [['maj', [0, 4, 7]], ['min', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]]];
function fitTriadBass(pcs, bassPc) {
  if (pcs.size < 2) return null;
  let best = null;
  for (let root = 0; root < 12; root += 1) for (const [q, iv] of TRIADS) {
    const triad = iv.map((i) => (root + i) % 12);
    const present = triad.filter((pc) => pcs.has(pc)).length;
    if (present < 2) continue;
    const extra = [...pcs].filter((pc) => !triad.includes(pc)).length;
    let s = present * 2 - extra * 0.5;
    if (bassPc != null) s += root === bassPc ? 3 : triad.includes(bassPc) ? 0.5 : -1.5;
    if (!best || s > best.s) best = { root, q, s, triad };
  }
  return best;
}

// per-beat windows -> {pcs, bassPc}
function windows({ notes, ppq, beats, beatType }) {
  if (!notes.length) return { slots: [], beats, span: 0 };
  const bt = ppq * (4 / beatType);
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.dur || 0)), 0);
  const count = Math.max(1, Math.ceil(end / bt));
  const slots = Array.from({ length: count }, (_, s) => {
    const t0 = s * bt; const t1 = t0 + bt;
    const sounding = notes.filter((n) => n.ticks < t1 && n.ticks + (n.dur || 0) > t0);
    const onsets = sounding.filter((n) => n.ticks >= t0 && n.ticks < t1);
    const pool = onsets.length ? onsets : sounding;
    return {
      pcs: new Set(sounding.map((n) => mod12(n.midi))),
      bassPc: pool.length ? mod12(pool.reduce((lo, n) => (n.midi < lo.midi ? n : lo)).midi) : null,
      melodyPc: onsets.length ? mod12(onsets.reduce((hi, n) => (n.midi > hi.midi ? n : hi)).midi) : null,
    };
  });
  return { slots, beats, span: Math.ceil(count / beats) };
}

// root motion (in C), minimal-cycle reduced
function rootMotion(loop, isBass) {
  const { slots } = windows(loop);
  const roots = slots.map((w) => {
    if (isBass) return w.bassPc;              // bassline: the note IS the root
    const t = fitTriadBass(w.pcs, w.bassPc);  // chords: bass-informed triad fit
    return t ? t.root : null;
  }).filter((r) => r != null);
  return minimalCycle(normalizeProgression(roots.map(String))).map(Number);
}
const sig = (rm) => rm.join('-');
const isRotation = (a, b) => a.length === b.length && a.length > 0 && [...a, ...a].join(',').includes(b.join(','));

function main() {
  const index = yaml.load(fs.readFileSync(path.join(LOOPS, 'index.yml'), 'utf8'));
  const basslines = index.filter((e) => e.type === 'bassline');
  const chordLoops = index.filter((e) => e.type === 'chord-progression');
  const melodies = index.filter((e) => e.type === 'melody');

  // pick a bassline (arg = index into basslines, default a legible 4-chord one)
  const pick = Number(process.argv[2] ?? 0);
  const base = basslines[pick % basslines.length];
  const baseRM = rootMotion(readNotes(base.path), true);
  console.log(`\n=== BASE bassline: ${base.path.split('/').pop()} ===`);
  console.log(`   root motion (in C): ${baseRM.map((r) => NAMES[r]).join(' - ')}   sig=[${sig(baseRM)}]  bars=${windows(readNotes(base.path)).span}`);
  if (!baseRM.length) { console.log('   (no derivable root motion)'); return; }

  // 1) matching chord beds
  const chordFP = chordLoops.map((e) => { try { const w = readNotes(e.path); return { e, rm: rootMotion(w, false), bars: windows(w).span, w }; } catch { return null; } }).filter(Boolean);
  const exact = chordFP.filter((c) => sig(c.rm) === sig(baseRM));
  const rot = chordFP.filter((c) => sig(c.rm) !== sig(baseRM) && isRotation(c.rm, baseRM));
  console.log(`\n--- COMPATIBLE CHORD BEDS ---  exact sig match: ${exact.length}   rotational: ${rot.length}   (of ${chordFP.length} chord loops)`);
  exact.slice(0, 6).forEach((c) => console.log(`   [exact] ${c.e.path.split('/').pop().padEnd(40)} roots ${c.rm.map((r) => NAMES[r]).join('-')}  bars=${c.bars}`));
  rot.slice(0, 3).forEach((c) => console.log(`   [rot]   ${c.e.path.split('/').pop().padEnd(40)} roots ${c.rm.map((r) => NAMES[r]).join('-')}`));

  // 2) melodies that fit the top matched bed (chord-tone alignment over LCM)
  const bed = exact[0] || rot[0] || chordFP.find((c) => c.rm.length);
  if (!bed) { console.log('\n(no bed to test melodies against)'); return; }
  const bedSlots = bed.w ? windows(bed.w).slots.map((w) => fitTriadBass(w.pcs, w.bassPc)).filter(Boolean) : [];
  console.log(`\n--- MELODIES THAT FIT: ${bed.e.path.split('/').pop()} (${bed.rm.map((r) => NAMES[r]).join('-')}) ---`);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const scored = melodies.map((e) => {
    try {
      const w = windows(readNotes(e.path));
      const mel = w.slots.map((s) => s.melodyPc);
      const nb = bedSlots.length; const nm = mel.length;
      if (!nb || !nm) return null;
      const L = (nb * nm) / gcd(nb, nm);
      let notes = 0; let chordTone = 0; let inScale = 0;
      for (let i = 0; i < L; i += 1) {
        const mpc = mel[i % nm]; if (mpc == null) continue;
        notes += 1;
        const ch = bedSlots[i % nb]; if (ch && ch.triad.includes(mpc)) chordTone += 1;
        if (CMAJ.has(mpc)) inScale += 1;
      }
      if (!notes) return null;
      return { e, fit: chordTone / notes, scale: inScale / notes, notes };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.fit - a.fit);
  const strong = scored.filter((m) => m.fit >= 0.6);
  console.log(`   melodies with >=60% chord-tone fit: ${strong.length} of ${scored.length}`);
  scored.slice(0, 6).forEach((m) => console.log(`   fit ${(m.fit * 100).toFixed(0)}%  scale ${(m.scale * 100).toFixed(0)}%   ${m.e.path.split('/').pop()}`));
}
main();
