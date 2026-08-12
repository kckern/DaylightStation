import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

import { DaylightAPI } from '../../../lib/api.mjs';
import { fetchChessConfig, requestOpponentMove, saveChessConfig } from './chessApi.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('requestOpponentMove', () => {
  it('posts the position and returns the move', async () => {
    DaylightAPI.mockResolvedValue({ from: 'e7', to: 'e5', san: 'e5', engine: 'stockfish' });
    const move = await requestOpponentMove({ fen: 'x', rung: 'learner', gameId: 'g1', userId: 'felix' });
    expect(move).toMatchObject({ from: 'e7', to: 'e5' });
    const [path, data, method] = DaylightAPI.mock.calls[0];
    expect(path).toBe('api/v1/chess/move?user=felix');
    expect(data).toMatchObject({ fen: 'x', rung: 'learner', gameId: 'g1' });
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
    await fetchChessConfig('felix');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/chess/config?user=felix');
  });

  it('returns null on failure rather than throwing into render', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    expect(await fetchChessConfig('felix')).toBeNull();
  });
});

describe('saveChessConfig', () => {
  it('PUTs the patch for the user', async () => {
    DaylightAPI.mockResolvedValue({ default_rung: 'steady' });
    await saveChessConfig('felix', { default_rung: 'steady' });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/chess/config?user=felix', { default_rung: 'steady' }, 'PUT');
  });
});
