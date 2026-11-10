// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateRuleset, evaluateEarnings, buildGemBoard, gemCategories, lifetimeGemsByRule } from './index.mjs';
import { isPayoutEntry, paidRefOf } from '../index.mjs';

const WEEK = { from: '2026-11-02', to: '2026-11-08' };
const RINGS_WEEK = { from: '2026-11-02T12:00:00.000Z', to: '2026-11-07T20:00:00.000Z' };
const ruleset = (rules) => validateRuleset({ revision: 5, rules });

function evaluate(rs, facts = {}, extra = {}) {
  return evaluateEarnings({
    ruleset: rs, learnerId: 'kid',
    facts: { sectionDays: [], days: [], week: null, units: [], rings: null, ...facts },
    standings: null, contestClosed: false, windows: { school: WEEK, rings: RINGS_WEEK }, today: '2026-11-04', ...extra,
  });
}
const line = (out, id) => out.lines.find((l) => l.ruleId === id);
const ringDays = (list) => list.map(([day, rings]) => ({ day, rings }));

describe('ring-days rules', () => {
  const rs = ruleset([
    { id: 'moved', kind: 'ring-days', days: 3, reward: { gems: 1 } },
    { id: 'strong', kind: 'ring-days', days: 2, min: 100, reward: { gems: 1 } },
  ]);

  it('validates days 1–7 and a positive min, defaulting to 5 days of any rings', () => {
    expect(ruleset([{ id: 'x', kind: 'ring-days', reward: { gems: 1 } }]).rules[0]).toMatchObject({ days: 5, min: 1 });
    expect(() => ruleset([{ id: 'x', kind: 'ring-days', days: 8, reward: 1 }])).toThrow(/days/);
    expect(() => ruleset([{ id: 'x', kind: 'ring-days', min: 0, reward: 1 }])).toThrow(/min/);
  });

  it('earns once the count of moved days is reached, with progress', () => {
    const out = evaluate(rs, { rings: 260, ringDays: ringDays([['2026-11-02', 120], ['2026-11-03', 40], ['2026-11-04', 100]]) });
    expect(line(out, 'moved')).toMatchObject({ status: 'earned', count: 1, amount: { silver: 0, gems: 1 }, progress: { have: 3, need: 3 } });
    expect(line(out, 'strong')).toMatchObject({ status: 'earned', progress: { have: 2, need: 2 } });
    expect(line(out, 'strong').evidence.map((e) => e.state)).toEqual(['moved', 'short', 'moved']);
  });

  it('is pending while the award week runs and none once it closes short', () => {
    const facts = { rings: 50, ringDays: ringDays([['2026-11-02', 50]]) };
    expect(line(evaluate(rs, facts), 'moved')).toMatchObject({ status: 'pending', note: '1 of 3 days', progress: { have: 1, need: 3 } });
    expect(line(evaluate(rs, facts, { contestClosed: true }), 'moved')).toMatchObject({ status: 'none' });
  });

  it('is indeterminate when rings cannot be read', () => {
    expect(line(evaluate(rs, { rings: null, ringDays: null }), 'moved').status).toBe('indeterminate');
  });
});

describe('gem metadata', () => {
  it('normalizes a gem block and refuses a colour or bad category', () => {
    const rs = ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { category: 'school', label: ' School ' } }]);
    expect(rs.rules[0].gem).toEqual({ category: 'school', label: 'School' });
    // A rule never carries its own colour: the area decides.
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { color: '#aabbcc' } }])).toThrow(/"x".*colour comes from the area/);
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { category: 'Not A Slug' } }])).toThrow(/category/);
    // Not a string at all: refused here, not later when the board labels a section.
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { group: 5 } }])).toThrow(/group/);
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { category: 5 } }])).toThrow(/category/);
  });

  it('rows are the rules that pay gems (or name a gem), grouped by category, in rule order', () => {
    const rs = ruleset([
      { id: 'green-day', kind: 'day-met', reward: 1 },
      { id: 'green-week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
      { id: 'moved', kind: 'ring-days', days: 5, reward: { gems: 1 }, gem: { category: 'exercise', label: 'Exercise' } },
      { id: 'contest', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
      { id: 'strong', kind: 'ring-days', days: 4, min: 100, reward: { gems: 1 }, gem: { category: 'exercise' } },
    ]);
    expect(gemCategories(rs)).toEqual([
      { id: 'green-week', label: 'green-week', cadence: 'weekly', group: 'school', area: 'school', color: '#2e9e5b', ruleIds: ['green-week'], parts: [{ ruleId: 'green-week', label: 'green-week', cadence: 'weekly', area: 'school', color: '#2e9e5b' }] },
      {
        id: 'exercise', label: 'Exercise', cadence: 'weekly', group: 'move', area: 'move', color: '#8e5bd0', ruleIds: ['moved', 'strong'],
        parts: [{ ruleId: 'moved', label: 'moved', cadence: 'weekly', area: 'move', color: '#8e5bd0' }, { ruleId: 'strong', label: 'strong', cadence: 'weekly', area: 'move', color: '#8e5bd0' }],
      },
      // The ring contest's default row: it shares `ring-contests` with the most-improved contest.
      { id: 'ring-contests', label: 'Ring contests', cadence: 'contest', group: 'move', area: 'move', color: '#8e5bd0', ruleIds: ['contest'], parts: [{ ruleId: 'contest', label: 'contest', cadence: 'contest', area: 'move', color: '#8e5bd0' }] },
    ]);
  });
});

describe('buildGemBoard', () => {
  const rs = ruleset([
    { id: 'green-week', label: 'Green week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
    { id: 'moved', label: 'Moved', kind: 'ring-days', days: 2, reward: { gems: 1 }, gem: { category: 'exercise' } },
    { id: 'strong', label: 'Strong', kind: 'ring-days', days: 2, min: 100, reward: { gems: 1 }, gem: { category: 'exercise' } },
    { id: 'contest', label: 'Most rings', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
  ]);
  const learner = (learnerId, facts, extra = {}) => ({
    ...evaluateEarnings({
      ruleset: rs, learnerId,
      facts: { sectionDays: [], days: [], week: null, units: [], ...facts },
      windows: { school: WEEK, rings: RINGS_WEEK }, today: '2026-11-04', ...extra,
    }),
    learnerName: learnerId.toUpperCase(),
  });
  const standings = [{ learnerId: 'a', rings: 300 }, { learnerId: 'b', rings: 40 }];
  const week = {
    windows: { school: WEEK, rings: RINGS_WEEK }, contestClosed: false, rulesRevision: 5, today: '2026-11-04',
    learners: [
      learner('a', { rings: 300, ringDays: ringDays([['2026-11-02', 150], ['2026-11-03', 150]]) }, { standings }),
      learner('b', { rings: 40, ringDays: ringDays([['2026-11-03', 40]]) }, { standings }),
    ],
  };

  it('lays out learners in roster order against every gem category', () => {
    const board = buildGemBoard({ ruleset: rs, week, lifetime: { a: { byRule: { 'green-week': 3, moved: 1 }, total: 7 } } });
    expect(board.learners).toEqual([{ learnerId: 'a', name: 'A' }, { learnerId: 'b', name: 'B' }]);
    expect(board.categories.map((c) => c.id)).toEqual(['green-week', 'exercise', 'ring-contests']);
    expect(board.groups).toEqual([{ id: 'move', label: 'Move' }, { id: 'school', label: 'School' }]);
    expect(board.week).toBe('2026-11-02');
    // Two exercise rules in one row: both earned this week.
    expect(board.cells.exercise.a).toMatchObject({ state: 'earned', week: 2, lifetime: 2 });
    expect(board.cells.exercise.b).toMatchObject({ state: 'pending', week: 0, progress: { have: 1, need: 2 } });
    // The contest: a leads, not yet decided — no gem this week yet.
    expect(board.cells['ring-contests'].a).toMatchObject({ state: 'leading', week: 0 });
    expect(board.cells['ring-contests'].b.state).toBe('none');
    // School evidence missing (no week verdict) reads unknown, never missed.
    expect(board.cells['green-week'].a).toMatchObject({ state: 'unknown', lifetime: 3 });
    // a holds the contest gem while leading it: week counts it, earned does not.
    expect(board.totals.a).toEqual({ week: 3, earned: 2, lifetime: 7 });
    expect(board.totals.b).toEqual({ week: 0, earned: 0, lifetime: 0 });
  });

  it('the ring contest part carries the score: their rings and the roster best', () => {
    const board = buildGemBoard({ ruleset: rs, week });
    expect(board.cells['ring-contests'].a.parts[0]).toMatchObject({ ruleId: 'contest', state: 'leading', score: { mine: 300, best: 300 } });
    expect(board.cells['ring-contests'].b.parts[0]).toMatchObject({ state: 'none', score: { mine: 40, best: 300 } });
    // Rings unreadable: no score, never a zero.
    const blind = { ...week, learners: [learner('a', { rings: null, ringDays: null }, { standings: null })] };
    expect(buildGemBoard({ ruleset: rs, week: blind }).cells['ring-contests'].a.parts[0]).toMatchObject({ state: 'unknown', score: null });
  });

  it('a decided contest reads won', () => {
    const closed = { ...week, contestClosed: true, learners: [learner('a', { rings: 300, ringDays: [] }, { standings, contestClosed: true })] };
    expect(buildGemBoard({ ruleset: rs, week: closed }).cells['ring-contests'].a).toMatchObject({ state: 'won', week: 1 });
  });
});

describe('lifetimeGemsByRule', () => {
  const pay = (ref, ruleId, delta, currency = 'gems') => ({ kind: 'earn', source: 'payout', action: `payout:${ruleId}`, ref, ruleId, delta, currency });
  it('counts payout gems by rule, less reversals, ignoring silver and non-payout entries', () => {
    const list = [
      pay('earn:a:gw:2026-10-26:on-time:gems', 'gw', 1),
      pay('earn:a:gw:2026-11-02:on-time:gems', 'gw', 1),
      pay('earn:a:gw:2026-11-02:on-time', 'gw', 5, 'silver'),
      { kind: 'adjust', ref: 'reverse:earn:a:gw:2026-11-02:on-time:gems', delta: -1, currency: 'gems' },
      { kind: 'adjust', ref: 'manual', delta: 4, currency: 'gems' },
    ];
    expect(lifetimeGemsByRule(list, { isPayoutEntry, paidRefOf })).toEqual({ gw: 1 });
  });
});

describe('row defaults and groups', () => {
  const rs = ruleset([
    { id: 'reader-week', label: 'Story time 4 days', kind: 'activity-days', match: { activity: 'story-read' }, days: 4, reward: { gems: 1 } },
    { id: 'moved-days', label: 'Moved 5 days', kind: 'ring-days', days: 5, reward: { gems: 1 } },
    { id: 'book-finished', label: 'Book finished', kind: 'milestone', match: { activity: 'book-finished' }, reward: { gems: 1 } },
    { id: 'ring-contest', label: 'Most rings this week', kind: 'ring-contest', tie: 'all', reward: { gems: 1 } },
    { id: 'most-improved', label: 'Most improved rings', kind: 'activity-contest', match: { activity: 'ring-improved' }, tie: 'all', reward: { gems: 1 } },
    { id: 'board-game-level', label: 'Board game level', kind: 'milestone', match: { activity: 'board-game-level' }, reward: { gems: 1 } },
  ]);

  it('folds same-subject rules into one row with a default label, group and parts', () => {
    const rows = gemCategories(rs);
    expect(rows.map((r) => [r.id, r.label, r.group])).toEqual([
      ['reading', 'Reading', 'school'],
      ['moved-days', 'Moved 5 days', 'move'],
      ['ring-contests', 'Ring contests', 'move'],
      ['board-game-level', 'Board game level', 'games'],
    ]);
    expect(rows[0].parts).toEqual([
      { ruleId: 'reader-week', label: 'Story time 4 days', cadence: 'weekly', area: 'school', color: '#2e9e5b' },
      { ruleId: 'book-finished', label: 'Book finished', cadence: 'milestone', area: 'school', color: '#2e9e5b' },
    ]);
    expect(rows[0].cadence).toBe('weekly'); // the first rule's, as before
  });

  it('config wins: gem.category keeps a rule on its own row, gem.group and gem.label override', () => {
    const own = ruleset([
      { id: 'reader-week', label: 'Story time 4 days', kind: 'activity-days', match: { activity: 'story-read' }, days: 4, reward: { gems: 1 }, gem: { category: 'story-time', group: 'bedtime' } },
      { id: 'book-finished', label: 'Book finished', kind: 'milestone', match: { activity: 'book-finished' }, reward: { gems: 1 }, gem: { label: 'Books' } },
    ]);
    expect(gemCategories(own).map((r) => [r.id, r.label, r.group])).toEqual([
      ['story-time', 'Story time 4 days', 'bedtime'],
      ['reading', 'Books', 'school'],
    ]);
    expect(() => ruleset([{ id: 'x', kind: 'day-met', reward: 1, gem: { group: 'Not A Slug' } }])).toThrow(/group/);
  });

  describe('a rule whose own id is a default row id', () => {
    const lesson = { id: 'reading', label: 'Reading lesson week', kind: 'section-week', match: { subject: 'reading' }, reward: { gems: 1 } };
    const stories = { id: 'reader-week', label: 'Story time 4 days', kind: 'activity-days', match: { activity: 'story-read' }, days: 4, reward: { gems: 1 } };
    const books = { id: 'book-finished', label: 'Book finished', kind: 'milestone', match: { activity: 'book-finished' }, reward: { gems: 1 } };
    const shape = (rules) => gemCategories(ruleset(rules)).map((r) => [r.id, r.label, r.ruleIds]);

    it('keeps its own row; the default merged row moves to `<id>-all`, whichever comes first', () => {
      expect(shape([lesson, stories, books])).toEqual([
        ['reading', 'Reading lesson week', ['reading']],
        ['reading-all', 'Reading', ['reader-week', 'book-finished']],
      ]);
      expect(shape([stories, lesson, books])).toEqual([
        ['reading-all', 'Reading', ['reader-week', 'book-finished']],
        ['reading', 'Reading lesson week', ['reading']],
      ]);
    });

    it('an explicit gem.category is a literal id: it joins the row with that id', () => {
      const piano = { id: 'keys', label: 'Keys', kind: 'day-met', reward: 1, gem: { category: 'reading' } };
      expect(shape([stories, piano])).toEqual([['reading', 'Reading', ['reader-week', 'keys']]]);
      expect(shape([lesson, stories, piano])).toEqual([
        ['reading', 'Reading lesson week', ['reading', 'keys']],
        ['reading-all', 'Reading', ['reader-week']],
      ]);
    });
  });

  describe('colour', () => {
    const most = { id: 'ring-contest', label: 'Most rings this week', kind: 'ring-contest', tie: 'all', reward: { gems: 1 } };
    const improved = { id: 'most-improved', label: 'Most improved rings', kind: 'activity-contest', match: { activity: 'ring-improved' }, tie: 'all', reward: { gems: 1 } };
    const contests = (rules) => gemCategories(ruleset(rules)).find((r) => r.id === 'ring-contests');

    it('every row and part takes its area colour, whichever rule comes first', () => {
      const move = { color: '#8e5bd0', area: 'move' };
      expect(contests([most, improved])).toMatchObject({ ...move, parts: [{ ruleId: 'ring-contest', ...move }, { ruleId: 'most-improved', ...move }] });
      expect(contests([improved, most])).toMatchObject({ ...move, parts: [{ ruleId: 'most-improved', ...move }, { ruleId: 'ring-contest', ...move }] });
    });

    it('move, school and games rules take #8e5bd0, #2e9e5b and #ff7a2f', () => {
      const rows = gemCategories(ruleset([
        most, improved,
        { id: 'card-keeper', label: 'Cards', kind: 'activity-days', match: { activity: 'card-goal' }, days: 4, reward: { gems: 1 } },
        { id: 'race-pb', label: 'Race PB', kind: 'milestone', match: { activity: 'race-pb' }, reward: { gems: 1 } },
      ]));
      expect(rows.map((r) => [r.id, r.area, r.color])).toEqual([
        ['ring-contests', 'move', '#8e5bd0'], ['flashcards', 'school', '#2e9e5b'], ['racing', 'games', '#ff7a2f'],
      ]);
      for (const row of rows) for (const part of row.parts) expect([part.area, part.color]).toEqual([row.area, row.color]);
    });

    it('a custom group still takes a registry area (school)', () => {
      const [row] = gemCategories(ruleset([{ id: 'reader-week', kind: 'activity-days', match: { activity: 'story-read' }, days: 4, reward: { gems: 1 }, gem: { group: 'bed-time' } }]));
      expect([row.group, row.area, row.color]).toEqual(['bed-time', 'school', '#2e9e5b']);
    });
  });

  it('a custom group sits after the known ones, labelled from its slug', () => {
    const custom = ruleset([
      { id: 'reader-week', label: 'Story time 4 days', kind: 'activity-days', match: { activity: 'story-read' }, days: 4, reward: { gems: 1 }, gem: { category: 'story-time', group: 'bed-time' } },
      { id: 'moved-days', label: 'Moved 5 days', kind: 'ring-days', days: 5, reward: { gems: 1 } },
    ]);
    expect(buildGemBoard({ ruleset: custom, week: { windows: { school: WEEK }, learners: [] } }).groups)
      .toEqual([{ id: 'move', label: 'Move' }, { id: 'bed-time', label: 'Bed time' }]);
  });
});

describe('cell parts, streak and reach', () => {
  // Week 2026-11-02 (Mon) … 2026-11-08 (Sun); ring-days close Saturday 2026-11-07.
  const rs = ruleset([
    { id: 'reader-week', label: 'Story time 4 days', kind: 'activity-days', match: { activity: 'story-read' }, days: 4, reward: { gems: 1 } },
    { id: 'book-finished', label: 'Book finished', kind: 'milestone', match: { activity: 'book-finished' }, reward: { gems: 1 } },
    { id: 'moved-days', label: 'Moved 5 days', kind: 'ring-days', days: 5, reward: { gems: 1 } },
  ]);
  const boardFor = (rules, today, lines) => buildGemBoard({
    ruleset: rules,
    week: { windows: { school: WEEK, rings: RINGS_WEEK }, today, contestClosed: false, learners: [{ learnerId: 'kid', learnerName: 'Kid', lines }] },
    lifetime: { kid: { byRule: { 'book-finished': 4 }, total: 9 } },
  });
  const board = (today, facts) => boardFor(rs, today, evaluate(rs, facts, { today }).lines);
  const achievements = (days, milestones = {}) => ({ days, milestones, unavailable: [] });

  it('a merged cell lists each rule as a part, with its days and items', () => {
    const b = board('2026-11-04', {
      rings: 0, ringDays: [],
      achievements: achievements({ 'story-read': ['2026-11-02', '2026-11-03'] }, { 'book-finished': [{ key: 'b1', day: '2026-11-03', label: 'Frog and Toad' }] }),
    });
    const cell = b.cells.reading.kid;
    expect(cell).toMatchObject({ state: 'earned', week: 1, streak: { have: 2, need: 4, left: 5, reach: 'on-track', ruleId: 'reader-week' } });
    expect(cell.parts.map((p) => [p.ruleId, p.state])).toEqual([['reader-week', 'pending'], ['book-finished', 'earned']]);
    expect(cell.parts[0].days).toEqual([{ day: '2026-11-02', state: 'done' }, { day: '2026-11-03', state: 'done' }]);
    expect(cell.parts[1]).toMatchObject({ week: 1, lifetime: 4, items: [{ day: '2026-11-03', label: 'Frog and Toad' }] });
  });

  it('reach: tight when every day left is needed, out when there are too few', () => {
    const two = achievements({ 'story-read': ['2026-11-02', '2026-11-03'] });
    // Saturday, not yet done today: Sat + Sun left, 2 short.
    expect(board('2026-11-07', { rings: 0, ringDays: [], achievements: two }).cells.reading.kid.streak).toMatchObject({ left: 2, reach: 'tight' });
    // Sunday: one day left, 2 short.
    expect(board('2026-11-08', { rings: 0, ringDays: [], achievements: two }).cells.reading.kid.streak).toMatchObject({ left: 1, reach: 'out' });
  });

  it('today does not count as left once it is done, and ring days stop at Saturday', () => {
    const b = board('2026-11-04', {
      rings: 40, ringDays: [{ day: '2026-11-04', rings: 40 }],
      achievements: achievements({ 'story-read': ['2026-11-04'] }),
    });
    expect(b.cells.reading.kid.streak).toMatchObject({ have: 1, left: 4 });      // Wed–Sun, today already counted
    expect(b.cells['moved-days'].kid.streak).toMatchObject({ have: 1, need: 5, left: 3, reach: 'out' }); // Wed–Sat, today already counted
    expect(b.cells['moved-days'].kid.parts[0].days).toEqual([{ day: '2026-11-04', state: 'done' }]);
  });

  it('days left never start before the week does', () => {
    const b = board('2026-10-31', { rings: 0, ringDays: [], achievements: achievements({ 'story-read': [] }) });
    expect(b.cells.reading.kid.streak).toMatchObject({ have: 0, need: 4, left: 7, reach: 'on-track' });
    expect(b.cells['moved-days'].kid.streak).toMatchObject({ left: 6 }); // Mon–Sat
  });

  it('days left stop at the rule\'s own dates', () => {
    const ending = ruleset([{ id: 'reader-week', kind: 'activity-days', match: { activity: 'story-read' }, days: 2, reward: { gems: 1 }, effective: { to: '2026-11-04' } }]);
    const facts = { achievements: achievements({ 'story-read': [] }) };
    const until = boardFor(ending, '2026-11-03', evaluate(ending, facts, { today: '2026-11-03' }).lines);
    expect(until.cells.reading.kid.streak).toMatchObject({ have: 0, need: 2, left: 2, reach: 'tight' });
    const starting = ruleset([{ id: 'reader-week', kind: 'activity-days', match: { activity: 'story-read' }, days: 2, reward: { gems: 1 }, effective: { from: '2026-11-06' } }]);
    const from = boardFor(starting, '2026-11-03', evaluate(starting, facts, { today: '2026-11-03' }).lines);
    expect(from.cells.reading.kid.streak).toMatchObject({ left: 3, reach: 'on-track' }); // Fri–Sun
  });

  it('a day-count part names its last day: Saturday for ring days, the week\'s end or the rule\'s own for the rest; other kinds none', () => {
    const b = board('2026-11-04', { rings: 0, ringDays: [], achievements: achievements({ 'story-read': ['2026-11-02', '2026-11-03', '2026-11-04'] }, { 'book-finished': [] }) });
    expect(b.cells['moved-days'].kid.parts[0].lastDay).toBe('2026-11-07');
    expect(b.cells.reading.kid.parts.map((p) => [p.ruleId, p.lastDay])).toEqual([['reader-week', '2026-11-08'], ['book-finished', null]]);
    // Still named once the part is earned, so the strip closes the same days.
    const done = board('2026-11-06', { rings: 0, ringDays: [], achievements: achievements({ 'story-read': ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'] }) });
    expect(done.cells.reading.kid.parts[0]).toMatchObject({ state: 'earned', lastDay: '2026-11-08' });
    const ending = ruleset([{ id: 'reader-week', kind: 'activity-days', match: { activity: 'story-read' }, days: 2, reward: { gems: 1 }, effective: { to: '2026-11-04' } }]);
    const until = boardFor(ending, '2026-11-03', evaluate(ending, { achievements: achievements({ 'story-read': [] }) }, { today: '2026-11-03' }).lines);
    expect(until.cells.reading.kid.parts[0].lastDay).toBe('2026-11-04');
    // A rule with no line this week has no last day to name.
    expect(boardFor(rs, '2026-11-04', []).cells.reading.kid.parts[0].lastDay).toBeNull();
  });

  it('after the window there is no day left', () => {
    // Not reachable through the evaluator (a past week is never pending): a hand-built line.
    const stale = [{ ruleId: 'reader-week', kind: 'activity-days', status: 'pending', amount: { silver: 0, gems: 0 }, progress: { have: 2, need: 4 }, evidence: [], note: null }];
    expect(boardFor(rs, '2026-11-10', stale).cells.reading.kid.streak).toMatchObject({ have: 2, need: 4, left: 0, reach: 'out' });
  });

  it('ring days on the Saturday itself, not yet moved: one day left', () => {
    const b = board('2026-11-07', { rings: 0, ringDays: [], achievements: achievements({ 'story-read': [] }) });
    expect(b.cells['moved-days'].kid.streak).toMatchObject({ have: 0, need: 5, left: 1, reach: 'out' });
  });

  it('no streak once earned, and none for a cell with nothing pending', () => {
    const b = board('2026-11-04', { rings: 0, ringDays: [], achievements: achievements({ 'story-read': [] }) });
    expect(b.cells.reading.kid.streak).toMatchObject({ have: 0, need: 4 });
    expect(b.groups.map((g) => g.id)).toEqual(['move', 'school']);
    // Earned: the part is no longer running, so the cell has no streak.
    const done = board('2026-11-06', {
      rings: 0, ringDays: [],
      achievements: achievements({ 'story-read': ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'] }),
    });
    expect(done.cells.reading.kid).toMatchObject({ state: 'earned', week: 1, streak: null });
    expect(done.cells.reading.kid.parts[0]).toMatchObject({ state: 'earned', left: null, reach: null });
    // Nothing pending: the stories could not be read and no book was finished.
    const blank = board('2026-11-04', {
      rings: null, ringDays: null,
      achievements: { days: {}, milestones: { 'book-finished': [] }, unavailable: ['story-read'] },
    });
    expect(blank.cells.reading.kid.parts.map((p) => p.state)).toEqual(['unknown', 'none']);
    expect(blank.cells.reading.kid).toMatchObject({ state: 'unknown', streak: null });
    expect(blank.cells['moved-days'].kid).toMatchObject({ state: 'unknown', streak: null });
  });
});
