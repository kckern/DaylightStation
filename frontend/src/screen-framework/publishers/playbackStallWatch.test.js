import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlaybackStallWatch } from './playbackStallWatch.js';

function makeItem(over = {}) {
  return { contentId: 'plex:694719', format: 'dash_video', title: 'A lecture', duration: 1800, ...over };
}

function makeSnapshot({ state = 'playing', position = 0, currentItem = makeItem() } = {}) {
  return {
    sessionId: 's', state, currentItem, position,
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
    meta: { ownerId: 'piano-tablet', updatedAt: '2026-08-16T18:32:00.000Z' },
  };
}

describe('createPlaybackStallWatch', () => {
  let now, onStall, watch;

  beforeEach(() => {
    now = 1_700_000_000_000;
    onStall = vi.fn();
    watch = createPlaybackStallWatch({ onStall, now: () => now, thresholdMs: 60_000 });
  });

  /** Feed one heartbeat's worth of snapshot, advancing the clock first. */
  function observe({ advanceMs = 0, ...snap } = {}) {
    now += advanceMs;
    watch.observe(makeSnapshot(snap));
  }

  /**
   * Anti-vacuity control: a fresh watch on the same harness must still reach a
   * verdict, so silence in the exclusion cases below is a decision rather than a
   * broken fixture.
   */
  function expectHarnessStillDetectsAStall() {
    const control = vi.fn();
    const w = createPlaybackStallWatch({ onStall: control, now: () => now, thresholdMs: 60_000 });
    w.observe(makeSnapshot({ position: 0 }));
    for (let i = 0; i < 13; i += 1) { now += 5000; w.observe(makeSnapshot({ position: 0 })); }
    expect(control).toHaveBeenCalledTimes(1);
  }

  it('reports a playing snapshot whose position never moves', () => {
    observe({ position: 0 });
    for (let i = 0; i < 13; i += 1) observe({ advanceMs: 5000, position: 0 });

    expect(onStall).toHaveBeenCalledTimes(1);
    const detail = onStall.mock.calls[0][0];
    expect(detail.contentId).toBe('plex:694719');
    expect(detail.position).toBe(0);
    expect(detail.stalledForMs).toBeGreaterThanOrEqual(60_000);
  });

  it('reports once per episode, not once per heartbeat', () => {
    observe({ position: 0 });
    for (let i = 0; i < 200; i += 1) observe({ advanceMs: 5000, position: 0 });

    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a paused player', () => {
    observe({ state: 'paused', position: 42 });
    for (let i = 0; i < 20; i += 1) observe({ advanceMs: 5000, state: 'paused', position: 42 });

    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('says nothing about a player buffering a long seek', () => {
    for (let i = 0; i < 20; i += 1) observe({ advanceMs: 5000, state: 'buffering', position: 900 });

    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('says nothing about an advancing player', () => {
    let pos = 0;
    observe({ position: pos });
    for (let i = 0; i < 30; i += 1) { pos += 5; observe({ advanceMs: 5000, position: pos }); }

    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('says nothing about live content', () => {
    const live = makeItem({ duration: 0 });
    observe({ position: 0, currentItem: live });
    for (let i = 0; i < 20; i += 1) observe({ advanceMs: 5000, position: 0, currentItem: live });

    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('says nothing on a single sample', () => {
    observe({ position: 0 });
    now += 10 * 60_000;

    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('restarts its window when the content changes', () => {
    observe({ position: 0 });
    for (let i = 0; i < 10; i += 1) observe({ advanceMs: 5000, position: 0 });
    const next = makeItem({ contentId: 'plex:694720' });
    observe({ advanceMs: 5000, position: 0, currentItem: next });
    observe({ advanceMs: 5000, position: 0, currentItem: next });

    expect(onStall).not.toHaveBeenCalled();
    expectHarnessStillDetectsAStall();
  });

  it('re-arms after the playhead moves again', () => {
    observe({ position: 0 });
    for (let i = 0; i < 13; i += 1) observe({ advanceMs: 5000, position: 0 });
    expect(onStall).toHaveBeenCalledTimes(1);

    observe({ advanceMs: 5000, position: 5 });
    for (let i = 0; i < 13; i += 1) observe({ advanceMs: 5000, position: 5 });

    expect(onStall).toHaveBeenCalledTimes(2);
  });

  it('ignores a null snapshot rather than throwing', () => {
    expect(() => watch.observe(null)).not.toThrow();
    expect(onStall).not.toHaveBeenCalled();
  });

  it('does not let an onStall handler take down the caller', () => {
    onStall.mockImplementation(() => { throw new Error('report failed'); });
    observe({ position: 0 });

    expect(() => {
      for (let i = 0; i < 13; i += 1) observe({ advanceMs: 5000, position: 0 });
    }).not.toThrow();
  });
});
