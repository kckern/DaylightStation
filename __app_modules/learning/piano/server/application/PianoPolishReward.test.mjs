// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PianoPieceLog } from './PianoPieceLog.mjs';
import { PianoPolishReward, judgePolishRun } from './PianoPolishReward.mjs';
import { createCoachPlan } from '#shared/music/learnCoach.mjs';

const SCORE = 'files:sheets/fur-elise.mxl';
const KEY = 'files-sheets-fur-elise-mxl';
const memory = (entries = []) => ({ entries, list: () => [...entries], append: (_user, entry) => { entries.push(entry); return true; } });
const clock = () => new Date('2026-11-19T20:00:00Z');
const gold = { at: '2026-11-18T20:00:00.000Z', scoreId: SCORE, level: 'gold', passages: 4 };
const run = (over = {}) => ({
  scoreId: SCORE, tempoMult: 0.6, metronome: true, completed: true, mixed: false,
  parts: [0, 1], activeParts: [0, 1], base: 96, allGreen: true, ...over,
});

// A coached record with every unit below the top join Gold: the score-tempo step earned on each (the
// final join has none, its timed play is Polish). `except` leaves one unit unplayed.
function goldRecord(ranges, { parts = ['rh', 'lh'], except = null } = {}) {
  const plan = createCoachPlan({ scoreId: SCORE, fingerprint: 'sha',
    segments: ranges.map(([start, end]) => ({ id: `m${start}-${end}`, inMeasure: start, outMeasure: end, playableParts: parts })) });
  const achievements = Object.fromEntries(plan.tasks.filter((task) => task.mastery && task.passageId !== except)
    .map((task) => [task.key, { at: '2026-11-10T00:00:00Z', provenance: 'demonstrated' }]));
  const summary = { total: ranges.length, silver: ranges.length, gold: ranges.length,
    passages: ranges.map(([start, end]) => ({ id: `m${start}-${end}`, start, end, parts, silver: 'x', gold: 'x' })) };
  return { fingerprint: { contentSha256: 'sha' },
    learnCoach: { version: 1, scoreId: SCORE, fingerprint: 'sha', revision: 1, achievements, counts: {}, evidence: [], reviews: {}, resume: null, summary } };
}
const READY = goldRecord([[0, 3], [4, 7]]);

function setup({ entries = [], record = READY, learnSegments } = {}) {
  const store = memory(entries);
  const logs = [];
  const logger = { info: (event, data) => logs.push([event, data]), warn: (event, data) => logs.push([event, data]) };
  const reward = new PianoPolishReward({ pieceLog: new PianoPieceLog({ store, clock }), logger, ...(learnSegments ? { learnSegments } : {}) });
  const evaluate = (r, userId = 'kid') => reward.evaluate({ userId, scoreKey: KEY, run: r, record });
  return { store, logs, evaluate };
}

describe('judgePolishRun (pure qualification)', () => {
  it('an all-green whole-piece metronome run is marked at each tempo it reaches, and earns the diamond at score tempo', () => {
    expect(judgePolishRun(run({ tempoMult: 0.5 }))).toMatchObject({ reason: 'qualified', gem: false, diamond: false, marks: [50], tempoPercent: 50 });
    expect(judgePolishRun(run({ tempoMult: 0.75 }))).toMatchObject({ diamond: false, marks: [50, 75] });
    expect(judgePolishRun(run({ tempoMult: 1 }))).toMatchObject({ diamond: true, marks: [50, 75], tempoPercent: 100 });
    expect(judgePolishRun(run({ tempoMult: 1.25 }))).toMatchObject({ diamond: true });
  });

  it('draws the lines at all green, tempo 50% and score tempo', () => {
    expect(judgePolishRun(run({ allGreen: false }))).toMatchObject({ reason: 'not-all-green', diamond: false, marks: [] });
    expect(judgePolishRun(run({ allGreen: undefined })).reason).toBe('not-all-green');
    expect(judgePolishRun(run({ tempoMult: 0.49 }))).toMatchObject({ reason: 'slow-tempo', diamond: false, marks: [] });
    expect(judgePolishRun(run({ tempoMult: 0.99 }))).toMatchObject({ diamond: false, marks: [50, 75] });
  });

  it('a run off the metronome, on one hand, unfinished or at mixed tempo earns nothing', () => {
    expect(judgePolishRun(run({ metronome: false })).reason).toBe('metronome-off');
    expect(judgePolishRun(run({ activeParts: [0] })).reason).toBe('one-hand');
    expect(judgePolishRun(run({ parts: [0, 1, 2] })).reason).toBe('one-hand');
    expect(judgePolishRun(run({ completed: false })).reason).toBe('incomplete');
    expect(judgePolishRun(run({ mixed: true })).reason).toBe('incomplete');
    expect(judgePolishRun(run({ base: 'x' })).reason).toBe('invalid-run');
    expect(judgePolishRun(run({ parts: [] })).reason).toBe('invalid-run');
    expect(judgePolishRun(null).reason).toBe('invalid-run');
  });

  it('a single-staff piece has one part, and that part played is every hand', () => {
    expect(judgePolishRun(run({ parts: [0], activeParts: [0] })).reason).toBe('qualified');
  });
});

describe('PianoPolishReward', () => {
  it('marks each tempo once, dated, and logs piano.polish.reward', () => {
    const { store, logs, evaluate } = setup();
    expect(evaluate(run({ tempoMult: 0.75 }))).toMatchObject({ reason: 'qualified', gem: false, diamond: false, newGem: false, newDiamond: false, marks: [50, 75] });
    expect(store.entries.map((e) => e.level)).toEqual(['polish-mark-50', 'polish-mark-75']);
    expect(store.entries[0]).toEqual({ at: '2026-11-19T20:00:00.000Z', scoreId: SCORE, level: 'polish-mark-50', passages: null, fingerprint: 'sha', tempoPercent: 75, score: 96 });
    evaluate(run({ tempoMult: 0.75 }));
    expect(store.entries).toHaveLength(2);
    expect(logs.find(([event]) => event === 'piano.polish.reward')[1]).toEqual({
      userId: 'kid', scoreId: SCORE, tier: 'slow', tempoPercent: 75, score: 96, reason: 'qualified',
      gem: false, diamond: false, newGem: false, newDiamond: false, marks: [50, 75],
    });
  });

  it('earns the diamond at score tempo, once, and awards no new gem', () => {
    const { store, evaluate } = setup();
    expect(evaluate(run({ tempoMult: 1 }))).toMatchObject({ gem: false, diamond: true, newGem: false, newDiamond: true });
    expect(store.entries.map((e) => e.level)).toEqual(['polish-mark-50', 'polish-mark-75', 'polish-diamond']);
    expect(evaluate(run({ tempoMult: 1 }))).toMatchObject({ diamond: true, newDiamond: false });
    expect(store.entries).toHaveLength(3);
  });

  it('a gem or diamond the piece already holds stays held, whatever the run', () => {
    const held = [{ at: '2026-10-01T00:00:00.000Z', scoreId: SCORE, level: 'polish-gem' }, { at: '2026-10-02T00:00:00.000Z', scoreId: SCORE, level: 'polish-diamond' }];
    const { evaluate } = setup({ entries: held });
    expect(evaluate(run({ tempoMult: 0.6 }))).toMatchObject({ gem: true, diamond: true, newGem: false, newDiamond: false });
  });

  it('nothing is earned until every unit below the top join is Gold', () => {
    const missing = goldRecord([[0, 3], [4, 7]], { except: 'm4-7' });
    const { store, evaluate } = setup({ record: missing });
    expect(evaluate(run({ tempoMult: 1 }))).toMatchObject({ reason: 'polish-locked', gem: false, diamond: false, newDiamond: false });
    expect(store.entries).toHaveLength(0);
    const other = { learnCoach: { ...READY.learnCoach, scoreId: 'files:other.mxl' } };
    expect(setup({ record: other }).evaluate(run()).reason).toBe('polish-locked');
  });

  it('with four passages a join below the top must be Gold too, and the top join need not be', () => {
    const ranges = [[0, 3], [4, 7], [8, 11], [12, 15]];
    const plan = createCoachPlan({ scoreId: SCORE, fingerprint: 'sha', segments: ranges.map(([start, end]) => ({ id: `m${start}-${end}`, inMeasure: start, outMeasure: end, playableParts: ['rh', 'lh'] })) });
    const passagesOnly = goldRecord(ranges);
    const withoutJoins = { ...passagesOnly, learnCoach: { ...passagesOnly.learnCoach, achievements: Object.fromEntries(Object.entries(passagesOnly.learnCoach.achievements)
      .filter(([key]) => plan.tasks.find((task) => task.key === key)?.passageId.startsWith('m'))) } };
    expect(setup({ record: withoutJoins }).evaluate(run()).reason).toBe('polish-locked');
    expect(setup({ record: passagesOnly }).evaluate(run()).reason).toBe('qualified');
  });

  it('a guest, or a run naming a different piece, earns nothing', () => {
    const { store, evaluate } = setup();
    expect(evaluate(run(), 'guest').reason).toBe('guest');
    expect(evaluate(run({ scoreId: 'files:other.mxl' })).reason).toBe('wrong-score');
    expect(store.entries).toHaveLength(0);
  });

  it('an unreadable piece log earns nothing and never throws', () => {
    const logs = [];
    const reward = new PianoPolishReward({
      pieceLog: new PianoPieceLog({ store: { list: () => { throw new Error('bad yaml'); }, append: () => true }, clock }),
      logger: { info: () => {}, warn: (event, data) => logs.push([event, data]) },
    });
    expect(reward.evaluate({ userId: 'kid', scoreKey: KEY, run: run(), record: {} })).toMatchObject({ reason: 'log-unavailable', gem: false, newGem: false });
    expect(logs[0][0]).toBe('piano.polish.reward-failed');
  });
});

describe('PianoPolishReward with approved Learn segments', () => {
  const evaluateWith = (record, learnSegments) => {
    const calls = [];
    const reward = new PianoPolishReward({ pieceLog: new PianoPieceLog({ store: memory([]), clock }), logger: null,
      ...(learnSegments ? { learnSegments: (id, sha) => { calls.push([id, sha]); return learnSegments(id, sha); } } : {}) });
    return { result: reward.evaluate({ userId: 'kid', scoreKey: KEY, run: run(), record }), calls };
  };

  it('a changed passage means Polish is not open', () => {
    const { result, calls } = evaluateWith(goldRecord([[0, 3], [4, 7]]), () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }]);
    expect(result.reason).toBe('polish-locked');
    expect(calls).toEqual([[SCORE, 'sha']]);
  });

  it('approved ranges the child already holds Gold on still qualify', () => {
    const { result } = evaluateWith(goldRecord([[0, 3], [4, 7]]), () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
    expect(result).toMatchObject({ reason: 'qualified', marks: [50] });
  });

  it('a one-hand piece qualifies on unchanged ranges and not after a re-cut', () => {
    const record = goldRecord([[0, 3], [4, 7]], { parts: ['rh'] });
    expect(evaluateWith(record, () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]).result.reason).toBe('qualified');
    expect(evaluateWith(record, () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }]).result.reason).toBe('polish-locked');
  });

  it('without approved segments the saved summary decides', () => {
    expect(evaluateWith(goldRecord([[0, 3], [4, 7]]), () => null).result.reason).toBe('qualified');
    expect(evaluateWith(goldRecord([[0, 3], [4, 7]])).result.reason).toBe('qualified');
  });
});

describe('PianoPolishReward.holdings (what a piece already holds)', () => {
  const entry = (level, scoreId = SCORE) => ({ at: '2026-11-19T20:00:00.000Z', scoreId, level });
  const holdingsOf = (entries, args = { userId: 'kid', scoreKey: KEY }) => {
    const logs = [];
    const reward = new PianoPolishReward({ pieceLog: new PianoPieceLog({ store: memory(entries), clock }), logger: { warn: (event, data) => logs.push([event, data]) } });
    return { result: reward.holdings(args), logs };
  };

  it('reads the gem and diamond the piece log holds for this score key', () => {
    expect(holdingsOf([gold]).result).toEqual({ gem: false, diamond: false });
    expect(holdingsOf([gold, entry('polish-gem')]).result).toEqual({ gem: true, diamond: false });
    expect(holdingsOf([gold, entry('polish-gem'), entry('polish-diamond')]).result).toEqual({ gem: true, diamond: true });
  });

  it('another piece\'s awards and a guest hold nothing', () => {
    expect(holdingsOf([entry('polish-gem', 'files:sheets/other.mxl')]).result).toEqual({ gem: false, diamond: false });
    expect(holdingsOf([entry('polish-gem')], { userId: 'guest', scoreKey: KEY }).result).toEqual({ gem: false, diamond: false });
  });

  it('an unreadable log answers nothing held, and says so', () => {
    const reward = new PianoPolishReward({ pieceLog: { list: () => { throw new Error('disk'); } }, logger: { warn: (event, data) => logs.push([event, data]) } });
    const logs = [];
    expect(reward.holdings({ userId: 'kid', scoreKey: KEY })).toEqual({ gem: false, diamond: false });
    expect(logs[0][0]).toBe('piano.polish.holdings-failed');
  });
});
