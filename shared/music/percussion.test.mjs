import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GM_DRUM, metronomeEvents, isDrumTrack, detectFeel } from './percussion.mjs';

describe('GM_DRUM', () => {
  it('maps the nine producer drum pieces to their GM pitches', () => {
    assert.deepEqual(GM_DRUM, {
      kick: 36,
      snare: 38,
      hatClosed: 42,
      hatOpen: 46,
      crash: 49,
      ride: 51,
      tomLo: 45,
      tomMid: 47,
      tomHi: 50,
    });
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(GM_DRUM));
    assert.throws(() => {
      'use strict';
      GM_DRUM.kick = 35;
    }, TypeError);
  });
});

describe('metronomeEvents', () => {
  it('2 bars of 4/4 @120bpm → 8 hits at 500ms spacing, sorted, all channel 9', () => {
    const ev = metronomeEvents(2, { bpm: 120 });
    const ons = ev.filter((e) => e.type === 'note_on');
    assert.equal(ons.length, 8);
    assert.deepEqual(ons.map((e) => e.t), [0, 500, 1000, 1500, 2000, 2500, 3000, 3500]);
    assert.ok(ev.every((e) => e.channel === 9));
    const ts = ev.map((e) => e.t);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  });

  it('accents beat 1 of each bar (hits 0 and 4) at accentVelocity, others tickVelocity', () => {
    const ons = metronomeEvents(2, { bpm: 120 }).filter((e) => e.type === 'note_on');
    ons.forEach((e, i) => {
      assert.equal(e.velocity, i % 4 === 0 ? 110 : 70, `hit ${i}`);
    });
  });

  it('pairs every note_on with a note_off 30ms later on the same note', () => {
    const ev = metronomeEvents(1, { bpm: 120 });
    const ons = ev.filter((e) => e.type === 'note_on');
    const offs = ev.filter((e) => e.type === 'note_off');
    assert.equal(offs.length, ons.length);
    ons.forEach((on, i) => {
      assert.equal(offs[i].t, on.t + 30);
      assert.equal(offs[i].note, on.note);
      assert.equal(offs[i].velocity, 0);
    });
  });

  it('defaults both accent and tick to the closed hat', () => {
    const ons = metronomeEvents(1, { bpm: 120 }).filter((e) => e.type === 'note_on');
    assert.ok(ons.every((e) => e.note === GM_DRUM.hatClosed));
  });

  it('honors accentNote/tickNote and velocity overrides', () => {
    const ons = metronomeEvents(1, {
      bpm: 120,
      accentNote: GM_DRUM.kick,
      tickNote: GM_DRUM.ride,
      accentVelocity: 127,
      tickVelocity: 40,
    }).filter((e) => e.type === 'note_on');
    assert.equal(ons[0].note, GM_DRUM.kick);
    assert.equal(ons[0].velocity, 127);
    assert.ok(ons.slice(1).every((e) => e.note === GM_DRUM.ride && e.velocity === 40));
  });

  it('3/4 → 6 hits over 2 bars with accents on hits 0 and 3', () => {
    const ons = metronomeEvents(2, { bpm: 120, timeSig: [3, 4] }).filter((e) => e.type === 'note_on');
    assert.equal(ons.length, 6);
    assert.deepEqual(ons.map((e) => e.t), [0, 500, 1000, 1500, 2000, 2500]);
    ons.forEach((e, i) => {
      assert.equal(e.velocity, i % 3 === 0 ? 110 : 70, `hit ${i}`);
    });
  });

  it('scales beat duration by the denominator (6/8 @120bpm → 250ms per beat)', () => {
    const ons = metronomeEvents(1, { bpm: 120, timeSig: [6, 8] }).filter((e) => e.type === 'note_on');
    assert.equal(ons.length, 6);
    assert.equal(ons[1].t - ons[0].t, 250);
  });

  it('bars ≤ 0 → []', () => {
    assert.deepEqual(metronomeEvents(0, { bpm: 120 }), []);
    assert.deepEqual(metronomeEvents(-3, { bpm: 120 }), []);
  });

  it('throws TypeError on missing/invalid bpm', () => {
    assert.throws(() => metronomeEvents(2, {}), TypeError);
    assert.throws(() => metronomeEvents(2, { bpm: 0 }), TypeError);
    assert.throws(() => metronomeEvents(2, { bpm: NaN }), TypeError);
  });
});

describe('isDrumTrack', () => {
  it('channel 9 → true regardless of notes', () => {
    assert.equal(isDrumTrack({ channel: 9, notes: [] }), true);
    assert.equal(isDrumTrack({ channel: 9, notes: [60, 64, 67] }), true);
    assert.equal(isDrumTrack({ channel: 9 }), true);
  });

  it('kick/snare/hat pattern on channel 0 → true (100% GM_DRUM coverage)', () => {
    const notes = [36, 42, 38, 42, 36, 42, 38, 42];
    assert.equal(isDrumTrack({ channel: 0, notes }), true);
  });

  it('accepts note objects with a midi field (ingest shape)', () => {
    const notes = [{ midi: 36 }, { midi: 38 }, { midi: 42 }, { midi: 42 }];
    assert.equal(isDrumTrack({ channel: 2, notes }), true);
  });

  // Walking bass line E1..A1 region: pitches 36,38,40,41,43,45 — 36/38/45 ARE
  // GM_DRUM values (kick/snare/tomLo), but coverage is 3/6 = 50% < 60%, so the
  // ratio threshold correctly rejects it. This is exactly the documented
  // false-positive risk zone; the fixture proves the threshold handles it.
  it('walking bass on channel 1 → false (coverage 50% < 60%)', () => {
    const notes = [36, 38, 40, 41, 43, 45];
    assert.equal(isDrumTrack({ channel: 1, notes }), false);
  });

  it('melody far outside the percussion set → false', () => {
    assert.equal(isDrumTrack({ channel: 0, notes: [60, 62, 64, 65, 67] }), false);
  });

  it('empty notes + no channel → false', () => {
    assert.equal(isDrumTrack({ notes: [] }), false);
    assert.equal(isDrumTrack({}), false);
  });
});

describe('detectFeel', () => {
  it('quantized straight 8ths → straight', () => {
    // ppq 480: offbeats sit exactly on the straight 8th (240 within the quarter)
    assert.equal(detectFeel([0, 240, 480, 720, 960, 1200], 480), 'straight');
  });

  it('swung 8ths (offbeats at the triplet 2/3 point) → swing', () => {
    // ppq 480: 2/3 of a quarter = 320; offbeats at 320/800/1280
    assert.equal(detectFeel([0, 320, 480, 800, 960, 1280], 480), 'swing');
  });

  it('mixed feel below the 50% swung threshold → straight', () => {
    // offbeats: 240 (straight), 720+... one swung of three
    assert.equal(detectFeel([0, 240, 480, 720, 960, 1280], 480), 'straight');
  });

  it('quarter-notes only (no offbeat evidence) → straight', () => {
    assert.equal(detectFeel([0, 480, 960, 1440], 480), 'straight');
  });

  it('single onset → straight', () => {
    assert.equal(detectFeel([320], 480), 'straight');
    assert.equal(detectFeel([], 480), 'straight');
  });

  it('works at other resolutions (ppq 960)', () => {
    assert.equal(detectFeel([0, 640, 960, 1600, 1920, 2560], 960), 'swing');
    assert.equal(detectFeel([0, 480, 960, 1440, 1920, 2400], 960), 'straight');
  });

  it('throws TypeError on non-array onsets or invalid ppq', () => {
    assert.throws(() => detectFeel(null, 480), TypeError);
    assert.throws(() => detectFeel([0, 240], 0), TypeError);
    assert.throws(() => detectFeel([0, 240], NaN), TypeError);
  });
});
