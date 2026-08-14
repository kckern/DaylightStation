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

// Task 1 (piano-game-platform-integration): OpponentLadder.record() now takes
// help/ranked so a game leaning on too much on-screen help — or played
// against the offline fallback — does not silently certify promotion. This
// container is the only caller of record() today, so it is the thing that
// must actually pass a game's `help` payload through rather than dropping it
// on the floor.
test('threads a recorded game\'s help data through to the ladder, so a ceiling breach is persisted but not counted', async () => {
  let writtenProgress = null;
  const container = new PianoGamesContainer({
    repository: {
      saveRecord: async () => true,
      readProgress: async () => ({ unlockedThrough: 1, series: ['win', 'win'] }),
      writeProgress: async (gameId, userId, progress) => { writtenProgress = progress; },
    },
    games: {
      sample: {
        opponents: [{ name: 'One' }, { name: 'Two' }],
        promotion: { winsRequired: 3, seriesLength: 5, helpCeilings: { max_hints: 1 } },
        opponentGateway: {},
      },
    },
  });
  const result = await container.recordGame('sample', 'kid', { result: 'win', level: 1, help: { hints: 2 } });
  assert.equal(result.saved, true);
  assert.equal(result.ladder.unlocked_through, 1, 'a hint-ceiling breach must not promote, even though this would be the third win');
  assert.ok(writtenProgress, 'the game is still persisted, just not counted toward promotion');
  assert.equal(writtenProgress.series.length, 3);
});
