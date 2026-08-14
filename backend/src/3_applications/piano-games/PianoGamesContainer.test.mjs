import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoGamesContainer } from './PianoGamesContainer.mjs';

test('application clamps a move request before invoking its game gateway', async () => {
  let received;
  const repository = {
    readProgress: async () => ({ unlockedThrough: 2 }),
  };
  const container = new PianoGamesContainer({
    repository,
    games: {
      sample: {
        opponents: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }],
        promotion: { winsRequired: 3, seriesLength: 5 },
        opponentGateway: { chooseMove: async (request) => { received = request; return { column: 3 }; } },
      },
    },
  });
  const result = await container.chooseMove('sample', { level: 99, userId: 'kid' });
  assert.equal(received.level, 2);
  assert.equal(result.opponent.opponent.name, 'Two');
});

test('records client-fallback games without advancing ranked progress', async () => {
  let wroteProgress = false;
  const container = new PianoGamesContainer({
    repository: {
      saveRecord: async () => true,
      readProgress: async () => ({ unlockedThrough: 1, series: ['win', 'win'] }),
      writeProgress: async () => { wroteProgress = true; },
    },
    games: {
      sample: {
        opponents: [{ name: 'One' }, { name: 'Two' }],
        promotion: { winsRequired: 3, seriesLength: 5 },
        opponentGateway: {},
      },
    },
  });
  const result = await container.recordGame('sample', 'kid', { result: 'win', level: 1, ranked: false });
  assert.equal(result.saved, true);
  assert.equal(result.ladder.unlocked_through, 1);
  assert.equal(wroteProgress, false);
});
