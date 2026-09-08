#!/usr/bin/env node
// Segment the 2026-09 MDG-400 acoustic sweep from marker-bounded audio.
// The percussion markers reset alignment every ten voices; individual note
// onsets are selected from the waveform near their marker-derived expectation.

import fs from 'node:fs';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error('usage: node cli/piano-voice-sweep-analyze.cli.mjs <source.wav> <timing.json>');
  process.exit(1);
}

const wav = fs.readFileSync(input);
const channels = wav.readUInt16LE(22);
const rate = wav.readUInt32LE(24);
const bits = wav.readUInt16LE(34);
if (channels !== 1 || bits !== 16) throw new Error('expected mono 16-bit PCM WAV');

const dataOffset = 44;
const samples = (wav.length - dataOffset) / 2;
const hopSamples = Math.round(rate * 0.01);
const rms = [];
for (let offset = 0; offset + hopSamples < samples; offset += hopSamples) {
  let sum = 0;
  for (let i = 0; i < hopSamples; i++) {
    const value = wav.readInt16LE(dataOffset + (offset + i) * 2) / 32768;
    sum += value * value;
  }
  rms.push(Math.sqrt(sum / hopSamples));
}

const mean = (from, to) => {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, from); i < Math.min(rms.length, to); i++) {
    sum += rms[i];
    count++;
  }
  return sum / Math.max(1, count);
};

// These are acoustic onsets of the repeated five-hit marker, measured from the
// source recording. Their near-24-second periodicity and the 10/10/.../8 event
// counts independently identify them; they are not inferred from voice names.
const markers = [
  36.7535, 60.4875, 84.0786, 107.923, 131.783, 155.315, 179.614,
  203.950, 227.727, 251.733, 275.900, 299.913, 323.973, 339.000,
];

function onsetScore(frame) {
  const before = mean(frame - 18, frame - 4);
  const after = mean(frame, frame + 14);
  return Math.max(0, after - before) * Math.sqrt(after + 0.001);
}

const rows = [];
let pc = 0;
for (let block = 0; block < markers.length - 1; block++) {
  const count = block === 12 ? 8 : 10;
  const left = markers[block];
  const right = markers[block + 1];
  const firstExpected = left + 2.03;
  const lastExpected = right - 2.05;
  const spacing = count === 1 ? 0 : (lastExpected - firstExpected) / (count - 1);
  for (let index = 0; index < count; index++, pc++) {
    const expected = firstExpected + index * spacing;
    const low = Math.floor((expected - 0.62) * 100);
    const high = Math.ceil((expected + 0.62) * 100);
    let bestFrame = low;
    let bestScore = -1;
    for (let frame = low; frame <= high; frame++) {
      const score = onsetScore(frame);
      if (score > bestScore) {
        bestScore = score;
        bestFrame = frame;
      }
    }
    rows.push({ pc, block, index, expected, onset: bestFrame / 100, onsetScore: bestScore });
  }
}

if (rows.length !== 128) throw new Error(`expected 128 voice rows, found ${rows.length}`);

// Silence-aware ends. Search after the test note for the earliest sustained
// return to the local pre-onset noise floor, bounded by the next acoustic event.
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const nextBoundary = row.index === (row.block === 12 ? 7 : 9)
    ? markers[row.block + 1]
    : rows[i + 1].onset;
  const baseline = mean(Math.round((row.onset - 0.5) * 100), Math.round((row.onset - 0.15) * 100));
  const threshold = Math.max(0.011, baseline * 1.55);
  const searchStart = Math.round((row.onset + 0.35) * 100);
  const searchEnd = Math.round((nextBoundary - 0.12) * 100);
  let quietAt = null;
  for (let frame = searchStart; frame + 20 < searchEnd; frame++) {
    if (mean(frame, frame + 20) <= threshold) {
      quietAt = frame / 100;
      break;
    }
  }
  row.start = Math.max(markers[row.block] + 0.05, row.onset - 0.08);
  row.end = Math.min(nextBoundary - 0.10, (quietAt ?? (nextBoundary - 0.18)) + 0.10);
  if (row.end <= row.start + 0.25) row.end = Math.min(nextBoundary - 0.10, row.start + 0.75);
  row.duration = row.end - row.start;
  row.baseline = baseline;
  row.silenceThreshold = threshold;
}

fs.writeFileSync(output, `${JSON.stringify({ input, markers, rows }, null, 2)}\n`);
console.log(JSON.stringify({ voices: rows.length, first: rows[0], last: rows.at(-1) }, null, 2));
