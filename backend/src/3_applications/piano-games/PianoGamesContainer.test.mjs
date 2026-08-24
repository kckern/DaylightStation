import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoGamesContainer } from './PianoGamesContainer.mjs';
import { applyGameToProgress, createLadderProgress, DEFAULT_LADDER_POLICY } from '../../../../shared/gaming/rulesets/chess/ladder.mjs';

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
      readProgress: async () => ({ unlockedThrough: 1, series: [{ result: 'win', counted: true }, { result: 'win', counted: true }] }),
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
      readProgress: async () => ({ unlockedThrough: 1, series: [{ result: 'win', counted: true }, { result: 'win', counted: true }] }),
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

// --- Chess promotion parity (Task 2: piano-game-platform-integration) ---
//
// Chess's own promotion arithmetic (shared/gaming/rulesets/chess/ladder.mjs,
// applyGameToProgress/countsTowardPromotion) is still what /api/v1/piano-games/chess/*
// uses today, unchanged by this task. The container's copy of the same
// policy (OpponentLadder + this container's chess registration) has to reach
// the identical counted/promotion decision for the identical game, or a
// player who happened to be routed through the container would be judged by
// different rules than the Piano-native path — invisible
// until a family reports a promotion that "should" have happened, or didn't.
//
// The chess domain numbers levels from 0 (rungForLevel/DEFAULT_ROSTER);
// OpponentLadder numbers them from 1 (see its class comment). "The bottom
// rung" is level 0 on one side of this test and level 1 on the other by
// construction, not by coincidence — that offset IS the thing ChessEngineAdapter
// has to get right, and this test's whole point is to prove the two systems
// still agree once it is applied.

const CHESS_PROMOTION = Object.freeze({
  winsRequired: 5,
  seriesLength: 7,
  helpCeilings: { max_hints: 1, max_best_moves: 0, max_takebacks: 1, unrestricted_below_level: 0 },
});
const CHESS_OPPONENTS_FIXTURE = Array.from({ length: 21 }, (_, index) => ({ name: `Rung ${index}` }));

/** Four clean, counted wins at the bottom rung — chess's own domain path. */
function chessProgressWithFourBankedWins() {
  let progress = createLadderProgress();
  for (let i = 0; i < 4; i += 1) {
    ({ progress } = applyGameToProgress(
      progress,
      { completed: true, result: 'win', level: 0, help: { hints: 0, best_moves: 0, takebacks: 0 } },
      DEFAULT_LADDER_POLICY,
    ));
  }
  return progress;
}

function containerForParity() {
  return new PianoGamesContainer({
    repository: {
      saveRecord: async () => true,
      // Four wins already banked at level 1 — the container's own numbering
      // for the same bottom rung chessProgressWithFourBankedWins() reaches
      // via applyGameToProgress's 0-based level.
      readProgress: async () => ({ unlockedThrough: 1, series: Array.from({ length: 4 }, () => ({ result: 'win', counted: true })) }),
      writeProgress: async () => {},
    },
    games: { chess: { opponents: CHESS_OPPONENTS_FIXTURE, promotion: CHESS_PROMOTION, opponentGateway: {} } },
  });
}

test('promotion parity: a clean fifth win promotes identically through the chess domain path and the container path', async () => {
  const chessProgress = chessProgressWithFourBankedWins();
  const chessOutcome = applyGameToProgress(
    chessProgress,
    { completed: true, result: 'win', level: 0, help: { hints: 0, best_moves: 0, takebacks: 0 } },
    DEFAULT_LADDER_POLICY,
  );
  assert.equal(chessOutcome.promoted, true, 'sanity: the chess domain path itself must promote on this record');

  const container = containerForParity();
  const containerResult = await container.recordGame('chess', 'kid', {
    result: 'win', level: 1, help: { hints: 0, best_moves: 0, takebacks: 0 },
  });
  // unlockedThrough went from 1 to 2 — the container's promoted signal, since
  // recordGame does not return a bare boolean the way applyGameToProgress does.
  assert.equal(containerResult.ladder.unlocked_through, 2, 'the container path must also promote on this record');
});

test('promotion parity: a help-heavy fifth win is not counted, and does not promote, in either path', async () => {
  const chessProgress = chessProgressWithFourBankedWins();
  const chessOutcome = applyGameToProgress(
    chessProgress,
    { completed: true, result: 'win', level: 0, help: { hints: 0, best_moves: 1, takebacks: 0 } },
    DEFAULT_LADDER_POLICY,
  );
  assert.equal(chessOutcome.promoted, false, 'sanity: the chess domain path itself must refuse to promote on this record');
  assert.equal(chessOutcome.progress.results.at(-1).counted, false);

  const container = containerForParity();
  const containerResult = await container.recordGame('chess', 'kid', {
    result: 'win', level: 1, help: { hints: 0, best_moves: 1, takebacks: 0 },
  });
  assert.equal(containerResult.ladder.unlocked_through, 1, 'the container path must also refuse to promote on this record');
  assert.equal(containerResult.ladder.series.at(-1).counted, false);
});
