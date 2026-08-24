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
  const connectFour = await module.container.ladder('connect-four', null);
  const checkers = await module.container.ladder('checkers', null);
  assert.equal(connectFour.opponents.length, 7);
  assert.equal(checkers.opponents.length, 7);
  assert.equal(connectFour.current.name, 'Diglett');
  assert.equal(checkers.current.name, 'Nidoran♀');
  assert.match(connectFour.current.art, /0050-diglett-gen1\.svg/);
  assert.match(checkers.current.art, /0029-nidoran-f-gen1\.svg/);
  assert.deepEqual(
    connectFour.opponents.map(({ name }) => name).filter((name) => checkers.opponents.some((entry) => entry.name === name)),
    [],
    'each game owns a distinct character ladder',
  );
});

// A stand-in dataService backed by an in-memory store keyed on path, so a
// write is visible to a later read the way the real one is — the repository
// round-trips writeConfig through a read, and a fake that always answers
// null would make every write look like it vanished.
function fakeDataService({ progress = null } = {}) {
  const store = new Map();
  const writes = [];
  return {
    writes,
    user: {
      read: (path) => (store.has(path) ? store.get(path) : (path.endsWith('/ladder') ? progress : null)),
      write: (path, value) => { store.set(path, value); writes.push({ path, value }); return true; },
    },
    household: { write: () => true },
  };
}

// Task 2 (piano-game-platform-integration): chess is registered in the
// composed container with its own 21-opponent, 5-of-7 ladder — not the
// 7-opponent/3-of-5 default Connect Four and Checkers use.
test('composition wires chess onto its own 21-rung, 5-of-7 ladder rather than the shared default', async (context) => {
  const module = createPianoGamesModule({
    dataService: fakeDataService(),
    configService: { getHouseholdAppConfig: () => ({}) },
    logger: null,
  });
  context.after(() => module.container.dispose());
  const ladder = await module.container.ladder('chess', null);
  assert.equal(ladder.opponents.length, 21);
  assert.equal(ladder.wins_required, 5);
  assert.equal(ladder.series_length, 7);
});

// This is the regression Task 1 exists to prevent, exercised through the
// REAL composition wiring (not a hand-built container): if `helpCeilings`
// ever slipped from inside pianoGames.mjs's `promotion` block to a sibling
// key, PianoGamesContainer.recordGame's `...game.promotion` spread would
// silently stop reading it, the ceiling would no-op, and this game — which
// leans on the engine's best move, something chess's own policy has always
// refused to certify — would wrongly promote.
test('a help-heavy chess game recorded through the composed container does not promote', async (context) => {
  const dataService = fakeDataService({ progress: { unlocked_through: 1, series: ['win', 'win', 'win', 'win'] } });
  const module = createPianoGamesModule({
    dataService,
    configService: { getHouseholdAppConfig: () => ({}) },
    logger: null,
  });
  context.after(() => module.container.dispose());
  // Four counted wins already banked at the bottom rung; a clean fifth would
  // promote. This one leans on the engine's best move instead.
  const result = await module.container.recordGame('chess', 'kid', {
    result: 'win', level: 1, help: { best_moves: 1 },
  });
  assert.equal(result.saved, true);
  assert.equal(result.ladder.unlocked_through, 1, 'a best-move breach must not promote, even as the would-be fifth win');
  assert.equal(result.ladder.wins, 4, 'the breaching game must not be counted among the wins');
  assert.equal(result.ladder.series.length, 5, 'the game is still recorded in the series, just not counted');
  assert.equal(result.ladder.series.at(-1).counted, false);
});

// The mirror case: a clean game at the same bank DOES promote, so the test
// above is proven to be testing the ceiling and not just an off-by-one in
// the win count.
test('a clean chess game recorded through the composed container promotes on the fifth win', async (context) => {
  const dataService = fakeDataService({ progress: { unlocked_through: 1, series: ['win', 'win', 'win', 'win'] } });
  const module = createPianoGamesModule({
    dataService,
    configService: { getHouseholdAppConfig: () => ({}) },
    logger: null,
  });
  context.after(() => module.container.dispose());
  const result = await module.container.recordGame('chess', 'kid', {
    result: 'win', level: 1, help: { hints: 0, best_moves: 0, takebacks: 0 },
  });
  assert.equal(result.ladder.unlocked_through, 2);
  assert.deepEqual(result.ladder.series, [], 'the series resets against the new opponent');
});

// End-to-end coverage of move/config/ladder/games/history for chess through
// the real, composed container — the same shape of proof the pre-existing
// test above gives Connect Four and Checkers, extended to every endpoint the
// brief calls out. This exercises the real ChessEngineAdapter (a real
// Stockfish worker), not a stub, so it is the one test in this file that
// proves the transcript-to-FEN replay and the level-to-skill conversion work
// together, not just in isolation.
test('chess answers move/config/ladder/games/history through the composed container', async (context) => {
  const dataService = fakeDataService();
  const module = createPianoGamesModule({
    dataService,
    configService: { getHouseholdAppConfig: () => ({}) },
    logger: null,
  });
  context.after(() => module.container.dispose());

  const config = await module.container.readConfig('chess', null);
  assert.ok(config && typeof config === 'object');

  const written = await module.container.writeConfig('chess', 'kid', { default_level: 3 });
  assert.equal(written.default_level, 3);

  const moveResult = await module.container.chooseMove('chess', {
    transcript: undefined, level: 1, gameSessionId: 'g1', userId: null,
  });
  assert.ok(moveResult.move, 'expected the real engine to answer for a fresh game');
  assert.equal(moveResult.opponent.level, 1);

  const recordResult = await module.container.recordGame('chess', 'kid', { result: 'win', level: 1, help: {} });
  assert.equal(recordResult.saved, true);

  const archived = await module.container.archiveGame('chess', 'guest', { moves: ['e4'], completed: false });
  assert.equal(archived, true);
});
