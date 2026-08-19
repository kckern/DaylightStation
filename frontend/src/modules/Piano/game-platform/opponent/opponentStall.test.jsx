import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOpponentReply, OPPONENT_STALL_MS } from './opponentPacing.js';

vi.mock('../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('opponent reply — re-firing per turn', () => {
  // Checkers leaves `turn` AT 2 between the legs of an opponent double jump, so
  // `enabled` never toggles. The effect only watches [enabled, resetKey], so
  // without the position in the key the opponent stopped mid-jump and the board
  // stayed on its turn forever — every key the player pressed was discarded.
  it('asks again when the position advances while it is still the opponent turn', () => {
    const request = vi.fn(async () => ({ move: { from: 1, to: 2 } }));
    const { rerender } = renderHook(
      ({ resetKey }) => useOpponentReply({ enabled: true, request, thinkMs: 0, onReply: vi.fn(), resetKey }),
      { initialProps: { resetKey: 'g:10:-' } },
    );
    expect(request).toHaveBeenCalledTimes(1);

    // First leg of the jump landed: ply moved on, a further jump is forced, and
    // it is STILL the opponent's turn.
    rerender({ resetKey: 'g:11:18' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not re-ask when nothing about the position changed', () => {
    const request = vi.fn(async () => null);
    const { rerender } = renderHook(
      ({ resetKey }) => useOpponentReply({ enabled: true, request, thinkMs: 0, onReply: vi.fn(), resetKey }),
      { initialProps: { resetKey: 'g:10:-' } },
    );
    rerender({ resetKey: 'g:10:-' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('opponent reply — stall guardrail', () => {
  it('falls back to the local engine when a request never settles', async () => {
    // A request that neither resolves nor rejects used to leave the board on the
    // opponent's turn with no way out.
    const request = vi.fn(() => new Promise(() => {}));
    const fallback = vi.fn(() => ({ move: { from: 3, to: 7 } }));
    const onReply = vi.fn();
    renderHook(() => useOpponentReply({ enabled: true, request, fallback, thinkMs: 0, onReply }));

    expect(onReply).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(OPPONENT_STALL_MS + 50); });
    expect(fallback).toHaveBeenCalled();
    expect(onReply).toHaveBeenCalledWith({ move: { from: 3, to: 7 } });
  });

  it('does not double-answer when the request lands just before the guardrail', async () => {
    let resolve;
    const request = vi.fn(() => new Promise((r) => { resolve = r; }));
    const fallback = vi.fn(() => ({ move: { from: 9, to: 9 } }));
    const onReply = vi.fn();
    renderHook(() => useOpponentReply({ enabled: true, request, fallback, thinkMs: 0, onReply }));

    await act(async () => { resolve({ move: { from: 1, to: 5 } }); });
    await act(async () => { vi.advanceTimersByTime(OPPONENT_STALL_MS + 50); });
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
});
