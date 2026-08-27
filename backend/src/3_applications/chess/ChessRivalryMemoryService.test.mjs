import { describe, expect, it, vi } from 'vitest';
import {
  createChessRivalryMemoryService, rivalryKey, summarizeArchive,
} from './ChessRivalryMemoryService.mjs';

function archive(overrides = {}) {
  return {
    game_id: 'game-1', user_id: 'learner4', completed: true, ended_by: 'game_over',
    result: 'win', outcome: 'checkmate', move_count: 5, ended_at: '2026-08-26T23:00:00.000Z',
    opponent: { level: 1, name: 'Weedle' },
    moves: [
      { ply: 1, san: 'e4', color: 'w' },
      { ply: 2, san: 'd5', color: 'b' },
      { ply: 3, san: 'exd5', color: 'w', captured: 'p' },
      { ply: 4, san: 'Qxd5+', color: 'b', captured: 'p' },
      { ply: 5, san: 'Qh5#', color: 'w' },
    ],
    commentary: { final_line: 'You found the finish.' },
    ...overrides,
  };
}

describe('ChessRivalryMemoryService', () => {
  it('keeps only compact factual summaries and exposes recent rivalry context', async () => {
    let memory = null;
    const service = createChessRivalryMemoryService({
      readMemory: vi.fn(() => memory),
      writeMemory: vi.fn((_, next) => { memory = structuredClone(next); return true; }),
    });
    await service.recordArchive(archive());
    const recalled = await service.recall('learner4', { level: 1, name: 'Weedle' });
    expect(recalled).toMatchObject({ games: 1, record: { win: 1, loss: 0, draw: 0 } });
    expect(recalled.recent[0]).toMatchObject({ finalMove: { san: 'Qh5#', kind: 'checkmate' }, finalLine: 'You found the finish.' });
    expect(memory.rivals[rivalryKey({ level: 1, name: 'Weedle' })].games[0].moves).toBe(5);
  });

  it('is idempotent by game id and ignores unfinished or anonymous archives', async () => {
    let memory = null;
    const service = createChessRivalryMemoryService({
      readMemory: () => memory,
      writeMemory: (_, next) => { memory = structuredClone(next); return true; },
    });
    await service.recordArchive(archive());
    await service.recordArchive(archive({ result: 'loss' }));
    expect((await service.recall('learner4', { level: 1, name: 'Weedle' })).record).toEqual({ win: 0, loss: 1, draw: 0 });
    expect(await service.recordArchive(archive({ game_id: 'guest', user_id: null }))).toBe(false);
    expect(await service.recordArchive(archive({ game_id: 'left', completed: false }))).toBe(false);
  });

  it('summarizes terminal and notable moves without keeping raw history', () => {
    expect(summarizeArchive(archive()).highlights.map((move) => move.san)).toEqual(['Qh5#', 'Qxd5+', 'exd5']);
  });
});
