import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_THINK_MS, thinkMsConfig, thinkTimeFor, useOpponentReply } from './opponentPacing.js';

const noJitter = { opponent: { think_ms: { floor: 600, ceiling: 4000, jitter: 0 } } };

describe('how long the opponent thinks', () => {
  it('answers fast at the bottom of a 21-rung ladder and slowly at the top', () => {
    expect(thinkTimeFor({ level: 0, levels: 21, config: noJitter })).toBe(600);
    expect(thinkTimeFor({ level: 20, levels: 21, config: noJitter })).toBe(4000);
  });

  it('never goes backwards as a 21-rung ladder climbs', () => {
    let previous = -1;
    for (let level = 0; level <= 20; level += 1) {
      const ms = thinkTimeFor({ level, levels: 21, config: noJitter });
      expect(ms).toBeGreaterThanOrEqual(previous);
      previous = ms;
    }
  });

  it('scales the same curve across a shorter 7-rung ladder (Connect Four / Checkers)', () => {
    let previous = -1;
    for (let level = 0; level <= 6; level += 1) {
      const ms = thinkTimeFor({ level, levels: 7, config: noJitter });
      expect(ms).toBeGreaterThanOrEqual(previous);
      previous = ms;
    }
    expect(thinkTimeFor({ level: 0, levels: 7, config: noJitter })).toBe(600);
    expect(thinkTimeFor({ level: 6, levels: 7, config: noJitter })).toBe(4000);
  });

  it('clamps a level outside the ladder rather than extrapolating', () => {
    expect(thinkTimeFor({ level: -5, levels: 21, config: noJitter })).toBe(600);
    expect(thinkTimeFor({ level: 99, levels: 21, config: noJitter })).toBe(4000);
  });

  it('is deterministic for a seed and ply, so a test can pin it', () => {
    const jittered = { opponent: { think_ms: { floor: 600, ceiling: 4000, jitter: 0.25 } } };
    const first = thinkTimeFor({ level: 10, levels: 21, config: jittered, seed: 42, ply: 3 });
    expect(thinkTimeFor({ level: 10, levels: 21, config: jittered, seed: 42, ply: 3 })).toBe(first);
    expect(thinkTimeFor({ level: 10, levels: 21, config: jittered, seed: 42, ply: 4 })).not.toBe(first);
  });

  it('never calls Math.random — jitter is derived from seed + ply', () => {
    const spy = vi.spyOn(Math, 'random');
    for (let ply = 0; ply < 20; ply += 1) {
      thinkTimeFor({ level: 5, levels: 21, config: noJitter, seed: 1, ply });
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps jitter inside the band it was given', () => {
    const jittered = { opponent: { think_ms: { floor: 1000, ceiling: 1000, jitter: 0.25 } } };
    for (let ply = 0; ply < 50; ply += 1) {
      const ms = thinkTimeFor({ level: 5, levels: 21, config: jittered, seed: 1, ply });
      expect(ms).toBeGreaterThanOrEqual(750);
      expect(ms).toBeLessThanOrEqual(1250);
    }
  });

  it('scales by the pace the player chose', () => {
    expect(thinkTimeFor({ level: 20, levels: 21, config: noJitter, pace: 0.5 })).toBe(2000);
    expect(thinkTimeFor({ level: 0, levels: 21, config: noJitter, pace: 2 })).toBe(1200);
  });

  it('refuses to guess when there is no ladder to read', () => {
    expect(thinkTimeFor({ level: null, levels: 21, config: noJitter })).toBe(null);
    expect(thinkTimeFor({ level: undefined, levels: 21, config: noJitter })).toBe(null);
    expect(thinkTimeFor({ level: 'strong', levels: 21, config: noJitter })).toBe(null);
    expect(thinkTimeFor({ level: 3, config: noJitter })).toBe(null);
    expect(thinkTimeFor({ level: 0, levels: 1, config: noJitter })).toBe(null);
  });

  it('falls back to the house curve when the config says nothing', () => {
    expect(thinkMsConfig(null)).toEqual(DEFAULT_THINK_MS);
    expect(thinkMsConfig({ opponent: { think_ms: { floor: 100 } } }))
      .toEqual({ ...DEFAULT_THINK_MS, floor: 100 });
  });

  it('will not let a bad config invert the curve', () => {
    const inverted = { opponent: { think_ms: { floor: 5000, ceiling: 1000, jitter: 0 } } };
    expect(thinkTimeFor({ level: 0, levels: 21, config: inverted }))
      .toBeLessThanOrEqual(thinkTimeFor({ level: 20, levels: 21, config: inverted }));
  });
});

describe('useOpponentReply — the pause is a floor, never an addend', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it('fires the request immediately, with zero timers advanced', () => {
    const request = vi.fn(() => new Promise(() => {})); // never resolves in this test
    renderHook(() => useOpponentReply({ enabled: true, request, thinkMs: 4000, onReply: vi.fn() }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not fire the request while disabled', () => {
    const request = vi.fn(() => new Promise(() => {}));
    renderHook(() => useOpponentReply({ enabled: false, request, thinkMs: 4000, onReply: vi.fn() }));
    expect(request).not.toHaveBeenCalled();
  });

  it('holds an instant reply for the full think-time floor before committing', async () => {
    const request = vi.fn(() => Promise.resolve({ move: 'x' }));
    const onReply = vi.fn();
    renderHook(() => useOpponentReply({ enabled: true, request, thinkMs: 1000, onReply }));

    await act(async () => { await Promise.resolve(); }); // flush the already-resolved request
    expect(onReply).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(onReply).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith({ move: 'x' });
  });

  it('does not add network time to the think time — total wait is the max, not the sum', async () => {
    let resolveRequest;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const onReply = vi.fn();
    renderHook(() => useOpponentReply({ enabled: true, request, thinkMs: 1000, onReply }));

    // The network alone takes 800ms.
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    resolveRequest('served');
    await act(async () => { await Promise.resolve(); });
    expect(onReply).not.toHaveBeenCalled();

    // Only the remaining 200ms of the floor is left, not another full 1000ms.
    await act(async () => { await vi.advanceTimersByTimeAsync(199); });
    expect(onReply).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('commits right away when the network alone already exceeds the floor', async () => {
    let resolveRequest;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const onReply = vi.fn();
    renderHook(() => useOpponentReply({ enabled: true, request, thinkMs: 500, onReply }));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    resolveRequest('served');
    // waitMs computes to 0 here (elapsed already exceeds the floor), but a 0ms
    // setTimeout still needs the fake clock to tick — a bare microtask flush
    // does not fire it.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('discards a reply that resolves after unmount', async () => {
    let resolveRequest;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const onReply = vi.fn();
    const { unmount } = renderHook(() => useOpponentReply({ enabled: true, request, thinkMs: 100, onReply }));

    unmount();
    resolveRequest('served');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(onReply).not.toHaveBeenCalled();
  });

  it('discards a pending reply when the caller flips enabled off (takeback / reset mid-think)', async () => {
    let resolveRequest;
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const onReply = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useOpponentReply({ enabled, request, thinkMs: 1000, onReply }),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });
    resolveRequest('served');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onReply).not.toHaveBeenCalled();
  });

  it('discards a pending reply when resetKey changes even though enabled stays true', async () => {
    // This is the chess-restart case: a fresh game can start on the opponent's
    // turn again (player is Black), so `enabled` never toggles false across the
    // reset — only the game identity changes. Without this, a stale reply for
    // the OLD board could land on the NEW one.
    const resolvers = [];
    const request = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const onReply = vi.fn();
    const { rerender } = renderHook(
      ({ resetKey }) => useOpponentReply({ enabled: true, request, thinkMs: 100, onReply, resetKey }),
      { initialProps: { resetKey: 'game-1' } },
    );

    rerender({ resetKey: 'game-2' });
    expect(request).toHaveBeenCalledTimes(2); // resetKey retriggers — it does not just cancel.

    resolvers[0]('stale-served'); // the FIRST (now-cancelled) request answers late
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(onReply).not.toHaveBeenCalled();

    resolvers[1]('fresh-served'); // the SECOND (current) request answers
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith('fresh-served');
  });

  it('falls back when the request rejects, still honoring the think-time floor', async () => {
    const request = vi.fn(() => Promise.reject(new Error('network down')));
    const fallback = vi.fn(() => 'local-move');
    const onReply = vi.fn();
    renderHook(() => useOpponentReply({
      enabled: true, request, fallback, thinkMs: 300, onReply,
    }));

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onReply).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith('local-move');
  });

  it('reports thinking while the reply is pending, and stops once committed', async () => {
    const request = vi.fn(() => Promise.resolve('served'));
    const { result } = renderHook(() => useOpponentReply({
      enabled: true, request, thinkMs: 50, onReply: vi.fn(),
    }));
    expect(result.current.thinking).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.thinking).toBe(false);
  });
});
