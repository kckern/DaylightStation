import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

import { DaylightAPI } from '../../../lib/api.mjs';
import {
  fetchChessConfig, requestOpponentMove, requestOpponentQuip, saveChessConfig, saveGameRecord,
} from './chessApi.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('requestOpponentMove', () => {
  it('posts the position and returns the move', async () => {
    DaylightAPI.mockResolvedValue({ from: 'e7', to: 'e5', san: 'e5', engine: 'stockfish' });
    const move = await requestOpponentMove({ fen: 'x', rung: 'learner', level: 0, gameId: 'g1', userId: 'learner4' });
    expect(move).toMatchObject({ from: 'e7', to: 'e5' });
    const [path, data, method] = DaylightAPI.mock.calls[0];
    expect(path).toBe('api/v1/piano-games/chess/move?user=learner4');
    expect(data).toMatchObject({ fen: 'x', rung: 'learner', level: 0, gameId: 'g1' });
    expect(method).toBe('POST');
  });

  it('returns null when the server says the game is over', async () => {
    DaylightAPI.mockResolvedValue({ move: null });
    expect(await requestOpponentMove({ fen: 'x', rung: 'learner', gameId: 'g1' })).toBeNull();
  });

  it('returns null when the request fails so the caller can fall back locally', async () => {
    DaylightAPI.mockRejectedValue(new Error('offline'));
    expect(await requestOpponentMove({ fen: 'x', rung: 'learner', gameId: 'g1' })).toBeNull();
  });

  it('resolves null when the transport never settles, so the local fallback engages', async () => {
    // The kiosk tablet drops WiFi; a stalled fetch must not leave the player on
    // "thinking" forever. The API client owns the deadline.
    vi.useFakeTimers();
    try {
      DaylightAPI.mockReturnValue(new Promise(() => {})); // never settles
      const pending = requestOpponentMove({ fen: 'x', rung: 'learner', gameId: 'g1' });
      await vi.advanceTimersByTimeAsync(10_000);
      // Race against an already-settled sentinel: if `pending` is still hanging,
      // the sentinel wins and the assertion fails fast instead of timing out.
      const result = await Promise.race([pending, Promise.resolve('still-hanging')]);
      expect(result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetchChessConfig', () => {
  it('reads without a data object, so the helper does not promote it to POST', async () => {
    DaylightAPI.mockResolvedValue({ default_rung: 'learner' });
    await fetchChessConfig('learner4');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/piano-games/chess/config?user=learner4');
  });

  it('returns null on failure rather than throwing into render', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    expect(await fetchChessConfig('learner4')).toBeNull();
  });
});

describe('requestOpponentQuip', () => {
  it('posts only the serializable game facts and returns the reaction', async () => {
    DaylightAPI.mockResolvedValue({ eventId: 'g1:1:e4', quip: 'A bold first step.', source: 'ai' });
    const game = { initial_fen: 'start', fen: 'after', moves: ['e4'] };
    const result = await requestOpponentQuip({
      gameId: 'g1', ply: 1, level: 0, playerColor: 'w', game, userId: 'learner4',
    });
    expect(result.quip).toBe('A bold first step.');
    expect(DaylightAPI).toHaveBeenCalledWith(
      'api/v1/piano-games/chess/quip?user=learner4',
      { gameId: 'g1', ply: 1, level: 0, playerColor: 'w', game },
      'POST',
    );
  });

  it('fails open when commentary is offline', async () => {
    DaylightAPI.mockRejectedValue(new Error('offline'));
    expect(await requestOpponentQuip({ gameId: 'g1', ply: 1, game: {} })).toBeNull();
  });
});

describe('saveChessConfig', () => {
  it('PUTs the patch for the user', async () => {
    DaylightAPI.mockResolvedValue({ default_rung: 'steady' });
    await saveChessConfig('learner4', { default_rung: 'steady' });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/piano-games/chess/config?user=learner4', { default_rung: 'steady' }, 'PUT');
  });
});

describe('saveGameRecord', () => {
  it('POSTs the record for the user', async () => {
    DaylightAPI.mockResolvedValue({ saved: true });
    const record = { result: 'win', moves: 24, hints: 3, best_moves: 1, rung: 'steady', duration_ms: 60000 };
    await saveGameRecord('learner4', record);
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/piano-games/chess/games?user=learner4', record, 'POST');
  });

  it('returns null when the request fails rather than throwing', async () => {
    DaylightAPI.mockRejectedValue(new Error('offline'));
    expect(await saveGameRecord('learner4', { result: 'win' })).toBeNull();
  });
});
