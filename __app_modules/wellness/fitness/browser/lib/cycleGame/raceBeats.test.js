import { describe, it, expect } from 'vitest';
import { raceBeats } from './raceBeats.js';

const time = (elapsedS, timeCapS = 300) => ({ winCondition: 'time', timeCapS, elapsedS, leaderM: elapsedS * 4 });
const dist = (leaderM) => ({ winCondition: 'distance', goalM: 1000, elapsedS: leaderM / 4, leaderM });

describe('raceBeats', () => {
  it('fires halfway once', () => {
    let r = raceBeats(time(149), null); expect(r.beats).toEqual([]);
    r = raceBeats(time(150), r.state); expect(r.beats).toEqual(['HALFWAY']);
    r = raceBeats(time(151), r.state); expect(r.beats).toEqual([]);
  });
  it('fires last minute in a time race of three minutes or more', () => {
    let r = raceBeats(time(239), { halfway: true }); expect(r.beats).toEqual([]);
    r = raceBeats(time(240), r.state); expect(r.beats).toEqual(['LAST_MINUTE']);
  });
  it('no last-minute beat in a short time race', () => {
    const r = raceBeats({ winCondition: 'time', timeCapS: 60, elapsedS: 5, leaderM: 20 }, { halfway: true });
    expect(r.beats).toEqual([]);
  });
  it('fires a final ten-second countdown beat each second', () => {
    const r = raceBeats(time(291), { halfway: true, lastMinute: true });
    expect(r.beats).toEqual(['FINAL_SECONDS']);
    expect(r.secondsLeft).toBe(9);
  });
  it('distance race: halfway by distance, last stretch at 90%', () => {
    let r = raceBeats(dist(500), null); expect(r.beats).toEqual(['HALFWAY']);
    r = raceBeats(dist(900), r.state); expect(r.beats).toEqual(['LAST_STRETCH']);
  });
  it('fires a split each whole minute with nothing else pending', () => {
    const r = raceBeats(time(60), null);
    expect(r.beats).toEqual(['SPLIT']);
  });

  it('calling twice with the same elapsed time fires nothing new', () => {
    [time(150), time(60), time(240), time(295), dist(500), dist(900)].forEach((input) => {
      const a = raceBeats(input, null);
      const b = raceBeats(input, a.state);
      // FINAL_SECONDS is a per-second beat, not an edge: it may repeat for the same second.
      expect(b.beats.filter((x) => x !== 'FINAL_SECONDS')).toEqual([]);
    });
  });
  it('a short time race fires no FINAL_SECONDS before the race starts, but does in its last 10 s', () => {
    const short = (elapsedS) => ({ winCondition: 'time', timeCapS: 15, elapsedS, leaderM: 0 });
    expect(raceBeats(short(0), null).beats).not.toContain('FINAL_SECONDS');
    expect(raceBeats(short(4), null).beats).not.toContain('FINAL_SECONDS');
    expect(raceBeats(short(6), null).beats).toContain('FINAL_SECONDS');
    expect(raceBeats(short(14), null).beats).toContain('FINAL_SECONDS');
    const tiny = (elapsedS) => ({ winCondition: 'time', timeCapS: 8, elapsedS, leaderM: 0 });
    expect(raceBeats(tiny(0), null).beats).toEqual([]);
    expect(raceBeats(tiny(1), null).beats).toContain('FINAL_SECONDS');
  });
  it('SPLIT is not fired in the same call as HALFWAY, and that minute is skipped for good', () => {
    // 120 s of a 240 s race: halfway and the 2:00 split coincide
    let r = raceBeats({ winCondition: 'time', timeCapS: 240, elapsedS: 120, leaderM: 400 }, null);
    expect(r.beats).toEqual(['HALFWAY']);
    r = raceBeats({ winCondition: 'time', timeCapS: 240, elapsedS: 121, leaderM: 404 }, r.state);
    expect(r.beats).toEqual([]);
    expect(r.state.splitAtS).toBe(120);
  });
  it('SPLIT is not fired with LAST_MINUTE, and is not fired a second later', () => {
    let r = raceBeats(time(240), { halfway: true });
    expect(r.beats).toEqual(['LAST_MINUTE']);
    r = raceBeats(time(241), r.state);
    expect(r.beats).toEqual([]);
  });
  it('SPLIT is not fired with LAST_STRETCH', () => {
    // distance race whose 90% moment lands on a whole minute
    let r = raceBeats({ winCondition: 'distance', goalM: 1000, elapsedS: 120, leaderM: 900 }, { halfway: true });
    expect(r.beats).toEqual(['LAST_STRETCH']);
    r = raceBeats({ winCondition: 'distance', goalM: 1000, elapsedS: 121, leaderM: 910 }, r.state);
    expect(r.beats).toEqual([]);
  });
  it('a distance race with goalM 0 or missing fires nothing and does not throw', () => {
    expect(() => raceBeats({ winCondition: 'distance', goalM: 0, elapsedS: 5, leaderM: 100 }, null)).not.toThrow();
    expect(raceBeats({ winCondition: 'distance', goalM: 0, elapsedS: 5, leaderM: 100 }, null).beats).toEqual([]);
    expect(raceBeats({ winCondition: 'distance', elapsedS: 5, leaderM: 100 }, null).beats).toEqual([]);
    expect(raceBeats({ winCondition: 'distance', elapsedS: 5, leaderM: 100 }, null).secondsLeft).toBeNull();
  });
  it('returns a new state object and does not mutate prev', () => {
    const prev = Object.freeze({ halfway: false, lastMinute: false, lastStretch: false, splitAtS: 0 });
    const r = raceBeats(time(150), prev);
    expect(r.state).not.toBe(prev);
    expect(prev.halfway).toBe(false);
    expect(r.state.halfway).toBe(true);
  });
  it('tolerates NaN and missing input', () => {
    expect(() => raceBeats({ winCondition: 'time', timeCapS: NaN, elapsedS: NaN, leaderM: NaN }, null)).not.toThrow();
    expect(raceBeats({ winCondition: 'time', timeCapS: NaN, elapsedS: NaN }, null).beats).toEqual([]);
    expect(() => raceBeats(undefined, null)).not.toThrow();
  });
});
