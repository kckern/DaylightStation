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
  parts: [0, 1], activeParts: [0, 1], base: 96, ...over,
});

function setup({ entries = [gold], record = { fingerprint: { contentSha256: 'sha' } } } = {}) {
  const store = memory(entries);
  const logs = [];
  const logger = { info: (event, data) => logs.push([event, data]), warn: (event, data) => logs.push([event, data]) };
  const reward = new PianoPolishReward({ pieceLog: new PianoPieceLog({ store, clock }), logger });
  const evaluate = (r, userId = 'kid') => reward.evaluate({ userId, scoreKey: KEY, run: r, record });
  return { store, logs, evaluate };
}

describe('judgePolishRun (pure qualification)', () => {
  it('a near-perfect whole-piece metronome run on every hand qualifies by tempo', () => {
    expect(judgePolishRun(run({ tempoMult: 0.5 }))).toMatchObject({ reason: 'qualified', gem: true, diamond: false, tempoPercent: 50, score: 96 });
    expect(judgePolishRun(run({ tempoMult: 0.9 }))).toMatchObject({ reason: 'qualified', gem: true, diamond: true, tempoPercent: 90 });
    expect(judgePolishRun(run({ tempoMult: 1.25 }))).toMatchObject({ gem: true, diamond: true });
  });

  it('draws the lines at score 95, tempo 50% and tempo 90%', () => {
    expect(judgePolishRun(run({ base: 94 }))).toMatchObject({ reason: 'low-score', gem: false, diamond: false });
    expect(judgePolishRun(run({ base: 95 }))).toMatchObject({ reason: 'qualified', gem: true });
    expect(judgePolishRun(run({ tempoMult: 0.49 }))).toMatchObject({ reason: 'slow-tempo', gem: false, diamond: false });
    expect(judgePolishRun(run({ tempoMult: 0.89 }))).toMatchObject({ gem: true, diamond: false });
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
  it('notes the gem once per piece, dated, and logs piano.polish.reward', () => {
    const { store, logs, evaluate } = setup();
    expect(evaluate(run())).toMatchObject({ reason: 'qualified', gem: true, diamond: false, newGem: true, newDiamond: false });
    expect(store.entries.at(-1)).toEqual({ at: '2026-11-19T20:00:00.000Z', scoreId: SCORE, level: 'polish-gem', passages: null, fingerprint: 'sha', tempoPercent: 60, score: 96 });
    expect(evaluate(run())).toMatchObject({ gem: true, newGem: false });
    expect(store.entries.filter((e) => e.level === 'polish-gem')).toHaveLength(1);
    expect(logs.find(([event]) => event === 'piano.polish.reward')[1]).toEqual({
      userId: 'kid', scoreId: SCORE, tier: 'slow', tempoPercent: 60, score: 96, reason: 'qualified',
      gem: true, diamond: false, newGem: true, newDiamond: false,
    });
  });

  it('a diamond run also grants the gem when it is not yet earned', () => {
    const { store, evaluate } = setup();
    expect(evaluate(run({ tempoMult: 1 }))).toMatchObject({ gem: true, diamond: true, newGem: true, newDiamond: true });
    expect(store.entries.map((e) => e.level)).toEqual(['gold', 'polish-gem', 'polish-diamond']);
    expect(evaluate(run({ tempoMult: 1 }))).toMatchObject({ gem: true, diamond: true, newGem: false, newDiamond: false });
  });

  it('a later gem-tempo run reports the diamond already held without noting anything', () => {
    const { store, evaluate } = setup();
    evaluate(run({ tempoMult: 0.95 }));
    expect(evaluate(run({ tempoMult: 0.6 }))).toMatchObject({ gem: true, diamond: true, newGem: false, newDiamond: false });
    expect(store.entries).toHaveLength(3);
  });

  it('nothing is earned before the piece is all Gold', () => {
    const { store, evaluate } = setup({ entries: [{ ...gold, level: 'silver' }] });
    expect(evaluate(run({ tempoMult: 1 }))).toMatchObject({ reason: 'not-all-gold', gem: false, diamond: false, newGem: false, newDiamond: false });
    expect(store.entries).toHaveLength(1);
  });

  it('a piece all Gold on the saved coach summary counts when the log predates it', () => {
    const record = { learnCoach: { scoreId: SCORE, summary: { total: 4, silver: 4, gold: 4 } } };
    expect(setup({ entries: [], record }).evaluate(run())).toMatchObject({ reason: 'qualified', newGem: true });
    const partial = { learnCoach: { scoreId: SCORE, summary: { total: 4, silver: 4, gold: 3 } } };
    expect(setup({ entries: [], record: partial }).evaluate(run()).reason).toBe('not-all-gold');
    const other = { learnCoach: { scoreId: 'files:other.mxl', summary: { total: 4, gold: 4 } } };
    expect(setup({ entries: [], record: other }).evaluate(run()).reason).toBe('not-all-gold');
  });

  it('a guest, or a run naming a different piece, earns nothing', () => {
    const { store, evaluate } = setup();
    expect(evaluate(run(), 'guest').reason).toBe('guest');
    expect(evaluate(run({ scoreId: 'files:other.mxl' })).reason).toBe('wrong-score');
    expect(store.entries).toHaveLength(1);
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

// A coached record all Gold on `ranges`: the score-tempo step earned on each.
function goldRecord(ranges) {
  const plan = createCoachPlan({ scoreId: SCORE, fingerprint: 'sha',
    segments: ranges.map(([start, end]) => ({ id: `m${start}-${end}`, inMeasure: start, outMeasure: end, playableParts: ['rh', 'lh'] })) });
  const achievements = Object.fromEntries(plan.tasks.filter((task) => task.mastery).map((task) => [task.key, { at: '2026-11-10T00:00:00Z', provenance: 'demonstrated' }]));
  const summary = { total: ranges.length, silver: ranges.length, gold: ranges.length,
    passages: ranges.map(([start, end]) => ({ id: `m${start}-${end}`, start, end, parts: ['rh', 'lh'], silver: 'x', gold: 'x' })) };
  return { fingerprint: { contentSha256: 'sha' },
    learnCoach: { version: 1, scoreId: SCORE, fingerprint: 'sha', revision: 1, achievements, counts: {}, evidence: [], reviews: {}, resume: null, summary } };
}

describe('PianoPolishReward with approved Learn segments', () => {
  const evaluateWith = (record, learnSegments) => {
    const calls = [];
    const reward = new PianoPolishReward({ pieceLog: new PianoPieceLog({ store: memory([]), clock }), logger: null,
      ...(learnSegments ? { learnSegments: (id, sha) => { calls.push([id, sha]); return learnSegments(id, sha); } } : {}) });
    return { result: reward.evaluate({ userId: 'kid', scoreKey: KEY, run: run(), record }), calls };
  };

  it('a changed passage means the piece is no longer all Gold', () => {
    const { result, calls } = evaluateWith(goldRecord([[0, 3], [4, 7]]), () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }]);
    expect(result.reason).toBe('not-all-gold');
    expect(calls).toEqual([[SCORE, 'sha']]);
  });

  it('approved ranges the child already holds Gold on still qualify', () => {
    const { result } = evaluateWith(goldRecord([[0, 3], [4, 7]]), () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
    expect(result).toMatchObject({ reason: 'qualified', newGem: true });
  });

  it('without approved segments the saved summary decides, as before', () => {
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
