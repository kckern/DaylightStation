#!/usr/bin/env node
// Render marker-aligned voice slots and spectrograms from a sweep timing file.
// Filenames intentionally contain only the sent Program Change and its 1-based
// display number. Audible instrument names are the result of analysis, not an
// input to slicing.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const timingPath = process.argv[2];
const outputRoot = process.argv[3];
if (!timingPath || !outputRoot) {
  console.error('usage: node cli/piano-voice-sweep-slice.cli.mjs <timing.json> <output-dir>');
  process.exit(1);
}

const timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
const clipsDir = path.join(outputRoot, 'clips');
const spectrogramsDir = path.join(outputRoot, 'spectrograms');
fs.mkdirSync(clipsDir, { recursive: true });
fs.mkdirSync(spectrogramsDir, { recursive: true });

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status}`);
}

const manifest = [];
for (let i = 0; i < timing.rows.length; i++) {
  const row = timing.rows[i];
  const blockRows = timing.rows.filter((candidate) => candidate.block === row.block);
  const position = blockRows.findIndex((candidate) => candidate.pc === row.pc);
  const left = position === 0
    ? timing.markers[row.block] + 1.45
    : (blockRows[position - 1].expected + row.expected) / 2;
  const right = position === blockRows.length - 1
    ? timing.markers[row.block + 1] - 0.65
    : (row.expected + blockRows[position + 1].expected) / 2;
  const duration = right - left;
  const stem = `pc-${String(row.pc).padStart(3, '0')}__display-${String(row.pc + 1).padStart(3, '0')}`;
  const wav = path.join(clipsDir, `${stem}.wav`);
  const png = path.join(spectrogramsDir, `${stem}.png`);

  runFfmpeg(['-ss', left.toFixed(4), '-t', duration.toFixed(4), '-i', timing.input,
    '-af', 'afade=t=in:d=0.01,afade=t=out:st=' + Math.max(0, duration - 0.02).toFixed(4) + ':d=0.02',
    '-c:a', 'pcm_s16le', wav]);
  runFfmpeg(['-i', wav, '-lavfi',
    'showspectrumpic=s=1200x500:legend=1:color=rainbow:scale=sqrt:fscale=log:win_func=hann', png]);
  manifest.push({ pc: row.pc, display: row.pc + 1, block: row.block, slotStart: left,
    slotEnd: right, duration, expectedNoteOnset: row.expected, detectedOnset: row.onset,
    onsetConfidence: row.onsetScore, wav, spectrogram: png });
}

fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${manifest.length} marker-aligned clips and spectrograms to ${outputRoot}`);
