import { describe, expect, it } from 'vitest';
import { createChessResumeService } from './ChessResumeService.mjs';

const NOW = new Date('2026-10-09T15:00:00Z');
const rec = (over = {}) => ({
  game_id: 'g1', user_id: 'kid', ended_at: '2026-10-09T14:00:00Z', completed: false, ended_by: 'in_progress',
  initial_fen: 'X', moves: [{ ply: 1, from: 'e2', to: 'e4', undone: false }], ...over,
});
function setup(config = {}) {
  const files = new Map();
  const service = createChessResumeService({
    readSlot: async (u) => files.get(u) ?? null,
    writeSlot: async (u, s) => { files.set(u, JSON.parse(JSON.stringify(s))); },
    readConfig: async () => config,
    now: () => NOW,
  });
  return { service, files };
}

describe('ChessResumeService', () => {
  it('saves progress and serves it back as resumable', async () => {
    const { service } = setup();
    await service.record(rec());
    const { game, window_days } = await service.resumable('kid');
    expect(game.gameId).toBe('g1');
    expect(window_days).toBe(3);
  });
  it('is idempotent and survives concurrent saves', async () => {
    const { service, files } = setup();
    await Promise.all([service.record(rec()), service.record(rec()), service.record(rec({ game_id: 'g2', moves: [{ ply: 1, from: 'd2', to: 'd4', undone: false }] }))]);
    expect(Object.keys(files.get('kid').games).sort()).toEqual(['g1', 'g2']);
  });
  it('reads resume_max_days from config; 0 is off', async () => {
    const { service } = setup({ resume_max_days: 0 });
    await service.record(rec());
    expect((await service.resumable('kid')).game).toBeNull();
  });
  it('ignores guests', async () => {
    const { service, files } = setup();
    expect((await service.record(rec({ user_id: null }))).applied).toBe(false);
    expect(files.size).toBe(0);
  });
  it('a finished game never comes back; abandon closes an open one', async () => {
    const { service } = setup();
    await service.record(rec());
    await service.record(rec({ completed: true, ended_by: 'game_over' }));
    expect((await service.resumable('kid')).game).toBeNull();
    await service.record(rec({ game_id: 'g3', moves: [{ ply: 1, from: 'c2', to: 'c4', undone: false }] }));
    await service.abandon('kid', 'g3');
    expect((await service.resumable('kid')).game).toBeNull();
  });
});
