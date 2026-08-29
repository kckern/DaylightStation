import { describe, expect, it } from 'vitest';
import { GameRivalryMemoryService } from './GameRivalryMemoryService.mjs';

describe('GameRivalryMemoryService', () => {
  it('isolates games, keeps lifetime totals and seven recent games idempotently', async () => {
    const store = new Map();
    const service = new GameRivalryMemoryService({
      readMemory: (game, user) => store.get(`${game}:${user}`),
      writeMemory: (game, user, value) => { store.set(`${game}:${user}`, structuredClone(value)); return true; },
    });
    for (let index = 0; index < 9; index += 1) {
      await service.recordArchive('checkers', {
        game_id: `g${index}`, user_id: 'kid', completed: true, result: index % 2 ? 'loss' : 'win', level: 1,
        opponent: { id: 'nidoran-f', name: 'Nidoran♀' }, moves: [{ from: 1, to: 2 }],
        dialogue: [{ ply: 2, quip: `Line ${index}` }],
      });
    }
    await service.recordArchive('checkers', { game_id: 'g8', user_id: 'kid', completed: true, result: 'loss', opponent: { id: 'nidoran-f' } });
    const memory = await service.recall('checkers', 'kid', 'nidoran-f');
    expect(memory.record).toEqual({ win: 5, loss: 4, draw: 0 });
    expect(memory.recent).toHaveLength(7);
    expect(memory.recent.at(-1).finalLine).toBe('Line 8');
    expect(await service.recall('connect-four', 'kid', 'nidoran-f')).toBeNull();
  });
});
