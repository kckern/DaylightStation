import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useAddressedBoardGame, userIdOf } from './useAddressedBoardGame.js';
import MatchGateContext from '../../../PianoKiosk/modes/Games/MatchGateContext.js';

function makeClient() {
  return {
    readConfig: vi.fn(async () => null),
    readLadder: vi.fn(async () => null),
    writeConfig: vi.fn(async () => null),
    requestMove: vi.fn(async () => null),
    saveGame: vi.fn(async () => null),
    archiveGame: vi.fn(async () => null),
  };
}

/**
 * Drives the hook and exposes its latest return value to the test.
 *
 * `matchGate` is optional and defaults to ABSENT — no provider at all, which is
 * the office screen's situation and the one every existing test here runs in.
 */
function harness(props, matchGate) {
  const seen = { current: null };
  function Probe(inner) {
    seen.current = useAddressedBoardGame(inner);
    return null;
  }
  const wrap = (element) => (matchGate === undefined
    ? element
    : <MatchGateContext.Provider value={matchGate}>{element}</MatchGateContext.Provider>);
  const view = render(wrap(<Probe {...props} />));
  return {
    seen,
    rerender: (next) => view.rerender(wrap(<Probe {...{ ...props, ...next }} />)),
    unmount: view.unmount,
  };
}

describe('useAddressedBoardGame', () => {
  let client;
  beforeEach(() => { client = makeClient(); });

  it('reads config and ladder once for the mounted player', async () => {
    await act(async () => {
      harness({ gameId: 'checkers', client, currentUser: { id: 'ada' }, defaultConfig: { a: 1 } });
    });
    expect(client.readConfig).toHaveBeenCalledWith('ada');
    expect(client.readLadder).toHaveBeenCalledWith('ada');
  });

  it('treats a guest as no user — a guest plays and is not recorded', async () => {
    let seen;
    await act(async () => { ({ seen } = harness({ gameId: 'checkers', client, currentUser: 'guest' })); });
    expect(seen.current.userId).toBeNull();
    expect(client.readConfig).toHaveBeenCalledWith(null);
  });

  it('saves and archives a finished game exactly once', async () => {
    let seen; let rerender;
    await act(async () => {
      ({ seen, rerender } = harness({
        gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1, 2], result: null,
      }));
    });
    expect(client.saveGame).not.toHaveBeenCalled();

    await act(async () => { rerender({ result: 'win' }); });
    expect(client.saveGame).toHaveBeenCalledTimes(1);
    expect(client.archiveGame).toHaveBeenCalledTimes(1);
    expect(client.saveGame.mock.calls[0][1]).toMatchObject({ result: 'win', completed: true, ranked: true });

    // A re-render with the same finished state must not file the game twice.
    await act(async () => { rerender({ result: 'win' }); });
    expect(client.saveGame).toHaveBeenCalledTimes(1);
    expect(seen.current.userId).toBe('ada');
  });

  it('records a game answered by the local engine as unranked', async () => {
    let seen; let rerender;
    await act(async () => {
      ({ seen, rerender } = harness({ gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1], result: null }));
    });
    await act(async () => { seen.current.noteLocalPractice(); });
    expect(seen.current.localPractice).toBe(true);

    await act(async () => { rerender({ result: 'loss' }); });
    expect(client.saveGame.mock.calls[0][1]).toMatchObject({ ranked: false });
  });

  it('archives an abandoned game on unmount, and only when there was one', async () => {
    let unmount;
    await act(async () => {
      ({ unmount } = harness({ gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1, 2] }));
    });
    await act(async () => { unmount(); });
    expect(client.archiveGame).toHaveBeenCalledTimes(1);
    expect(client.archiveGame.mock.calls[0][0]).toMatchObject({ completed: false, ended_by: 'exit' });

    const fresh = makeClient();
    let unmountEmpty;
    await act(async () => {
      ({ unmount: unmountEmpty } = harness({ gameId: 'checkers', client: fresh, moves: [] }));
    });
    await act(async () => { unmountEmpty(); });
    expect(fresh.archiveGame).not.toHaveBeenCalled();
  });

  it('does not file a game as abandoned just because the player changed', async () => {
    // The bug this covers: keying the unmount effect on `userId` ran its cleanup
    // on a profile switch, archiving a game that was still being played.
    let rerender;
    await act(async () => {
      ({ rerender } = harness({
        gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1, 2],
      }));
    });
    await act(async () => { rerender({ currentUser: { id: 'bo' } }); });
    expect(client.archiveGame).not.toHaveBeenCalled();
  });

  it('does not archive on unmount once the game was already saved', async () => {
    let rerender; let unmount;
    await act(async () => {
      ({ rerender, unmount } = harness({
        gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1], result: null,
      }));
    });
    await act(async () => { rerender({ result: 'win' }); });
    expect(client.archiveGame).toHaveBeenCalledTimes(1);
    await act(async () => { unmount(); });
    expect(client.archiveGame).toHaveBeenCalledTimes(1);
  });

  it('writes a config patch through and merges it locally', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({
        gameId: 'checkers', client, currentUser: { id: 'ada' }, defaultConfig: { shuffle_each_game: false },
      }));
    });
    await act(async () => { seen.current.updateConfig({ shuffle_each_game: true }); });
    expect(seen.current.config.shuffle_each_game).toBe(true);
    expect(client.writeConfig).toHaveBeenCalledWith('ada', { shuffle_each_game: true });
  });

  it('does not persist a guest\'s config', async () => {
    let seen;
    await act(async () => { ({ seen } = harness({ gameId: 'checkers', client, currentUser: null })); });
    await act(async () => { seen.current.updateConfig({ shuffle_each_game: true }); });
    expect(client.writeConfig).not.toHaveBeenCalled();
  });

  it('restart reopens ranking, clears local practice, and issues a new session id', async () => {
    let seen; let rerender;
    await act(async () => {
      ({ seen, rerender } = harness({ gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1], result: null }));
    });
    const first = seen.current.gameSessionId;
    await act(async () => { seen.current.noteLocalPractice(); });
    await act(async () => { rerender({ result: 'loss' }); });
    expect(client.saveGame).toHaveBeenCalledTimes(1);

    await act(async () => { seen.current.restart(); });
    expect(seen.current.localPractice).toBe(false);
    expect(seen.current.gameSessionId).not.toBe(first);

    // The next game is savable again — the one-shot guard reopened.
    await act(async () => { rerender({ result: 'win' }); });
    expect(client.saveGame).toHaveBeenCalledTimes(2);
    expect(client.saveGame.mock.calls[1][1]).toMatchObject({ ranked: true });
  });

  it('hands an ARMED match gate the rematch instead of restarting itself', async () => {
    // D11/D12: a replay is a match boundary, and a match boundary is where the
    // gate stands. The host unmounts the game and mounts the challenge, so
    // resetting local session state here would be both pointless and a lie —
    // the seed and session id it minted would belong to a match nobody played.
    const requestRematch = vi.fn();
    let seen;
    await act(async () => {
      ({ seen } = harness(
        { gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1], result: null },
        { armed: true, requestRematch },
      ));
    });
    const before = seen.current.gameSessionId;
    const seedBefore = seen.current.seed;
    await act(async () => { seen.current.noteLocalPractice(); });

    await act(async () => { seen.current.restart(); });
    expect(requestRematch).toHaveBeenCalledTimes(1);
    expect(seen.current.gameSessionId).toBe(before);
    expect(seen.current.seed).toBe(seedBefore);
    expect(seen.current.localPractice).toBe(true);
  });

  it('restarts itself when the gate is present but UNARMED', async () => {
    const requestRematch = vi.fn();
    let seen;
    await act(async () => {
      ({ seen } = harness(
        { gameId: 'checkers', client, currentUser: { id: 'ada' }, moves: [1], result: null },
        { armed: false, requestRematch },
      ));
    });
    const before = seen.current.gameSessionId;
    await act(async () => { seen.current.restart(); });
    expect(requestRematch).not.toHaveBeenCalled();
    expect(seen.current.gameSessionId).not.toBe(before);
  });

  it('prefers the resolved ladder rung over the configured default', async () => {
    const withLadder = makeClient();
    withLadder.readLadder = vi.fn(async () => ({ unlocked_through: 4, current: { name: 'Pebble' } }));
    let seen;
    await act(async () => {
      ({ seen } = harness({
        gameId: 'checkers', client: withLadder, currentUser: { id: 'ada' }, defaultConfig: { default_level: 1 },
      }));
    });
    expect(seen.current.level).toBe(4);
    expect(seen.current.opponentName).toBe('Pebble');
  });

  it('falls back to the configured default rung when no ladder resolves', async () => {
    let seen;
    await act(async () => {
      ({ seen } = harness({ gameId: 'checkers', client, defaultConfig: { default_level: 2 } }));
    });
    expect(seen.current.level).toBe(2);
    expect(seen.current.opponentName).toBeNull();
  });
});

describe('userIdOf', () => {
  it('accepts a bare id or a profile object', () => {
    expect(userIdOf('ada')).toBe('ada');
    expect(userIdOf({ id: 'ada' })).toBe('ada');
  });

  it('rejects guests, empties and absences', () => {
    expect(userIdOf('guest')).toBeNull();
    expect(userIdOf({ id: 'guest' })).toBeNull();
    expect(userIdOf('')).toBeNull();
    expect(userIdOf(null)).toBeNull();
    expect(userIdOf(undefined)).toBeNull();
  });
});
