import { describe, it, expect } from 'vitest';
import {
  PRESENCE_LADDER_DEFAULTS, PRESENCE_RUNGS, TOP_RUNG, ladderConfig, classifyInterval, nextRung,
  intervalSecondsFor, checkInStepFor, checkInDrillFor, rungCostNotes, replayLadder,
} from './presenceLadder.mjs';

describe('presence ladder rules', () => {
  it('exports frozen defaults and five rungs', () => {
    expect(PRESENCE_LADDER_DEFAULTS).toEqual({
      practiceNpm: PRESENCE_LADDER_DEFAULTS.practiceNpm, partialNotes: 8, intervalsSeconds: [90, 90, 75, 60],
      keepaliveDeadline: true, keepaliveFactor: 2, notifyTopRung: false,
    });
    expect(Object.isFrozen(PRESENCE_LADDER_DEFAULTS)).toBe(true);
    expect(PRESENCE_RUNGS.map((r) => r.rung)).toEqual([0, 1, 2, 3, 4]);
    expect(PRESENCE_RUNGS[4]).toEqual({ rung: 4, kind: 'scales', count: 2, hands: ['RL', 'RL'] });
    expect(TOP_RUNG).toBe(4);
  });

  it('climbs 0→1→2→3→4 on none and stays at 4', () => {
    const cfg = ladderConfig();
    let r = 0; const seen = [];
    for (let i = 0; i < 6; i++) { r = nextRung(r, 'none', cfg); seen.push(r); }
    expect(seen).toEqual([1, 2, 3, 4, 4, 4]);
  });

  it('practice resets to 0; partial steps down one; hold keeps', () => {
    const cfg = ladderConfig();
    expect(nextRung(4, 'practice', cfg)).toBe(0);
    expect(nextRung(4, 'partial', cfg)).toBe(3);
    expect(nextRung(0, 'partial', cfg)).toBe(0);
    expect(nextRung(2, 'hold', cfg)).toBe(2);
  });

  it('classifyInterval: rate over the whole interval, not a raw count (RF1)', () => {
    const cfg = ladderConfig({ practice_npm: 4 });
    expect(classifyInterval({ legitNotes: 40, verdict: 'legit', intervalMs: 270000 }, cfg)).toBe('practice');
    expect(classifyInterval({ legitNotes: 9, verdict: 'legit', intervalMs: 400000 }, cfg)).toBe('partial');
    expect(classifyInterval({ legitNotes: 7, verdict: 'legit', intervalMs: 60000 }, cfg)).toBe('none');
    expect(classifyInterval({ legitNotes: 30, verdict: 'spam', intervalMs: 60000 }, cfg)).toBe('none');
    expect(classifyInterval({ legitNotes: 30, verdict: 'ambiguous', intervalMs: 60000, judge: { status: 'pending' } }, cfg)).toBe('hold');
    expect(classifyInterval({ legitNotes: 30, verdict: 'ambiguous', intervalMs: 60000, judge: { status: 'answered', legit: false } }, cfg)).toBe('none');
    expect(classifyInterval({ legitNotes: 30, verdict: 'ambiguous', intervalMs: 60000, judge: { status: 'answered', legit: null } }, cfg)).toBe('practice');
  });

  it('intervals: 90,90,75,60,60; capped at the base timeout', () => {
    const cfg = ladderConfig();
    expect([0, 1, 2, 3, 4].map((r) => intervalSecondsFor(r, cfg))).toEqual([90, 90, 75, 60, 60]);
    expect(intervalSecondsFor(0, ladderConfig({}, { baseTimeoutSeconds: 70 }))).toBe(70);
  });

  it('malformed config falls back to defaults (RF5)', () => {
    const cfg = ladderConfig({ intervals_seconds: [], practice_npm: 'x', partial_notes: -1 });
    expect(cfg.intervalsSeconds).toEqual([90, 90, 75, 60]);
    expect(cfg.practiceNpm).toBe(PRESENCE_LADDER_DEFAULTS.practiceNpm);
    expect(cfg.partialNotes).toBe(8);
    const odd = ladderConfig({ intervals_seconds: [60, 'x', -5], keepalive_deadline: 'yes', keepalive_factor: 0, notify_top_rung: 1 });
    expect(odd.intervalsSeconds).toEqual([90, 90, 75, 60]);
    expect(odd.keepaliveDeadline).toBe(true);
    expect(odd.keepaliveFactor).toBe(2);
    expect(odd.notifyTopRung).toBe(false);
    expect(ladderConfig(null).topRung).toBe(4);
    expect(Number.isFinite(intervalSecondsFor(2, ladderConfig({ intervals_seconds: 'abc' })))).toBe(true);
  });

  it('preschool is exempt: topRung 0, constant interval, no deadline', () => {
    const cfg = ladderConfig({}, { preschool: true });
    expect(nextRung(0, 'none', cfg)).toBe(0);
    expect(checkInStepFor(3, {}, cfg)).toEqual({ kind: 'note', rung: 0 });
    expect(cfg.keepaliveDeadline).toBe(false);
    expect(cfg.intervalsSeconds).toEqual([90]);
  });

  it('rung steps and drills: rung 3 is one RL scale up-then-down; rung 4 two RL scales, second in the next key', () => {
    const cfg = ladderConfig();
    expect(checkInStepFor(3, { scaleIndex: 2 }, cfg)).toEqual({ kind: 'scales', rung: 3, count: 1, hands: ['RL'], scaleIndex: 2 });
    const d4 = checkInDrillFor(checkInStepFor(4, {}, cfg), { roots: ['C', 'G', 'F'] });
    expect(d4).toMatchObject({ sets: 2, reps: 1, hands: ['RL', 'RL'], direction: 'up-then-down' });
    expect(d4.roots.slice(0, 2)).toEqual(['C', 'G']);
    const d2 = checkInDrillFor(checkInStepFor(2, {}, cfg), { roots: ['C', 'G', 'F'], rotation: 1 });
    expect(d2).toMatchObject({ sets: 2, hands: ['R', 'L'] });
    expect(d2.roots[0]).toBe('G');
  });

  it('a single lesson root still gives the second set the next key (a fifth up)', () => {
    const d4 = checkInDrillFor(checkInStepFor(4, {}, ladderConfig()), { roots: ['G'] });
    expect(d4.roots.slice(0, 2)).toEqual(['G', 'D']);
    const d1 = checkInDrillFor(checkInStepFor(1, {}, ladderConfig()), { roots: ['A#'] });
    expect(d1.roots[0]).toBe('A#');
  });

  it('each rung costs at least as much to clear as the one below (more where the key count grows), and rung 1 costs more than practice evidence at the shortest interval', () => {
    const cfg = ladderConfig();
    const costs = [0, 1, 2, 3, 4].map(rungCostNotes);
    expect(costs).toEqual([1, 15, 30, 30, 60]);
    for (let r = 1; r < costs.length; r++) expect(costs[r]).toBeGreaterThanOrEqual(costs[r - 1]);
    expect(costs[4]).toBeGreaterThan(costs[3]);
    expect(costs[2]).toBeGreaterThan(costs[1]);
    const evidence = Math.max(cfg.partialNotes, Math.ceil(cfg.practiceNpm * Math.min(...cfg.intervalsSeconds) / 60));
    expect(costs[1]).toBeGreaterThan(evidence);
  });

  it('replayLadder: an absentee climbs to the top; minimal marks every check-in after the first', () => {
    const log = replayLadder([], 900, ladderConfig());
    // The wait after a check-in is the interval of the rung just asked: 90, 90, 75, 60, 60…
    expect(log.map((c) => c.atMs / 1000)).toEqual([90, 180, 270, 345, 405, 465, 525, 585, 645, 705, 765, 825, 885]);
    expect(log.map((c) => c.rung)).toEqual([0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(log[0].minimal).toBe(false);
    expect(log.slice(1).every((c) => c.minimal)).toBe(true);
    expect(log.every((c) => c.answered === true)).toBe(true);
    expect(log.map((c) => c.scales).slice(0, 5)).toEqual([0, 1, 2, 1, 2]);
  });

  it('replayLadder: one stray note every 80 s still gets check-ins via the deadline (R5)', () => {
    // First stray note at 100 s, so the 90 s check-in exists and has been answered.
    const evs = Array.from({ length: 12 }, (_, i) => ({ t: 100000 + 80000 * i, note: 60, velocity: 64 }));
    const log = replayLadder(evs, 1000, ladderConfig());
    expect(log.length).toBeGreaterThanOrEqual(3);
    expect(log[1].atMs).toBe(270000); // answer at 90 s + 2 × 90 s
    expect(log[1].rung).toBe(1);
    expect(log[1].minimal).toBe(true);
  });

  it('replayLadder: without the deadline the stray notes dodge every check-in after the first', () => {
    const evs = Array.from({ length: 12 }, (_, i) => ({ t: 100000 + 80000 * i, note: 60, velocity: 64 }));
    const log = replayLadder(evs, 1000, ladderConfig({ keepalive_deadline: false }));
    expect(log.length).toBe(1);
  });

  it('replayLadder: steady playing between check-ins keeps the ladder on the note', () => {
    // A scale-ish phrase every 2 s for 15 minutes, with a 100 s pause every 4 minutes.
    const evs = [];
    for (let t = 0; t < 900; t += 2) {
      if (t % 240 >= 140) continue;
      evs.push({ t: t * 1000, note: 60 + ((t / 2) % 8), velocity: 60 + (t % 7) });
    }
    const log = replayLadder(evs, 900, ladderConfig());
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((c) => c.rung === 0)).toBe(true);
    expect(log.some((c) => c.minimal)).toBe(false);
  });

  it('replayLadder: preschool stays on the note with a constant interval and no deadline', () => {
    const cfg = ladderConfig({}, { preschool: true });
    const log = replayLadder([], 900, cfg, { preschool: true });
    expect(log.every((c) => c.rung === 0)).toBe(true);
    expect(log.map((c) => c.atMs / 1000).slice(0, 3)).toEqual([90, 180, 270]);
    expect(log.slice(1).every((c) => c.minimal)).toBe(true);
  });
});
