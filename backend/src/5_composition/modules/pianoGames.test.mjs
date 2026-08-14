import test from 'node:test';
import assert from 'node:assert/strict';
import { createPianoGamesModule } from './pianoGames.mjs';

test('composition registers both native addressed-board server games', async (context) => {
  const module = createPianoGamesModule({
    dataService: {
      user: { read: () => null, write: () => true },
      household: { write: () => true },
    },
    configService: { getHouseholdAppConfig: () => ({}) },
    logger: null,
  });
  context.after(() => module.container.dispose());
  assert.equal((await module.container.ladder('connect-four', null)).opponents.length, 7);
  assert.equal((await module.container.ladder('checkers', null)).opponents.length, 7);
});
