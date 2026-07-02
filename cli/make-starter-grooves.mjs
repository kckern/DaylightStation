#!/usr/bin/env node

/**
 * Starter groove generator — seeds the loop library's percussion side with a
 * small set of programmatically-built GM drum patterns (Producer overhaul,
 * Task 2.3). Generating instead of downloading guarantees clean provenance
 * (no pack licensing questions) and deterministic re-runs: no randomness,
 * every velocity and tick is spelled out below.
 *
 * Output: standard MIDI files, one track on CHANNEL 9 (GM percussion), header
 * tempo + time signature set, and the tempo repeated in the filename as
 * `_<bpm>BPM.mid` — the ingest's filename convention (loopMeta.extractBpm).
 * Files land in the RAW source tree (default `$DAYLIGHT_BASE_PATH/media/midi/
 * Starter_Grooves/`), i.e. upstream of `cli/midi-ingest.mjs`, which detects
 * them as type 'groove' via shared/music/percussion.isDrumTrack and routes
 * them under percussion/ in the canonical tree.
 *
 * KIT CONSTRAINT — patterns use ONLY the 9 GM_DRUM pieces the Producer ships
 * (kick 36, snare 38, hats 42/46, crash 49, ride 51, toms 45/47/50). The son
 * clave is therefore voiced on a quiet snare 38 rather than side stick 37:
 * pitch 37 has no fetched webaudiofont preset, and staying in-kit keeps every
 * groove renderable without touching presetManifest.
 *
 * FEEL CONTRACT — brush-swing places its skip notes exactly on the triplet
 * point (2·ppq/3) so midi-ingest's detectFeel labels it 'swing'; every other
 * pattern keeps offbeats on the straight 8th/16th grid → 'straight'. The 6/8
 * pattern's 8th-note hats sit on ppq/2 multiples, which detectFeel (a
 * quarter-grid analysis) reads as straight offbeats — correct label for it.
 *
 * Each written file is re-read and asserted (channel 9, tempo, time
 * signature, note count) before the run reports success.
 *
 * Usage:
 *   node cli/make-starter-grooves.mjs                # write to the source tree
 *   node cli/make-starter-grooves.mjs --out=/path    # write elsewhere
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import dotenv from 'dotenv';
import midiPkg from '@tonejs/midi';

import { GM_DRUM } from '../shared/music/percussion.mjs';

const { Midi } = midiPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const OUT = path.resolve(
  opt('out', path.join(process.env.DAYLIGHT_BASE_PATH || '', 'media/midi/Starter_Grooves')),
);

const PPQ = 480; // @tonejs/midi default; keep explicit for the tick math below
const Q = PPQ; // quarter
const E = PPQ / 2; // straight 8th
const S = PPQ / 4; // 16th
const SWUNG = Math.round((2 * PPQ) / 3); // triplet-point 8th (detectFeel's swung window center)

const { kick, snare, hatClosed, hatOpen, ride } = GM_DRUM;

/**
 * Note spec: [pitch, tick, velocity(1..127), durationTicks].
 * Helper: lay `hits` = [tick, velocity] pairs for one pitch.
 */
const lay = (pitch, hits, dur) => hits.map(([t, v]) => [pitch, t, v, dur]);

/** Repeat one bar's notes across `bars` bars of `barTicks` each. */
const repeatBars = (barNotes, bars, barTicks) => {
  const out = [];
  for (let b = 0; b < bars; b += 1) {
    for (const [p, t, v, d] of barNotes) out.push([p, t + b * barTicks, v, d]);
  }
  return out;
};

// ---- pattern definitions (all deterministic; velocities hand-voiced:
// backbeats accented, offbeat hats lighter, ghost/feathered hits quiet) ----

const PATTERNS = [
  {
    file: 'Rock_8ths_120BPM.mid',
    bpm: 120,
    timeSig: [4, 4],
    bars: 2,
    notes: () => {
      const bar = 4 * Q;
      const hats = lay(hatClosed, [0, E, Q, 3 * E, 2 * Q, 5 * E, 3 * Q, 7 * E]
        .map((t) => [t, t % Q === 0 ? 84 : 62]), 60);
      const snares = lay(snare, [[Q, 112], [3 * Q, 112]], 120);
      const bar1 = [...hats, ...snares, ...lay(kick, [[0, 105], [2 * Q, 100], [7 * E, 82]], 120)];
      const bar2 = [...hats, ...snares, ...lay(kick, [[0, 105], [2 * Q, 100], [5 * E, 86]], 120)];
      return [...bar1, ...bar2.map(([p, t, v, d]) => [p, t + bar, v, d])];
    },
  },
  {
    file: 'Pop_16ths_104BPM.mid',
    bpm: 104,
    timeSig: [4, 4],
    bars: 2,
    notes: () => {
      const bar = 4 * Q;
      // 16th hats with a per-beat velocity contour: strong / ghost / mid / ghost
      const contour = [96, 56, 72, 56];
      const hats = [];
      for (let beat = 0; beat < 4; beat += 1) {
        for (let s = 0; s < 4; s += 1) hats.push([hatClosed, beat * Q + s * S, contour[s], 50]);
      }
      const snares = lay(snare, [[Q, 108], [3 * Q, 108]], 120);
      const bar1 = [...hats, ...snares, ...lay(kick, [[0, 104], [3 * E, 86]], 120)];
      const bar2 = [...hats, ...snares,
        ...lay(kick, [[0, 104], [3 * E, 86], [2 * Q + 3 * S, 78]], 120)]; // 16th push into 4
      return [...bar1, ...bar2.map(([p, t, v, d]) => [p, t + bar, v, d])];
    },
  },
  {
    file: 'Waltz_140BPM.mid',
    bpm: 140,
    timeSig: [3, 4],
    bars: 2,
    notes: () => repeatBars([
      ...lay(kick, [[0, 100]], 140),
      ...lay(snare, [[Q, 55], [2 * Q, 48]], 100), // brush-ish: 2 + 3, lighter
      ...lay(ride, [[0, 74], [Q, 60], [2 * Q, 58]], 180),
    ], 2, 3 * Q),
  },
  {
    file: 'Latin_Clave_96BPM.mid',
    bpm: 96,
    timeSig: [4, 4],
    bars: 2,
    notes: () => {
      const bar = 4 * Q;
      // Son clave 3-2 voiced on quiet snare (side stick 37 is outside the
      // shipped 9-piece kit — see header comment). 3-side bar 1, 2-side bar 2.
      const clave = [
        ...lay(snare, [[0, 74], [3 * E, 72], [3 * Q, 74]], 100), // 1, 2&, 4
        ...lay(snare, [[bar + Q, 74], [bar + 2 * Q, 72]], 100), // 2, 3
      ];
      const hatBar = lay(hatClosed, [0, E, Q, 3 * E, 2 * Q, 5 * E, 3 * Q, 7 * E]
        .map((t) => [t, t % Q === 0 ? 72 : 55]), 60);
      const kickBar = lay(kick, [[3 * E, 80], [3 * Q, 92]], 120); // tumbao-ish: 2&, 4 (ponche)
      return [
        ...clave,
        ...repeatBars([...hatBar, ...kickBar], 2, bar),
        [kick, 0, 86, 120], // downbeat anchor, bar 1 only
      ];
    },
  },
  {
    file: 'Brush_Swing_110BPM.mid',
    bpm: 110,
    timeSig: [4, 4],
    bars: 2,
    notes: () => repeatBars([
      // Jazz ride: 1, 2, 2-let, 3, 4, 4-let — skip notes ON the triplet point
      ...lay(ride, [
        [0, 78], [Q, 88], [Q + SWUNG, 58], [2 * Q, 76], [3 * Q, 88], [3 * Q + SWUNG, 58],
      ], 160),
      ...lay(kick, [[0, 48], [2 * Q, 45]], 120), // feathered
      ...lay(snare, [[Q, 40], [3 * Q, 42]], 100), // soft brush backbeat
    ], 2, 4 * Q),
  },
  {
    file: 'Halftime_Backbeat_85BPM.mid',
    bpm: 85,
    timeSig: [4, 4],
    bars: 2,
    notes: () => {
      const bar = 4 * Q;
      const hats = lay(hatClosed, [0, E, Q, 3 * E, 2 * Q, 5 * E, 3 * Q, 7 * E]
        .map((t) => [t, t % Q === 0 ? 58 : 44]), 60); // quiet — leave room
      const base = [...hats, ...lay(snare, [[2 * Q, 115]], 160), ...lay(kick, [[0, 105]], 140)];
      const bar2 = [...base, [kick, 7 * E, 78, 120]]; // pickup into the next 1
      return [...base, ...bar2.map(([p, t, v, d]) => [p, t + bar, v, d])];
    },
  },
  {
    file: 'Four_On_Floor_118BPM.mid',
    bpm: 118,
    timeSig: [4, 4],
    bars: 2,
    notes: () => repeatBars([
      ...lay(kick, [[0, 108], [Q, 104], [2 * Q, 108], [3 * Q, 104]], 130),
      ...lay(hatOpen, [[E, 72], [3 * E, 70], [5 * E, 72], [7 * E, 70]], 110), // offbeats
      ...lay(snare, [[Q, 96], [3 * Q, 96]], 110),
    ], 2, 4 * Q),
  },
  {
    file: 'Six_Eight_72BPM.mid',
    bpm: 72,
    timeSig: [6, 8],
    bars: 2,
    notes: () => repeatBars([
      ...lay(hatClosed, [
        [0, 80], [E, 55], [2 * E, 60], [3 * E, 70], [4 * E, 55], [5 * E, 60],
      ], 60), // all six 8ths, accents on the two dotted-quarter pulses
      ...lay(kick, [[0, 100]], 140),
      ...lay(snare, [[3 * E, 105]], 130), // 4th eighth — the 6/8 backbeat
    ], 2, 6 * E), // 6/8 bar = six 8ths = 3·ppq ticks
  },
];

// ---- write + verify ----
mkdirSync(OUT, { recursive: true });
console.log(`Writing ${PATTERNS.length} starter grooves to ${OUT}\n`);

let failed = 0;
for (const pat of PATTERNS) {
  const midi = new Midi();
  midi.header.setTempo(pat.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: pat.timeSig });
  const track = midi.addTrack();
  track.channel = 9;
  const notes = pat.notes().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [pitch, ticks, vel, dur] of notes) {
    track.addNote({ midi: pitch, ticks, durationTicks: dur, velocity: vel / 127 });
  }
  const dest = path.join(OUT, pat.file);
  writeFileSync(dest, Buffer.from(midi.toArray()));

  // Re-read and assert what the ingest will see.
  const check = new Midi(readFileSync(dest));
  const ch = check.tracks.filter((t) => t.notes.length > 0).map((t) => t.channel);
  const bpm = Math.round(check.header.tempos[0]?.bpm || 0);
  const ts = check.header.timeSignatures[0]?.timeSignature || [4, 4];
  const count = check.tracks.reduce((n, t) => n + t.notes.length, 0);
  const ok = ch.every((c) => c === 9)
    && bpm === pat.bpm
    && ts[0] === pat.timeSig[0] && ts[1] === pat.timeSig[1]
    && count === notes.length;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${pat.file.padEnd(28)} ${String(pat.bpm).padStart(3)}bpm `
    + `${ts[0]}/${ts[1]}  ${pat.bars} bars  ${String(count).padStart(3)} notes  ch[${ch.join(',')}]`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed verification`);
  process.exit(1);
}
console.log('\nAll grooves verified (channel 9, tempo, time signature, note counts).');
console.log('Next: node cli/midi-ingest.mjs (dry-run), then --write to ingest.');
