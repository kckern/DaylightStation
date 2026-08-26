import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChessOpponentSpeech } from './useChessOpponentSpeech.js';

const state = (moves) => ({
  history: moves.map((san, index) => ({ san, color: index % 2 ? 'b' : 'w' })),
  game: { initial_fen: 'start', fen: `fen-${moves.length}`, moves },
});

function props(overrides = {}) {
  return {
    gameId: 'g1', game: state([]), level: 0, playerColor: 'w', userId: 'learner4',
    fallback: null, requestQuip: vi.fn(async ({ gameId, ply }) => ({
      eventId: `${gameId}:${ply}`, quip: `Quip ${ply}.`, source: 'ai',
    })),
    logger: { warn: vi.fn() },
    ...overrides,
  };
}

describe('useChessOpponentSpeech', () => {
  it('reacts after every newly committed ply but not on mount', async () => {
    const input = props();
    const { result, rerender } = renderHook((current) => useChessOpponentSpeech(current), { initialProps: input });
    expect(input.requestQuip).not.toHaveBeenCalled();
    rerender({ ...input, game: state(['e4']) });
    await waitFor(() => expect(result.current?.quip).toBe('Quip 1.'));
    rerender({ ...input, game: state(['e4', 'e5']) });
    await waitFor(() => expect(result.current?.quip).toBe('Quip 2.'));
    expect(input.requestQuip).toHaveBeenCalledTimes(2);
  });

  it('ignores stale speech when a newer position answers first', async () => {
    const pending = [];
    const input = props({ requestQuip: vi.fn(() => new Promise((resolve) => pending.push(resolve))) });
    const { result, rerender } = renderHook((current) => useChessOpponentSpeech(current), { initialProps: input });
    rerender({ ...input, game: state(['e4']) });
    rerender({ ...input, game: state(['e4', 'e5']) });
    await act(async () => pending[1]({ eventId: 'g1:2', quip: 'Newest.', source: 'ai' }));
    expect(result.current.quip).toBe('Newest.');
    await act(async () => pending[0]({ eventId: 'g1:1', quip: 'Stale.', source: 'ai' }));
    expect(result.current.quip).toBe('Newest.');
  });

  it('clears removed speech on takeback and treats a replacement as a new move', async () => {
    const input = props();
    const { result, rerender } = renderHook((current) => useChessOpponentSpeech(current), { initialProps: input });
    rerender({ ...input, game: state(['e4', 'e5']) });
    await waitFor(() => expect(result.current?.quip).toBe('Quip 2.'));
    rerender({ ...input, game: state(['e4']) });
    expect(result.current).toBeNull();
    rerender({ ...input, game: state(['e4', 'c5']) });
    await waitFor(() => expect(result.current?.quip).toBe('Quip 2.'));
    expect(input.requestQuip).toHaveBeenCalledTimes(2);
  });

  it('does not replay the old game speech after restart', () => {
    const input = props({ game: state(['e4']) });
    const { rerender } = renderHook((current) => useChessOpponentSpeech(current), { initialProps: input });
    rerender({ ...input, gameId: 'g2', game: state([]) });
    expect(input.requestQuip).not.toHaveBeenCalled();
  });
});
