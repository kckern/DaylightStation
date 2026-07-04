// PROTOTYPE (scratch): measure the SHIPPED analyzer's harmony accuracy at scale.
// For every chord/bassline brick, compare the derived root motion (from notes, in C)
// against the vendor's own chord labels — transposition-invariantly (interval shape),
// since the vendor chords are in the original key. Reports real accuracy + flags the
// disagreements for review.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { readMidi, analyzeHarmony } from './midi-to-musicxml.mjs';
import { parseChordSymbol } from '../shared/music/chords.mjs';
import { minimalCycle, normalizeProgression } from '../shared/music/harmonicSignature.mjs';

const ROOT = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/midi';
const LOOPS = path.join(ROOT, '_workspace', 'loops-midi');
const index = yaml.load(fs.readFileSync(path.join(LOOPS, 'index.yml'), 'utf8'));

function rootsOf(chords) {
  return (chords || []).map((c) => (typeof c === 'string' ? parseChordSymbol(c)?.root : c?.root)).filter((r) => r != null);
}
// transposition-invariant cyclic interval sequence of a root progression
function ivalSig(roots) {
  const rs = minimalCycle(normalizeProgression(roots.map(String))).map(Number);
  if (rs.length < 2) return rs.length === 1 ? '0' : '';
  return rs.map((r, i) => ((rs[(i + 1) % rs.length] - r) % 12 + 12) % 12).join('-');
}
// is `needle` a contiguous cyclic substring of `hay` (same harmony, boundary-only miss)
function cyclicContains(hay, needle) {
  if (!hay || !needle) return false;
  const h = hay.split('-'); const n = needle.split('-');
  if (n.length > h.length) return false;
  const d = [...h, ...h];
  for (let i = 0; i < h.length; i += 1) if (n.every((x, j) => d[i + j] === x)) return true;
  return false;
}

const results = { 'chord-progression': [], bassline: [] };
for (const e of index) {
  if (e.type !== 'chord-progression' && e.type !== 'bassline') continue;
  const refRoots = rootsOf(e.chords);
  if (refRoots.length < 2) continue; // no usable vendor label
  let mine;
  try {
    const m = readMidi(path.join(LOOPS, e.path));
    const notes = e.type === 'bassline' ? m.pitched : m.pitched;
    const { runs } = analyzeHarmony(notes, m.ppq, m.beats, m.beatType, e.type === 'bassline');
    mine = runs.map((r) => r.root);
  } catch { continue; }
  const refIval = ivalSig(refRoots);
  const myIval = ivalSig(mine);
  const exact = !!refIval && refIval === myIval;
  const ok = exact || cyclicContains(myIval, refIval) || cyclicContains(refIval, myIval);
  results[e.type].push({ slug: e.slug, exact, ok, refIval, myIval, refLen: minimalCycle(normalizeProgression(refRoots.map(String))).length });
}

for (const t of ['chord-progression', 'bassline']) {
  const R = results[t]; if (!R.length) continue;
  const ex = R.filter((r) => r.exact).length;
  const ok = R.filter((r) => r.ok).length;
  console.log(`\n=== ${t} (n=${R.length} with vendor chord labels) ===`);
  console.log(`  exact interval-shape match : ${ex} (${(ex / R.length * 100).toFixed(1)}%)`);
  console.log(`  harmony-correct (incl. boundary-only) : ${ok} (${(ok / R.length * 100).toFixed(1)}%)`);
  // where do disagreements cluster? by reference progression length
  const byLen = {};
  for (const r of R) { const k = r.refLen; byLen[k] ||= { n: 0, ok: 0 }; byLen[k].n += 1; if (r.ok) byLen[k].ok += 1; }
  console.log('  accuracy by vendor progression length (chords):');
  for (const k of Object.keys(byLen).sort((a, b) => a - b).slice(0, 10)) {
    const b = byLen[k]; console.log(`    ${k}-chord: ${(b.ok / b.n * 100).toFixed(0)}% of ${b.n}`);
  }
  console.log('  sample disagreements:');
  R.filter((r) => !r.ok).slice(0, 5).forEach((r) => console.log(`    ${r.slug.slice(0, 42).padEnd(42)} vendor[${r.refIval}] mine[${r.myIval}]`));
}
