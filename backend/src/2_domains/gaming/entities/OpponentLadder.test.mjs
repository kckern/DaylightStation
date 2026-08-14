import test from 'node:test';
import assert from 'node:assert/strict';
import { OpponentLadder } from './OpponentLadder.mjs';

const opponents = Array.from({ length: 7 }, (_, index) => ({ id: `level-${index + 1}`, name: `Level ${index + 1}` }));

test('clamps requested opponents to the unlocked rung', () => {
  const ladder = new OpponentLadder({ opponents, progress: { unlockedThrough: 2 } });
  assert.equal(ladder.resolve(7).level, 2);
});

test('promotes after three wins in a five-game series', () => {
  let ladder = new OpponentLadder({ opponents });
  ladder = ladder.record('win', 1).record('loss', 1).record('win', 1).record('draw', 1).record('win', 1);
  assert.equal(ladder.unlockedThrough, 2);
  assert.deepEqual(ladder.series, []);
});

test('does not promote wins recorded against a lower rung', () => {
  let ladder = new OpponentLadder({ opponents, progress: { unlockedThrough: 3 } });
  ladder = ladder.record('win', 1).record('win', 1).record('win', 1);
  assert.equal(ladder.unlockedThrough, 3);
});

// --- Help ceilings + ranked/unranked (Task 1: piano-game-platform-integration) ---
//
// Chess's ladder (shared/gaming/chess/ladder.mjs) refuses to let a help-heavy
// game promote a player: a game where the engine supplied the best move was
// partly played by the engine, not the child. That policy is being ported here
// so the generic container can carry it once Chess migrates onto it (Task 2) —
// without it, the migration would silently delete the discipline chess already
// enforces. The second half is the mirror image: Connect Four and Checkers
// already flag games played against the offline fallback engine `ranked:
// false` when Wi-Fi drops the real opponent, but the ladder had no way to
// honour that flag, so a lost connection could be laundered into promotion.

test('a ranked:false game never promotes, whatever the result', () => {
  let ladder = new OpponentLadder({ opponents, winsRequired: 3, seriesLength: 5 });
  ladder = ladder
    .record('win', 1, { ranked: false })
    .record('win', 1, { ranked: false })
    .record('win', 1, { ranked: false });
  assert.equal(ladder.unlockedThrough, 1);
});

test('a game breaching any help ceiling never promotes', () => {
  // max_hints: 1 means "one hint is a child orienting themselves"; a second
  // hint on the same game is being carried through it, same rationale as the
  // chess policy this mirrors.
  let ladder = new OpponentLadder({
    opponents, winsRequired: 3, seriesLength: 5,
    helpCeilings: { max_hints: 1 },
  });
  ladder = ladder
    .record('win', 1, { help: { hints: 2 } })
    .record('win', 1, { help: { hints: 2 } })
    .record('win', 1, { help: { hints: 2 } });
  assert.equal(ladder.unlockedThrough, 1);
});

test('a game at or under a help ceiling still counts (breach is strictly greater-than)', () => {
  let ladder = new OpponentLadder({
    opponents, winsRequired: 3, seriesLength: 5,
    helpCeilings: { max_hints: 1 },
  });
  ladder = ladder
    .record('win', 1, { help: { hints: 1 } })
    .record('win', 1, { help: { hints: 1 } })
    .record('win', 1, { help: { hints: 1 } });
  assert.equal(ladder.unlockedThrough, 2);
});

test('unrestricted_below_level exempts levels below it from every ceiling', () => {
  // Convention pin: OpponentLadder levels are 1-based (level 1 is the first
  // opponent), unlike chess's 0-based engine skill levels. `unrestricted_below_level`
  // is read in the ladder's own (1-based) numbering, so a value of 2 exempts
  // only level 1 — the same "teach the game before the discipline" carve-out
  // chess grants its own level 0, expressed in this ladder's indexing. A
  // caller migrating a 0-based policy (Chess, Task 2) must add 1 when porting
  // the number across; this ladder does not do that conversion itself.
  let ladder = new OpponentLadder({
    opponents, winsRequired: 3, seriesLength: 5,
    helpCeilings: { max_hints: 0, unrestricted_below_level: 2 },
  });
  ladder = ladder
    .record('win', 1, { help: { hints: 5 } })
    .record('win', 1, { help: { hints: 5 } })
    .record('win', 1, { help: { hints: 5 } });
  assert.equal(ladder.unlockedThrough, 2);
});

test('unrestricted_below_level does not exempt the level it names, only levels below it', () => {
  let ladder = new OpponentLadder({
    opponents, progress: { unlockedThrough: 2 }, winsRequired: 3, seriesLength: 5,
    helpCeilings: { max_hints: 0, unrestricted_below_level: 2 },
  });
  ladder = ladder
    .record('win', 2, { help: { hints: 5 } })
    .record('win', 2, { help: { hints: 5 } })
    .record('win', 2, { help: { hints: 5 } });
  assert.equal(ladder.unlockedThrough, 2);
});

test('absent helpCeilings reproduces prior behaviour exactly, even with the options arg present', () => {
  let ladder = new OpponentLadder({ opponents, winsRequired: 3, seriesLength: 5 });
  ladder = ladder
    .record('win', 1, {})
    .record('loss', 1, {})
    .record('win', 1, {})
    .record('draw', 1, {})
    .record('win', 1, {});
  assert.equal(ladder.unlockedThrough, 2);
  assert.deepEqual(ladder.series, []);
});

test('the series still holds seriesLength entries, including not-counted games, and resets on promotion', () => {
  let ladder = new OpponentLadder({
    opponents, winsRequired: 3, seriesLength: 5,
    helpCeilings: { max_hints: 1 },
  });
  // Two unranked games first — recorded, not dropped, not counted — pad the
  // series without contributing a win, so the length can be checked before
  // enough *counted* wins exist to promote.
  ladder = ladder
    .record('win', 1, { ranked: false })
    .record('win', 1, { ranked: false });
  assert.equal(ladder.series.length, 2);
  // Two counted results (one win, one loss) fill the series to its cap
  // without reaching winsRequired.
  ladder = ladder.record('win', 1).record('loss', 1);
  assert.equal(ladder.series.length, 4);
  ladder = ladder.record('win', 1);
  assert.equal(ladder.series.length, 5);
  assert.equal(ladder.unlockedThrough, 1, 'two counted wins is not yet winsRequired');
  // A third counted win pushes the window past its cap — the two unranked
  // entries fall off the back, leaving three counted wins in view, which is
  // exactly winsRequired: promotes and resets.
  ladder = ladder.record('win', 1);
  assert.equal(ladder.unlockedThrough, 2);
  assert.deepEqual(ladder.series, []);
});

test('countsToward predicts record() without mutating state, for callers that need to check before playing', () => {
  const ladder = new OpponentLadder({
    opponents, winsRequired: 3, seriesLength: 5,
    helpCeilings: { max_hints: 1 },
  });
  assert.equal(ladder.countsToward(1, { help: { hints: 0 }, ranked: true }), true);
  assert.equal(ladder.countsToward(1, { help: { hints: 2 }, ranked: true }), false);
  assert.equal(ladder.countsToward(1, { help: {}, ranked: false }), false);
  assert.equal(ladder.series.length, 0, 'countsToward must not mutate the ladder');
});
