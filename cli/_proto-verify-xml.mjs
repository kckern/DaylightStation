// PROTOTYPE (scratch): verify emitted MusicXML faithfully reproduces the source MIDI.
// Parse each .musicxml back to notes, build a 16th-note pitch-occupancy grid, and
// compare slot-by-slot against the source .mid's grid. Also prints an ASCII piano
// roll for one brick so a human can eyeball it.
import fs from 'node:fs';
import path from 'node:path';
import { readMidi } from './midi-to-musicxml.mjs';

const ROOT = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/midi';
const LOOPS = path.join(ROOT, '_workspace', 'loops-midi');
const DIV = 4; // 16th grid (matches converter)
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// ---- parse our MusicXML back to notes: [{midi, onset(16ths), dur(16ths)}] ----
function parseXml(xml) {
  const beatsM = xml.match(/<beats>(\d+)<\/beats>/); const btM = xml.match(/<beat-type>(\d+)<\/beat-type>/);
  const beats = beatsM ? +beatsM[1] : 4; const beatType = btM ? +btM[1] : 4;
  const measureLen = DIV * beats * (4 / beatType);
  const notes = [];
  const measures = xml.split(/<measure number="\d+">/).slice(1);
  measures.forEach((mBody, mi) => {
    const base = mi * measureLen;
    let cursor = 0; let prevOnset = 0;
    // process <note> and <backup> in document order (backup = voice reset)
    const toks = mBody.match(/<note>[\s\S]*?<\/note>|<backup>[\s\S]*?<\/backup>/g) || [];
    for (const tk of toks) {
      if (tk.startsWith('<backup>')) { cursor -= +(tk.match(/<duration>(\d+)/)?.[1] || 0); prevOnset = cursor; continue; }
      const dur = +(tk.match(/<duration>(\d+)<\/duration>/)?.[1] || 0);
      const isChord = /<chord\/>/.test(tk);
      const isRest = /<rest\/>/.test(tk);
      const onset = base + (isChord ? prevOnset : cursor);
      if (!isRest) {
        const step = tk.match(/<(?:display-)?step>([A-G])<\/(?:display-)?step>/)?.[1];
        const alter = +(tk.match(/<alter>(-?\d+)<\/alter>/)?.[1] || 0);
        const oct = +(tk.match(/<(?:display-)?octave>(-?\d+)<\/(?:display-)?octave>/)?.[1] || 4);
        const midi = (oct + 1) * 12 + STEP[step] + alter;
        notes.push({ midi, onset, dur });
      }
      if (!isChord) { prevOnset = cursor; cursor += dur; }
    }
  });
  return notes;
}

// ---- pitch-occupancy grid: slot -> Set(midi) ----
function grid(notes, toSlots) {
  const g = new Map();
  let max = 0;
  for (const n of notes) {
    const { onset, dur } = toSlots(n);
    for (let s = onset; s < onset + Math.max(1, dur); s += 1) {
      if (!g.has(s)) g.set(s, new Set());
      g.get(s).add(n.midi);
      max = Math.max(max, s + 1);
    }
  }
  return { g, max };
}
function compare(srcNotes, ppq, xmlNotes) {
  const src = grid(srcNotes.map((n) => ({ midi: n.midi, onset: Math.round(n.ticks / ppq * DIV), dur: Math.round((n.durationTicks || 0) / ppq * DIV) })), (n) => n);
  const xml = grid(xmlNotes, (n) => ({ onset: n.onset, dur: n.dur }));
  const max = Math.max(src.max, xml.max);
  let exact = 0; let jac = 0; let slots = 0;
  for (let s = 0; s < max; s += 1) {
    const a = src.g.get(s) || new Set(); const b = xml.g.get(s) || new Set();
    if (!a.size && !b.size) continue;
    slots += 1;
    const inter = [...a].filter((x) => b.has(x)).length;
    const uni = new Set([...a, ...b]).size;
    if (inter === a.size && inter === b.size) exact += 1;
    jac += uni ? inter / uni : 1;
  }
  return { slotExact: slots ? exact / slots : 1, slotJaccard: slots ? jac / slots : 1, slots, srcNotes: srcNotes.length, xmlNotes: xmlNotes.length };
}

// ---- ASCII piano roll (relative to lowest pitch) ----
function pianoRoll(label, notes, toSlots, maxSlots) {
  const cells = notes.map((n) => ({ midi: n.midi, ...toSlots(n) }));
  if (!cells.length) return `${label}: (empty)`;
  const lo = Math.min(...cells.map((c) => c.midi)); const hi = Math.max(...cells.map((c) => c.midi));
  const W = Math.min(maxSlots, 48);
  const rows = [];
  for (let m = hi; m >= lo; m -= 1) {
    let row = '';
    for (let s = 0; s < W; s += 1) row += cells.some((c) => c.midi === m && s >= c.onset && s < c.onset + Math.max(1, c.dur)) ? '█' : (s % DIV === 0 ? '·' : ' ');
    rows.push(`${String(m).padStart(3)} |${row}`);
  }
  return `${label}:\n${rows.join('\n')}`;
}

// ---- run over a stratified sample from the ledger ----
const ledger = fs.readFileSync(path.join(ROOT, '_workspace', '_ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byType = {};
for (const r of ledger) { (byType[r.type] ||= []).push(r); }
const sample = [];
for (const t of Object.keys(byType)) sample.push(byType[t][0]); // one per type
// add a long-name chord + a bassline + a hashed one
sample.push(byType['chord-progression'].sort((a, b) => (b.output?.length || 0) - (a.output?.length || 0))[0]);
if (byType.bassline) sample.push(byType.bassline[2]);

console.log('slot-exact = % of sounding 16th-slots where XML pitch set EXACTLY matches source');
console.log('slot-jac   = mean Jaccard overlap (tolerant of the chord shortest-member simplification)\n');
let first = true;
for (const r of sample) {
  const src = readMidi(path.join(LOOPS, r.source));
  const isPerc = r.type === 'groove' || r.type === 'percussion';
  const srcNotes = isPerc ? src.percussion : src.pitched;
  const xml = parseXml(fs.readFileSync(path.join(ROOT, r.output), 'utf8'));
  const c = compare(srcNotes, src.ppq, xml);
  console.log(`[${r.type}] ${r.output}`);
  console.log(`   src notes ${c.srcNotes} -> xml notes ${c.xmlNotes} | slots ${c.slots} | slot-exact ${(c.slotExact * 100).toFixed(0)}% | slot-jaccard ${(c.slotJaccard * 100).toFixed(0)}%`);
  if (first && src.pitched.length) {
    const toSlotSrc = (n) => ({ onset: Math.round(n.ticks / src.ppq * DIV), dur: Math.round((n.durationTicks || 0) / src.ppq * DIV) });
    console.log(pianoRoll('   SOURCE', src.pitched, toSlotSrc, 48));
    console.log(pianoRoll('   XML   ', xml, (n) => ({ onset: n.onset, dur: n.dur }), 48));
    first = false;
  }
  console.log('');
}

// ---- broad sweep: every Nth brick across the whole library ----
console.log('=== BROAD SWEEP (every 24th brick) ===');
const all = ledger.filter((r) => r.output);
const swept = all.filter((_, i) => i % 24 === 0);
let sum = 0; let n = 0; const bad = [];
for (const r of swept) {
  try {
    const src = readMidi(path.join(LOOPS, r.source));
    const isPerc = r.type === 'groove' || r.type === 'percussion';
    const sn = isPerc ? src.percussion : src.pitched;
    if (!sn.length) continue;
    const c = compare(sn, src.ppq, parseXml(fs.readFileSync(path.join(ROOT, r.output), 'utf8')));
    sum += c.slotExact; n += 1;
    if (c.slotExact < 0.99) bad.push(`${(c.slotExact * 100).toFixed(0)}% ${r.output.slice(0, 60)}`);
  } catch (e) { bad.push(`ERR ${r.output}: ${e.message}`); }
}
console.log(`checked ${n} bricks | mean slot-exact ${(sum / n * 100).toFixed(1)}% | below 99%: ${bad.length}`);
bad.slice(0, 12).forEach((b) => console.log('  ' + b));
