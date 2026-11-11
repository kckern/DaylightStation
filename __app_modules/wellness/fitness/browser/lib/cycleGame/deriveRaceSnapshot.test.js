import { describe, it, expect } from 'vitest';
import { deriveRaceSnapshot } from "./deriveRaceSnapshot.js";

const rider = (over = {}) => ({
  cumulativeDistanceM: 0, lapSplits: [], isGhost: false, finishTimeS: null, ...over
});
const state = (riders, over = {}) => ({
  elapsedS: 10, winCondition: 'distance', goalM: 1000, timeCapS: 300,
  finished: false, riders, ...over
});

describe('deriveRaceSnapshot composition', () => {
  it('counts ghosts toward fieldSize; solo means one entity total', () => {
    const human = deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 0 }, null);
    expect(human.fieldSize).toBe(1);
    expect(human.isSolo).toBe(true);

    const withGhost = deriveRaceSnapshot(
      state({ a: rider(), g: rider({ isGhost: true }) }), { lapLengthM: 0 }, null);
    expect(withGhost.fieldSize).toBe(2);
    expect(withGhost.isSolo).toBe(false);
    expect(withGhost.ghostCount).toBe(1);
    expect(withGhost.humanCount).toBe(1);
  });

  it('lapsEnabled tracks config', () => {
    expect(deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 100 }, null).lapsEnabled).toBe(true);
    expect(deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 0 }, null).lapsEnabled).toBe(false);
  });
});

describe('deriveRaceSnapshot phase', () => {
  it('progresses PRE → EARLY → MID → FINALE → FINISHED with hysteresis', () => {
    const cfg = { lapLengthM: 0 };
    const at = (distM, prev, over = {}) =>
      deriveRaceSnapshot(state({ a: rider({ cumulativeDistanceM: distM }) }, over), cfg, prev);

    const pre = at(0, null, { elapsedS: 0 });
    expect(pre.phase).toBe('PRE');
    const early = at(50, pre); // 5% of 1000
    expect(early.phase).toBe('EARLY');
    const mid = at(500, early);
    expect(mid.phase).toBe('MID');
    const finale = at(900, mid); // 90%
    expect(finale.phase).toBe('FINALE');
    // hysteresis: dropping to 86% stays FINALE (exit band is < 80%)
    const stillFinale = at(860, finale);
    expect(stillFinale.phase).toBe('FINALE');
    const finished = at(1000, finale, { finished: true });
    expect(finished.phase).toBe('FINISHED');
  });
});

describe('deriveRaceSnapshot events', () => {
  it('fires LEAD_CHANGE on the edge only, once the new lead is clear and held', () => {
    const cfg = { lapLengthM: 0 };
    const at = (t, a, b) => state({ a: rider({ cumulativeDistanceM: a }), b: rider({ cumulativeDistanceM: b }) }, { elapsedS: t });
    const s1 = deriveRaceSnapshot(at(10, 100, 50), cfg, null);
    expect(s1.leaderId).toBe('a');
    // b overtakes a: raw leader flips at once, the announcement waits for the 3 s hold
    const s2 = deriveRaceSnapshot(at(11, 100, 200), cfg, s1);
    expect(s2.leaderId).toBe('b');
    expect(s2.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(false);
    const s3 = deriveRaceSnapshot(at(13, 110, 220), cfg, s2);
    expect(s3.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(false);
    const s4 = deriveRaceSnapshot(at(14, 120, 240), cfg, s3);
    expect(s4.events.filter((e) => e.type === 'LEAD_CHANGE')).toEqual([{ type: 'LEAD_CHANGE', riderIds: ['b'], firedAtClock: 14 }]);
    // no further change -> no event
    const s5 = deriveRaceSnapshot(at(15, 130, 260), cfg, s4);
    expect(s5.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(false);
  });

  it('fires RIDER_FINISHED when finishTimeS newly set', () => {
    const cfg = { lapLengthM: 0 };
    const s1 = deriveRaceSnapshot(state({ a: rider({ cumulativeDistanceM: 900 }) }), cfg, null);
    const s2 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 1000, finishTimeS: 42 }) }), cfg, s1);
    expect(s2.events.some((e) => e.type === 'RIDER_FINISHED' && e.riderIds.includes('a'))).toBe(true);
  });
});


describe('lead-change hysteresis', () => {
  const st = (elapsedS, a, b, c) => state({
    a: rider({ cumulativeDistanceM: a }), b: rider({ cumulativeDistanceM: b }),
    ...(c == null ? {} : { c: rider({ cumulativeDistanceM: c }) }),
  }, { elapsedS, winCondition: 'time', timeCapS: 300 });
  const run = (frames, cfg = {}) => {
    let prev = null; const fired = [];
    frames.forEach((f) => {
      prev = deriveRaceSnapshot(f, cfg, prev);
      prev.events.filter((e) => e.type === 'LEAD_CHANGE').forEach((e) => fired.push([f.elapsedS, e.riderIds[0]]));
    });
    return fired;
  };
  const last = (frames, cfg = {}) => frames.reduce((p, f) => deriveRaceSnapshot(f, cfg, p), null);

  it('ignores a lead that flips back and forth by a metre', () => {
    expect(run([st(1, 10, 9), st(2, 10, 11), st(3, 12, 11), st(4, 12, 13), st(5, 14, 13)])).toEqual([]);
  });
  it('announces once when the new leader is clear and has held it for 3 s', () => {
    expect(run([st(1, 10, 9), st(2, 10, 14), st(3, 11, 16), st(4, 12, 18), st(5, 13, 20), st(6, 14, 22)])).toEqual([[5, 'b']]);
  });
  it('waits at least 10 s between announcements', () => {
    const frames = [st(1, 10, 9)];
    for (let t = 2; t <= 6; t++) frames.push(st(t, 10, 10 + t * 2));
    for (let t = 7; t <= 12; t++) frames.push(st(t, 30 + t * 3, 22));
    expect(run(frames).map((f) => f[0])).toEqual([5]);
    frames.push(st(15, 100, 22), st(16, 104, 22));
    expect(run(frames).map((f) => f[0])).toEqual([5, 15]);
  });
  it('a challenger who drops below the margin before 3 s resets the hold clock', () => {
    const fired = run([st(1, 10, 9), st(2, 10, 14), st(3, 10, 15), st(4, 12, 13), st(5, 12, 17), st(6, 12, 18), st(7, 12, 19), st(8, 12, 20)]);
    expect(fired).toEqual([[8, 'b']]); // hold restarted at 5, not 2
  });
  it('restarts the hold when the challenger changes identity mid-hold', () => {
    // b clear at 2, then c overtakes b at 4 and is clear of everyone
    const frames = [st(1, 10, 9, 0), st(2, 10, 15, 0), st(3, 10, 16, 0), st(4, 10, 17, 25), st(5, 10, 17, 26), st(6, 10, 17, 27)];
    expect(run(frames)).toEqual([]);
    const snap = last(frames);
    expect(snap.challengerId).toBe('c');
    expect(snap.challengerSinceS).toBe(4);
    expect(run([...frames, st(7, 10, 17, 28)])).toEqual([[7, 'c']]);
  });
  it('never fires on the first snapshot (no previous)', () => {
    expect(run([st(50, 0, 100)])).toEqual([]);
    const s = deriveRaceSnapshot(st(50, 0, 100), {}, null);
    expect(s.announcedLeaderId).toBe('b');
    expect(s.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(false);
  });
  it('keeps the raw leaderId and exposes the new fields, all JSON-safe', () => {
    const s = last([st(1, 10, 9), st(2, 10, 14)]);
    expect(s.leaderId).toBe('b');
    expect(s.announcedLeaderId).toBe('a');
    expect(s.challengerId).toBe('b');
    expect(s.challengerSinceS).toBe(2);
    expect(s.lastLeadChangeS).toBeNull();
    const round = JSON.parse(JSON.stringify(s));
    ['announcedLeaderId', 'challengerId', 'challengerSinceS', 'lastLeadChangeS'].forEach((k) => {
      expect(round[k]).toEqual(s[k]);
    });
    const quiet = last([st(1, 10, 9)]);
    expect(quiet.challengerId).toBeNull();
    expect(quiet.challengerSinceS).toBeNull();
    expect(quiet.lastLeadChangeS).toBeNull();
    expect(JSON.stringify(quiet)).not.toMatch(/null.*undefined|undefined/);
  });
  it('an empty field serialises cleanly', () => {
    const s = deriveRaceSnapshot(state({}), {}, null);
    expect(s.announcedLeaderId).toBeNull();
    expect(s.challengerId).toBeNull();
  });

  describe('config.awayIds', () => {
    it('an away rider is never announced as leader, whether array or Set', () => {
      [['b'], new Set(['b'])].forEach((awayIds) => {
        const frames = [st(1, 10, 9), st(2, 10, 50), st(3, 11, 60), st(4, 12, 70), st(5, 13, 80), st(6, 14, 90)];
        expect(run(frames, { awayIds })).toEqual([]);
        const s = last(frames, { awayIds });
        expect(s.leaderId).toBe('b'); // raw unchanged
        expect(s.announcedLeaderId).toBe('a');
        expect(s.challengerId).toBeNull();
      });
    });
    it('the first announced leader skips an away rider', () => {
      const s = deriveRaceSnapshot(st(1, 10, 99), { awayIds: ['b'] }, null);
      expect(s.leaderId).toBe('b');
      expect(s.announcedLeaderId).toBe('a');
    });
    it('away riders do not count toward the clear-margin gap', () => {
      // c is away and sits just behind b; b is clear of a by 6 m
      const frames = [st(1, 10, 9, 0), st(2, 10, 16, 15), st(3, 10, 17, 16), st(4, 10, 18, 17), st(5, 10, 19, 18)];
      expect(run(frames, { awayIds: ['c'] })).toEqual([[5, 'b']]);
    });
    it('a rider returning from away can be announced once clear and held', () => {
      const frames = [st(1, 10, 9), st(2, 10, 50), st(3, 11, 60), st(4, 12, 70), st(5, 13, 80)];
      expect(run(frames, { awayIds: ['b'] })).toEqual([]);
      expect(run(frames, {})).toEqual([[5, 'b']]);
    });
  });
});
