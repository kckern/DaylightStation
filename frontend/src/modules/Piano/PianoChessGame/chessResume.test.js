import { describe, expect, it } from 'vitest';
import { chooseResumeSource, replayArchivedGame } from './chessResume.js';
import incident from '@shared-gaming/rulesets/chess/__fixtures__/incident-74ply.json';

describe('replayArchivedGame', () => {
  it('rebuilds the exact final position of the real 74-ply incident game', () => {
    const result = replayArchivedGame(incident);
    expect(result.ok).toBe(true);
    expect(result.moves).toHaveLength(74);
    expect(result.finalFen).toBe('4Q2B/8/8/3k4/7P/2R5/P1P2P2/RN2KBN1 w - - 3 38');
    expect(result.fenMatches).toBe(true);
    expect(result.gameOver).toBe(false);
  });
  it('skips taken-back moves', () => {
    const record = { initial_fen: undefined, moves: [
      { ply: 1, san: 'e4', from: 'e2', to: 'e4', undone: true },
      { ply: 1, san: 'd4', from: 'd2', to: 'd4', undone: false },
    ] };
    expect(replayArchivedGame(record).moves).toEqual([{ from: 'd2', to: 'd4', promotion: 'q' }]);
  });
  it('refuses a record that does not replay', () => {
    expect(replayArchivedGame({ moves: [{ ply: 1, san: 'e5', from: 'e2', to: 'e5', undone: false }] }))
      .toMatchObject({ ok: false, reason: 'illegal-move', ply: 1 });
    expect(replayArchivedGame({ moves: [] }).ok).toBe(false);
  });
  it('reads the promotion piece back out of the SAN', () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const r = replayArchivedGame({ initial_fen: fen, moves: [{ ply: 1, san: 'a8=N', from: 'a7', to: 'a8', undone: false }] });
    expect(r.moves[0].promotion).toBe('n');
  });
});

describe('chooseResumeSource', () => {
  const HOUR = 3600e3;
  const local = (over = {}) => ({ present: true, unreadable: false, finished: false, idleMs: HOUR, maxIdleMs: 6 * HOUR, ...over });
  const server = (over = {}) => ({ window_days: 3, game: { game_id: 'g', pinned: false }, ...over });

  it('a fresh local checkpoint is unchanged behaviour', () => {
    expect(chooseResumeSource({ local: local(), server: server() })).toEqual({ source: 'local', discardLocal: null });
  });
  it('a pinned server game beats even a fresh local checkpoint, and says why', () => {
    expect(chooseResumeSource({ local: local(), server: server({ game: { game_id: 'g', pinned: true } }) }))
      .toEqual({ source: 'server', discardLocal: 'pinned-server-game' });
  });
  it('the incident: a 12.7h-idle checkpoint defers to the server copy', () => {
    expect(chooseResumeSource({ local: local({ idleMs: 12.7 * HOUR }), server: server() }))
      .toEqual({ source: 'server', discardLocal: 'stale-server-copy-exists' });
  });
  it('a stale checkpoint is KEPT when the server copy cannot be confirmed', () => {
    expect(chooseResumeSource({ local: local({ idleMs: 12.7 * HOUR }), server: null }))
      .toMatchObject({ source: 'local', discardLocal: null, keptStale: 'server-unreachable' });
    expect(chooseResumeSource({ local: local({ idleMs: 12.7 * HOUR }), server: { game: null, window_days: 3 } }))
      .toMatchObject({ source: 'local', discardLocal: null, keptStale: 'no-server-copy' });
  });
  it('a checkpoint older than the whole window is the month-old board, and is set aside', () => {
    expect(chooseResumeSource({ local: local({ idleMs: 30 * 24 * HOUR }), server: { game: null, window_days: 3 } }))
      .toEqual({ source: 'new', discardLocal: 'beyond-resume-window' });
  });
  it('no local checkpoint: the server game, else a new one', () => {
    expect(chooseResumeSource({ local: { present: false }, server: server() }).source).toBe('server');
    expect(chooseResumeSource({ local: { present: false }, server: { game: null } }).source).toBe('new');
    expect(chooseResumeSource({ local: { present: false }, server: null }).source).toBe('new');
  });
  it('a finished local game is discarded for the server copy or a new game', () => {
    expect(chooseResumeSource({ local: local({ finished: true }), server: null }))
      .toEqual({ source: 'new', discardLocal: 'finished' });
    expect(chooseResumeSource({ local: local({ finished: true }), server: server() }).source).toBe('server');
  });
});

describe('a local checkpoint only beats an open server game if it continues it', () => {
  const server = { game: { pinned: false }, window_days: 3 };
  const local = (over) => ({ present: true, unreadable: false, finished: false, idleMs: 1000, maxIdleMs: 6e6, ...over });
  it('diverging local loses to the server game', () => {
    expect(chooseResumeSource({ local: local({ continuesServer: false }), server }))
      .toEqual({ source: 'server', discardLocal: 'diverges-from-server-game' });
  });
  it('continuing local still wins', () => {
    expect(chooseResumeSource({ local: local({ continuesServer: true }), server }).source).toBe('local');
  });
});
