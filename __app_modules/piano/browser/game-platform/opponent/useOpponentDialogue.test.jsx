import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOpponentDialogue } from './useOpponentDialogue.js';

const event = { gameId: 'checkers', sessionId: 'g1', ply: 4, opponentId: 'pip' };
const fallback = { eventId: 'g1:4', quip: 'Your move.' };

describe('useOpponentDialogue', () => {
  it('commits a settled generated line and records exactly what was displayed', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { result } = renderHook(() => useOpponentDialogue({ logger }));
    let pending;
    act(() => {
      pending = result.current.prepareReaction({ request: async () => ({ eventId: 'g1:4', quip: 'A clever jump.', source: 'ai' }), fallback, event });
    });
    await pending.promise;
    act(() => result.current.commitReaction(pending));
    expect(result.current.speech).toMatchObject({ quip: 'A clever jump.', source: 'ai' });
    expect(result.current.dialogueRef.current).toHaveLength(1);
    expect(result.current.dialogueRef.current[0]).toMatchObject({ ...event, quip: 'A clever jump.' });
  });

  it('uses the deadline fallback and discards a late result', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    let settle;
    const { result } = renderHook(() => useOpponentDialogue({ logger }));
    let pending;
    act(() => {
      pending = result.current.prepareReaction({ request: () => new Promise((resolve) => { settle = resolve; }), fallback, event });
    });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.commitReaction(pending));
    expect(result.current.speech).toMatchObject({ quip: 'Your move.', source: 'fallback', fallbackReason: 'timeout' });
    await act(async () => { settle({ eventId: 'g1:4', quip: 'Too late.', source: 'ai' }); await pending.promise; });
    expect(result.current.speech.quip).toBe('Your move.');
    expect(logger.info).toHaveBeenCalledWith('piano-game.dialogue.late-discarded', expect.objectContaining({ sessionId: 'g1' }));
  });

  it('shows a terminal reaction immediately and clears stale work on reset', () => {
    const { result } = renderHook(() => useOpponentDialogue());
    act(() => result.current.showTerminalReaction({ reaction: { eventId: 'g1:5', quip: 'You found the finish.' }, event: { ...event, ply: 5 } }));
    expect(result.current.speech.quip).toBe('You found the finish.');
    act(() => result.current.reset());
    expect(result.current.speech).toBeNull();
    expect(result.current.dialogueRef.current).toEqual([]);
  });
});
