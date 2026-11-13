import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn(), error: vi.fn() };
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }) }));
vi.mock('./useLessonPractice.js', () => ({ CHECK_IN_GRACE_MS: 3000 }));

import { useEngagementGate } from './useEngagementGate.js';
import { ladderConfig } from '../../../../portable/practice/presenceLadder.mjs';

beforeEach(() => { vi.useFakeTimers(); Object.values(log).forEach((f) => f.mockReset()); });
afterEach(() => { vi.useRealTimers(); });

const stats = { notes: 0, distinctPitches: 0, pitchSpan: 0, medianIoiMs: 0, velocitySpread: 0 };
const burst = (verdict, legitNotes = 0) => ({ events: [], verdict, legitNotes, stats });
const LADDER = ladderConfig({ intervals_seconds: [60, 60, 50, 40] }, { baseTimeoutSeconds: 60 });
const INTERVAL = [60, 60, 50, 40, 40];
const logged = (event) => log.info.mock.calls.filter((c) => c[0] === event).map((c) => c[1]);

function setup({ judgeBurst = null, ladder = LADDER } = {}) {
  let current = burst('spam');
  const recordCheckIn = vi.fn();
  const burstSince = vi.fn(() => current);
  const hook = renderHook(({ humanNoteAt }) => useEngagementGate({
    pause: vi.fn(), play: vi.fn(), isPaused: () => false, isSequential: true, humanNoteAt,
    burstSince, judgeBurst, recordCheckIn, ladder,
  }), { initialProps: { humanNoteAt: 0 } });
  const rung = () => hook.result.current.step.rung ?? 0;
  /** Wait out the current rung's interval (plus a second) with no notes. */
  const idleOpen = () => {
    const wait = (INTERVAL[Math.min(rung(), 4)] + 1.5) * 1000;
    for (let t = 0; t < wait && !hook.result.current.gateOpen; t += 500) act(() => { vi.advanceTimersByTime(500); });
    expect(hook.result.current.gateOpen).toBe(true);
    return hook.result.current.step;
  };
  const answer = (next) => { act(() => { hook.result.current.dismissGate(); }); current = next ?? burst('spam'); };
  /** Notes every 2 s for `sec` seconds (the idle clock never runs out). */
  const play = (sec) => {
    for (let t = 0; t < sec * 1000; t += 2000) {
      act(() => { vi.advanceTimersByTime(2000); });
      hook.rerender({ humanNoteAt: Date.now() });
    }
  };
  return { hook, idleOpen, answer, play, recordCheckIn, burstSince, set: (b) => { current = b; } };
}

/** Climb to `target` with nothing but the answers in between. */
function climbTo(g, target) {
  g.idleOpen();
  for (let r = 1; r <= target; r++) { g.answer(); g.idleOpen(); }
}

describe('useEngagementGate — presence ladder', () => {
  it('none between answers climbs note → rung1 → rung2 → rung3 → rung4 → rung4', () => {
    const g = setup();
    const steps = [g.idleOpen()];
    for (let i = 0; i < 5; i++) { g.answer(); steps.push(g.idleOpen()); }
    expect(steps.map((s) => s.rung)).toEqual([0, 1, 2, 3, 4, 4]);
    expect(steps[0]).toEqual({ kind: 'note', rung: 0 });
    expect(steps[3]).toMatchObject({ kind: 'scales', count: 1, hands: ['RL'] });
    expect(steps[4]).toMatchObject({ kind: 'scales', count: 2, hands: ['RL', 'RL'] });
    expect(g.recordCheckIn).toHaveBeenCalledWith({ open: true, rung: 0, scales: 0, minimal: false });
    expect(g.recordCheckIn).toHaveBeenCalledWith({ open: true, rung: 3, scales: 1, minimal: true });
    expect(g.recordCheckIn).toHaveBeenCalledWith({ open: false });
  });

  it('scaleIndex counts the scales already asked this sitting (1, 2, 1 → 0, 1, 3)', () => {
    const g = setup();
    g.idleOpen(); g.answer();
    expect(g.idleOpen()).toMatchObject({ rung: 1, scaleIndex: 0 });
    g.answer();
    expect(g.idleOpen()).toMatchObject({ rung: 2, scaleIndex: 1 });
    g.answer();
    expect(g.idleOpen()).toMatchObject({ rung: 3, scaleIndex: 3 });
  });

  it('the gate waits the rung\'s interval', () => {
    const g = setup();
    climbTo(g, 2);
    expect(logged('piano.engagement-gate.interval')).toContainEqual({ rung: 2, seconds: 50 });
    g.answer();
    // Now at rung 2: a 50 s interval before the next check-in.
    act(() => { vi.advanceTimersByTime(49000); });
    expect(g.hook.result.current.gateOpen).toBe(false);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(g.hook.result.current.gateOpen).toBe(true);
  });

  it('practice resets to note and the interval back to the first', () => {
    const g = setup();
    climbTo(g, 3);
    g.answer(burst('legit', 40));
    g.play(180);
    const s = g.idleOpen();
    expect(s.kind).toBe('note');
    expect(logged('piano.engagement-gate.rung')).toContainEqual(expect.objectContaining({ from: 3, to: 0, evidence: 'practice' }));
    expect(logged('piano.engagement-gate.interval')).toContainEqual({ rung: 0, seconds: 60 });
    expect(g.recordCheckIn).toHaveBeenLastCalledWith({ open: true, rung: 0, scales: 0, minimal: false });
  });

  it('partial steps down one', () => {
    const g = setup();
    climbTo(g, 3);
    g.answer(burst('legit', 9));
    g.play(300);
    expect(g.idleOpen().rung).toBe(2);
    expect(logged('piano.engagement-gate.rung')).toContainEqual(expect.objectContaining({ from: 3, to: 2, evidence: 'partial' }));
  });

  it('answer notes are not evidence (RF4): burstSince is asked from the answer + 3 s', () => {
    const g = setup();
    g.idleOpen();
    const answeredAt = Date.now();
    g.answer(burst('spam', 0));
    g.burstSince.mockClear();
    g.idleOpen();
    expect(g.burstSince).toHaveBeenCalled();
    for (const call of g.burstSince.mock.calls) expect(call[0]).toBe(answeredAt + 3000);
  });

  it('top rung logs once per sitting', () => {
    const g = setup();
    climbTo(g, 4);
    g.answer(); g.idleOpen();
    g.answer(burst('legit', 40)); g.play(180); g.idleOpen(); // back to the note
    g.answer(); g.idleOpen(); g.answer(); g.idleOpen(); g.answer(); g.idleOpen(); g.answer(); g.idleOpen(); // into 4 again
    expect(g.hook.result.current.step.rung).toBe(4);
    expect(logged('piano.engagement-gate.top-rung')).toHaveLength(1);
    expect(logged('piano.engagement-gate.top-rung')[0]).toMatchObject({ minimal: 4 });
  });

  it('an ambiguous burst sends one judge request; pending holds, legit resets, not-legit climbs, fallback goes by the rate', async () => {
    let resolve;
    const judgeBurst = vi.fn(() => new Promise((r) => { resolve = r; }));
    const g = setup({ judgeBurst });
    g.idleOpen(); g.answer();
    g.idleOpen(); // rung 1
    g.answer(burst('ambiguous', 30));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(judgeBurst).toHaveBeenCalledTimes(1);
    expect(judgeBurst.mock.calls[0][0]).toMatchObject({ kind: 'check-in' });
    expect(g.idleOpen().rung).toBe(1); // pending → hold
    expect(logged('piano.engagement-gate.ladder-hold')).toHaveLength(1);
    expect(judgeBurst).toHaveBeenCalledTimes(1);

    g.answer(burst('ambiguous', 30));
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { resolve({ legit: true, probability: 0.9, source: 'model' }); await Promise.resolve(); await Promise.resolve(); });
    expect(g.idleOpen().rung).toBe(0); // 30 legit notes in ~1 min → practice

    g.answer(burst('spam')); g.idleOpen(); // up to 1
    g.answer(burst('ambiguous', 30));
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { resolve({ legit: false, probability: 0.2, source: 'model' }); await Promise.resolve(); await Promise.resolve(); });
    expect(g.idleOpen().rung).toBe(2);

    g.answer(burst('ambiguous', 30));
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { resolve({ legit: null, probability: null, source: 'fallback' }); await Promise.resolve(); await Promise.resolve(); });
    expect(g.idleOpen().rung).toBe(0);
  });

  it('the gate opens and dismisses normally while a judge promise never settles', () => {
    const judgeBurst = vi.fn(() => new Promise(() => {}));
    const g = setup({ judgeBurst });
    g.idleOpen(); g.answer(burst('ambiguous', 9));
    expect(g.idleOpen()).toBeTruthy();
    act(() => { g.hook.result.current.dismissGate(); });
    expect(g.hook.result.current.gateOpen).toBe(false);
  });

  it('every sitting starts at the note: a new mount (new video or sitting) after a climb opens rung 0, not minimal (owner 2026-11-13)', () => {
    const g1 = setup();
    climbTo(g1, 3);
    g1.hook.unmount();
    const g2 = setup();
    expect(g2.idleOpen()).toEqual({ kind: 'note', rung: 0 });
    expect(g2.recordCheckIn).toHaveBeenCalledWith({ open: true, rung: 0, scales: 0, minimal: false });
  });

  it('preschool never leaves the single note, and still marks minimal check-ins', () => {
    const pre = ladderConfig({}, { preschool: true, baseTimeoutSeconds: 60 });
    const g = setup({ ladder: pre });
    g.idleOpen(); g.answer();
    expect(g.idleOpen()).toEqual({ kind: 'note', rung: 0 });
    g.answer();
    expect(g.idleOpen()).toEqual({ kind: 'note', rung: 0 });
    expect(g.recordCheckIn).toHaveBeenLastCalledWith({ open: true, rung: 0, scales: 0, minimal: true });
  });
});

describe('useEngagementGate — keepalive deadline (R5)', () => {
  const L60 = ladderConfig({ intervals_seconds: [60] }, { baseTimeoutSeconds: 60 });
  /** Notes every `every` s for `sec` s, stopping as soon as the gate opens. */
  const strayNotes = (g, every, sec) => {
    for (let t = 0; t < sec * 1000 && !g.hook.result.current.gateOpen; t += 1000) {
      act(() => { vi.advanceTimersByTime(1000); });
      if ((t / 1000 + 1) % every === 0) g.hook.rerender({ humanNoteAt: Date.now() });
    }
  };

  it('stray notes every 50 s do not dodge the next check-in once one was answered', () => {
    const g = setup({ ladder: L60 });
    g.idleOpen();
    const t0 = Date.now();
    g.answer(burst('spam', 1));
    strayNotes(g, 50, 125);
    expect(g.hook.result.current.gateOpen).toBe(true);
    expect(Date.now() - t0).toBeLessThanOrEqual(121000);
    expect(g.hook.result.current.step.rung).toBe(1);
    const dl = logged('piano.engagement-gate.keepalive-deadline');
    expect(dl).toHaveLength(1);
    expect(dl[0]).toMatchObject({ rung: 0 });
    expect(dl[0].elapsedMs).toBeGreaterThanOrEqual(120000);
  });

  it('steady playing never trips the deadline', () => {
    const g = setup({ ladder: L60 });
    g.idleOpen();
    g.answer(burst('legit', 30));
    strayNotes(g, 2, 300);
    expect(g.hook.result.current.gateOpen).toBe(false);
    expect(logged('piano.engagement-gate.keepalive-deadline')).toHaveLength(0);
  });

  it('no deadline before the first answer', () => {
    const g = setup({ ladder: L60 });
    strayNotes(g, 50, 300);
    expect(g.hook.result.current.gateOpen).toBe(false);
  });

  it('no deadline when keepaliveDeadline is false (preschool)', () => {
    const g = setup({ ladder: ladderConfig({}, { preschool: true, baseTimeoutSeconds: 60 }) });
    g.idleOpen();
    g.answer(burst('spam', 1));
    strayNotes(g, 50, 300);
    expect(g.hook.result.current.gateOpen).toBe(false);
    const off = setup({ ladder: ladderConfig({ intervals_seconds: [60], keepalive_deadline: false }, { baseTimeoutSeconds: 60 }) });
    off.idleOpen();
    off.answer(burst('spam', 1));
    strayNotes(off, 50, 300);
    expect(off.hook.result.current.gateOpen).toBe(false);
  });
});
