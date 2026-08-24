import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChessSessionIdentity } from './useChessSessionIdentity.js';

describe('useChessSessionIdentity', () => {
  it('holds one player during a game and relatches both id and name on restart', () => {
    const { result, rerender } = renderHook(
      ({ currentUser }) => useChessSessionIdentity({ currentUser, playerName: null, initialSeed: 41 }),
      { initialProps: { currentUser: { id: 'felix', name: 'Felix' } } },
    );

    expect(result.current.lockedUser).toBe('felix');
    expect(result.current.playerAvatarId).toBe('felix');
    expect(result.current.displayName).toBe('Felix');

    rerender({ currentUser: { id: 'alan', name: 'Alan' } });
    expect(result.current.lockedUser).toBe('felix');
    expect(result.current.displayName).toBe('Felix');

    const firstGameId = result.current.gameId;
    const firstSeed = result.current.gameSeed;
    act(() => result.current.beginNextGame());
    rerender({ currentUser: { id: 'alan', name: 'Alan' } });
    expect(result.current.lockedUser).toBe('alan');
    expect(result.current.playerAvatarId).toBe('alan');
    expect(result.current.displayName).toBe('Alan');
    expect(result.current.gameIdRef.current).toBe(result.current.gameId);
    expect(result.current.gameId).not.toBe(firstGameId);
    expect(result.current.gameSeed).toBe(firstSeed + 1);

    const seeds = [result.current.gameSeed];
    act(() => seeds.push(result.current.beginNextGame().seed));
    act(() => seeds.push(result.current.beginNextGame().seed));
    expect(new Set(seeds).size).toBe(3);
  });
});
