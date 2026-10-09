import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChessSessionResources } from './useChessSessionResources.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const logger = { info: vi.fn(), warn: vi.fn() };

describe('useChessSessionResources', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides the previous player immediately and ignores late session responses', async () => {
    const learner4Config = deferred();
    const learner4Ladder = deferred();
    const learner2Config = deferred();
    const learner2Ladder = deferred();
    const readConfig = vi.fn((user) => (user === 'learner4' ? learner4Config.promise : learner2Config.promise));
    const readLadder = vi.fn((user) => (user === 'learner4' ? learner4Ladder.promise : learner2Ladder.promise));

    const { result, rerender } = renderHook(
      ({ sessionId, userId }) => useChessSessionResources({
        sessionId,
        userId,
        historyLength: 0,
        readConfig,
        readLadder,
        writeConfig: vi.fn(),
        logger,
      }),
      { initialProps: { sessionId: 'game-1', userId: 'learner4' } },
    );

    await act(async () => {
      learner4Config.resolve({ default_rung: 'sharp', marker: 'learner4' });
      learner4Ladder.resolve({ unlocked_through: 8, current: { name: 'Learner4 opponent' } });
    });
    await waitFor(() => expect(result.current.ladderReady).toBe(true));
    expect(result.current.chessConfig.marker).toBe('learner4');

    rerender({ sessionId: 'game-2', userId: 'learner2' });
    expect(result.current.chessConfig).toBe(null);
    expect(result.current.ladder).toBe(null);
    expect(result.current.ladderReady).toBe(false);
    expect(result.current.rungId).toBe('learner');

    await act(async () => {
      learner2Config.resolve(null);
      learner2Ladder.resolve(null);
    });
    await waitFor(() => expect(result.current.ladderReady).toBe(true));
    expect(result.current.chessConfig).toBe(null);
    expect(result.current.opponent).toBe(null);
  });

  it('never lets a late old-player response overwrite the active session', async () => {
    const oldConfig = deferred();
    const oldLadder = deferred();
    const readConfig = vi.fn((user) => (user === 'learner4' ? oldConfig.promise : Promise.resolve(null)));
    const readLadder = vi.fn((user) => (user === 'learner4' ? oldLadder.promise : Promise.resolve(null)));
    const { result, rerender } = renderHook(
      ({ sessionId, userId }) => useChessSessionResources({
        sessionId,
        userId,
        historyLength: 0,
        readConfig,
        readLadder,
        writeConfig: vi.fn(),
        logger,
      }),
      { initialProps: { sessionId: 'game-1', userId: 'learner4' } },
    );

    rerender({ sessionId: 'game-2', userId: 'learner2' });
    await waitFor(() => expect(result.current.ladderReady).toBe(true));
    await act(async () => {
      oldConfig.resolve({ marker: 'learner4' });
      oldLadder.resolve({ unlocked_through: 19 });
    });
    expect(result.current.chessConfig).toBe(null);
    expect(result.current.ladder).toBe(null);
  });

  it('persists onboarding once for each player session', async () => {
    const writeConfig = vi.fn(async () => null);
    const readConfig = vi.fn(async () => ({}));
    const readLadder = vi.fn(async () => null);
    const { rerender } = renderHook(
      ({ sessionId, userId, historyLength }) => useChessSessionResources({
        sessionId,
        userId,
        historyLength,
        readConfig,
        readLadder,
        writeConfig,
        logger,
      }),
      { initialProps: { sessionId: 'game-1', userId: 'learner4', historyLength: 0 } },
    );
    await waitFor(() => expect(logger.info).toHaveBeenCalledWith(
      'config-loaded', expect.objectContaining({ sessionId: 'game-1' }),
    ));
    rerender({ sessionId: 'game-1', userId: 'learner4', historyLength: 1 });
    await waitFor(() => expect(writeConfig).toHaveBeenCalledWith('learner4', { seen_intro: true }));

    rerender({ sessionId: 'game-2', userId: 'learner2', historyLength: 0 });
    await waitFor(() => expect(logger.info).toHaveBeenCalledWith(
      'config-loaded', expect.objectContaining({ sessionId: 'game-2' }),
    ));
    rerender({ sessionId: 'game-2', userId: 'learner2', historyLength: 1 });
    await waitFor(() => expect(writeConfig).toHaveBeenCalledWith('learner2', { seen_intro: true }));
    expect(writeConfig).toHaveBeenCalledTimes(2);
  });
});
