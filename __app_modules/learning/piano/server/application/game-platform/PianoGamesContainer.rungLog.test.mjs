import { describe, expect, it } from 'vitest';
import { PianoGamesContainer } from './PianoGamesContainer.mjs';

const opponents = Array.from({ length: 6 }, (_, i) => ({ level: i + 1, name: `Opp ${i + 1}` }));

function harness({ unlockedThrough = 2, series = [], config = {}, rungLog } = {}) {
  let progress = { unlockedThrough, series };
  let userConfig = config;
  const notes = [];
  const repository = {
    readProgress: async () => progress,
    writeProgress: async (_g, _u, next) => { progress = next; return true; },
    readConfig: async () => userConfig,
    writeConfig: async (_g, _u, patch) => {
      userConfig = { ...userConfig, addressing: { ...userConfig.addressing, ...patch.addressing, ladder: { ...userConfig.addressing?.ladder, ...patch.addressing?.ladder } } };
      return true;
    },
    saveRecord: async () => true,
  };
  const game = { opponentGateway: { chooseMove: async () => null }, opponents, promotion: { winsRequired: 1, seriesLength: 1 } };
  const container = new PianoGamesContainer({
    games: { checkers: game, chess: { ...game, levelFromPosition: (p) => p - 1, positionFromLevel: (l) => l + 1 } },
    repository,
    rungLog: rungLog ?? { note: (change) => { notes.push(change); return change; } },
  });
  return { container, notes };
}

describe('PianoGamesContainer rung log', () => {
  it('notes a match-ladder promotion, in the game\'s stored units', async () => {
    const { container, notes } = harness();
    await container.recordGame('checkers', 'kidB', { result: 'win', level: 2, completed: true });
    expect(notes).toEqual([{ userId: 'kidB', game: 'checkers', ladder: 'match', from: 2, to: 3 }]);
    const chess = harness();
    await chess.container.recordGame('chess', 'kidB', { result: 'win', level: 2, completed: true });
    expect(chess.notes).toEqual([{ userId: 'kidB', game: 'chess', ladder: 'match', from: 1, to: 2 }]);
  });

  it('notes nothing when the ladder did not move', async () => {
    const { container, notes } = harness();
    await container.recordGame('checkers', 'kidB', { result: 'loss', level: 2, completed: true });
    expect(notes).toEqual([]);
  });

  it('hands addressing-ladder writes to the log with the value before and after', async () => {
    const { container, notes } = harness({ config: { addressing: { ladder: { unlocked_through: 3 } } } });
    await container.writeConfig('checkers', 'kidB', { addressing: { ladder: { unlocked_through: 4 } } });
    await container.writeConfig('checkers', 'kidB', { addressing: { shuffle: 'each_game' } });
    expect(notes).toEqual([{ userId: 'kidB', game: 'checkers', ladder: 'addressing', from: 3, to: 4 }]);
  });

  it('a throwing rung log never fails the game or the unlock', async () => {
    const { container } = harness({ rungLog: { note: () => { throw new Error('boom'); } } });
    const result = await container.recordGame('checkers', 'kidB', { result: 'win', level: 2, completed: true });
    expect(result.saved).toBe(true);
    expect(result.ladder.unlocked_through).toBe(3);
  });
});
