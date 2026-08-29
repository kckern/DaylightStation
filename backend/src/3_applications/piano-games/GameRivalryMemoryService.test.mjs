import { describe, expect, it, vi } from 'vitest';
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

  it('lazily migrates Chess legacy keys without losing lifetime results', async () => {
    let migrated = null;
    const legacy = {
      version: 1,
      rivals: {
        'level-0:pip': {
          opponent: { level: 0, name: 'Pip' },
          games: Array.from({ length: 9 }, (_, index) => ({
            gameId: `old-${index}`, endedAt: `2026-08-${String(index + 1).padStart(2, '0')}`,
            result: index < 6 ? 'win' : 'loss', finalLine: `Line ${index}`,
          })),
        },
      },
    };
    const service = new GameRivalryMemoryService({
      readMemory: () => null,
      readLegacy: () => legacy,
      writeMemory: (_game, _user, value) => { migrated = structuredClone(value); return true; },
    });
    const recalled = await service.recall('chess', 'kid', 'chess:level-1');
    expect(recalled.record).toEqual({ win: 6, loss: 3, draw: 0 });
    expect(recalled.recent).toHaveLength(7);
    expect(migrated.rivals['chess:level-1'].opponent.name).toBe('Pip');
  });

  it('extracts game-specific notable facts and fails open on memory write errors', async () => {
    const logger = { warn: vi.fn() };
    const service = new GameRivalryMemoryService({
      readMemory: () => null,
      writeMemory: () => { throw new Error('disk full'); },
      notableFacts: { checkers: () => ['3 captures', 'promotion'] },
      logger,
    });
    const saved = await service.recordArchive('checkers', {
      game_id: 'g1', user_id: 'kid', completed: true, result: 'win',
      opponent: { id: 'nidoran-f', name: 'Nidoran♀' }, moves: [{}],
    });
    expect(saved).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('piano-game.rivalry.write-failed', expect.objectContaining({ opponentId: 'nidoran-f' }));
  });
});
