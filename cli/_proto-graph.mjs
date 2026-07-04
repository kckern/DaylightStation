// PROTOTYPE (scratch): is the compatibility-matching graph actually useful?
// Cluster all harmonic bricks by (a) tonic-sensitive roman signature vs (b)
// transposition-invariant interval shape, and report cluster-size distribution —
// a good matcher yields many mid-sized clusters, not one mega-blob or all singletons.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { readMidi, analyzeHarmony } from './midi-to-musicxml.mjs';
import { romanAnalysis, bestTonic } from '../shared/music/romanAnalysis.mjs';
import { signatureKey, minimalCycle, normalizeProgression } from '../shared/music/harmonicSignature.mjs';

const LOOPS = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/midi/_workspace/loops-midi';
const idx = yaml.load(fs.readFileSync(path.join(LOOPS, 'index.yml'), 'utf8'));

function ivalSig(roots) {
  const rs = minimalCycle(normalizeProgression((roots || []).map(String))).map(Number);
  if (rs.length < 2) return rs.length === 1 ? 'single' : '';
  return rs.map((r, i) => ((rs[(i + 1) % rs.length] - r) % 12 + 12) % 12).join('-');
}

// absolute root cycle in C: the musically-correct layering key (both loops play in C)
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function absSig(runs) {
  const roots = minimalCycle(normalizeProgression(runs.map((r) => String(r.root)))).map(Number);
  return roots.length ? roots.map((r) => NAMES[r]).join('-') : 'none';
}

const romanSig = []; const ival = []; const abs = [];
for (const e of idx) {
  if (!['chord-progression', 'idea', 'bassline'].includes(e.type)) continue;
  try {
    const m = readMidi(path.join(LOOPS, e.path));
    const { runs } = analyzeHarmony(m.pitched, m.ppq, m.beats, m.beatType, e.type === 'bassline');
    if (!runs.length) continue;
    romanSig.push(signatureKey(romanAnalysis(runs, bestTonic(runs))) || 'none');
    ival.push(ivalSig(runs.map((r) => r.root)) || 'none');
    abs.push(absSig(runs));
  } catch { /* skip */ }
}

function report(label, sigs) {
  const clusters = {};
  for (const s of sigs) clusters[s] = (clusters[s] || 0) + 1;
  const sizes = Object.values(clusters).sort((a, b) => b - a);
  const singletons = sizes.filter((x) => x === 1).length;
  const n = sigs.length;
  console.log(`\n=== ${label} (n=${n} bricks) ===`);
  console.log(`  distinct signatures: ${sizes.length}`);
  console.log(`  singletons (match nothing): ${singletons} (${(singletons / sizes.length * 100).toFixed(0)}% of clusters)`);
  console.log(`  largest cluster: ${sizes[0]} bricks (${(sizes[0] / n * 100).toFixed(1)}% of all)`);
  console.log(`  top-10 clusters cover: ${sizes.slice(0, 10).reduce((a, b) => a + b, 0)} bricks (${(sizes.slice(0, 10).reduce((a, b) => a + b, 0) / n * 100).toFixed(0)}%)`);
  console.log(`  median non-singleton cluster: ${sizes.filter((x) => x > 1)[Math.floor(sizes.filter((x) => x > 1).length / 2)]}`);
  // top signatures
  const top = Object.entries(clusters).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('  biggest signature clusters:');
  for (const [s, c] of top) console.log(`    ${String(c).padStart(4)}  [${s}]`);
}

report('ROMAN signature (tonic-sensitive)', romanSig);
report('INTERVAL shape (transposition-invariant)', ival);
report('ABSOLUTE root cycle in C (correct layering key)', abs);

// what does a typical brick's match-set look like under each?
const pick = (sigs) => { const c = {}; for (const s of sigs) c[s] = (c[s] || 0) + 1; return sigs.map((s) => c[s] - 1); };
const rmatch = pick(romanSig); const imatch = pick(ival);
const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0);
console.log(`\nmean # of same-signature partners per brick: roman ${mean(rmatch)}, interval ${mean(imatch)}`);
