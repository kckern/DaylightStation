import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChessSessionIdentity } from './useChessSessionIdentity.js';

describe('useChessSessionIdentity', () => {
  it('holds one player during a game and relatches both id and name on restart', () => {
    const { result, rerender } = renderHook(
      ({ currentUser }) => useChessSessionIdentity({ currentUser, playerName: null, initialSeed: 41 }),
      { initialProps: { currentUser: { id: 'user_2', name: 'User_2' } } },
    );

    expect(result.current.lockedUser).toBe('user_2');
    expect(result.current.playerAvatarId).toBe('user_2');
    expect(result.current.displayName).toBe('User_2');

    rerender({ currentUser: { id: 'user_4', name: 'User_4' } });
    expect(result.current.lockedUser).toBe('user_2');
    expect(result.current.displayName).toBe('User_2');

    const firstGameId = result.current.gameId;
    const firstSeed = result.current.gameSeed;
    act(() => result.current.beginNextGame());
    rerender({ currentUser: { id: 'user_4', name: 'User_4' } });
    expect(result.current.lockedUser).toBe('user_4');
    expect(result.current.playerAvatarId).toBe('user_4');
    expect(result.current.displayName).toBe('User_4');
    expect(result.current.gameIdRef.current).toBe(result.current.gameId);
    expect(result.current.gameId).not.toBe(firstGameId);
    expect(result.current.gameSeed).toBe(firstSeed + 1);

    const seeds = [result.current.gameSeed];
    act(() => seeds.push(result.current.beginNextGame().seed));
    act(() => seeds.push(result.current.beginNextGame().seed));
    expect(new Set(seeds).size).toBe(3);
  });
});
