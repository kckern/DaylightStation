#!/usr/bin/env node

// Generates the percussion (groove) MIDI fixtures used by the midi-ingest CLI
// smoke tests. Deterministic: re-running overwrites the same two files.
//
//   groove-straight.mid — 1 bar @ 120bpm, channel 9: kick 36 on beats 1+3,
//                         snare 38 on beats 2+4, closed hat 42 on straight 8ths
//   groove-swing.mid    — same kit, but the hat offbeats sit at the swung
//                         2/3-of-a-quarter positions (triplet point)
//
// Usage: node tests/_fixtures/midi/make-groove-fixture.mjs

import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import midiPkg from '@tonejs/midi';

const { Midi } = midiPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PPQ = 480; // @tonejs/midi default
const BAR = PPQ * 4;
const HIT = 60; // note length in ticks (drum hits are short)

/** Build a 1-bar channel-9 drum file. `hatTicks` = hat onset positions. */
function buildGroove(hatTicks) {
  const midi = new Midi();
  midi.header.setTempo(120);
  const tr = midi.addTrack();
  tr.channel = 9;
  const add = (pitch, ticks, velocity = 0.9) =>
    tr.addNote({ midi: pitch, ticks, durationTicks: HIT, velocity });

  add(36, 0);           // kick, beat 1
  add(36, PPQ * 2);     // kick, beat 3
  add(38, PPQ);         // snare, beat 2
  add(38, PPQ * 3);     // snare, beat 4
  for (const t of hatTicks) add(42, t, 0.7); // closed hats
  return Buffer.from(midi.toArray());
}

// Straight 8ths: every half-quarter across the bar.
const straightHats = Array.from({ length: 8 }, (_, i) => (i * PPQ) / 2);

// Swung 8ths: on-beats plus offbeats displaced to 2/3 of the quarter.
const swingHats = [0, 1, 2, 3].flatMap((beat) => [
  beat * PPQ,
  beat * PPQ + Math.round((2 * PPQ) / 3),
]);

for (const [name, hats] of [
  ['groove-straight.mid', straightHats],
  ['groove-swing.mid', swingHats],
]) {
  const out = path.join(__dirname, name);
  writeFileSync(out, buildGroove(hats));
  console.log(`wrote ${out} (${hats.length} hats, ${BAR} ticks/bar)`);
}
