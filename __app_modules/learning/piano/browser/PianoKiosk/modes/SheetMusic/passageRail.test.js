import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent } from '../../../../../../../shared/music/learnCoach.mjs';
import { passageTile, pieceGemOffered, railFits, railModel } from './passageRail.js';

const segment = (index, bars = 4, parts = ['rh', 'lh']) => ({ id: `m${index * 4}-${index * 4 + bars - 1}`, inMeasure: index * 4, outMeasure: index * 4 + bars - 1,
  printedMeasures: [index * 4 + 1, index * 4 + bars], barLabel: `Bars ${index * 4 + 1}–${index * 4 + bars}`, playableParts: parts });
const planOf = (count, parts) => createCoachPlan({ scoreId: 'files:t.mxl', fingerprint: 'f', segments: Array.from({ length: count }, (_, index) => segment(index, 4, parts)) });
const pass = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1, placement: 1 }, diagnostics: { expected_notes: 8, matched_notes: 8 } };
const earn = (plan, state, passage, skill, id) => applyCoachEvent(state, { id, type: 'outcome', result: pass,
  task: plan.tasks.find((task) => task.passageId === passage && task.skill === skill) }, { plan, now: '2026-11-18T20:00:00.000Z', dayKey: '2026-11-18' });
const project = (plan, state) => projectCoach({ plan, state, dayKey: '2026-11-18' });
const model = (plan, state, selectedId = null) => { const projection = project(plan, state); return railModel({ segments: projection.segments, projection, selectedId }); };

describe('passage rail model', () => {
  it('shows every passage by its printed starting bar, with its state', () => {
    const plan = planOf(3); let state = earn(plan, null, 'm0-3', 'silver', 'a');
    state = earn(plan, state, 'm4-7', 'right', 'b');
    // One hand is still a tomato, with its step counted; both hands make a flower.
    const started = model(plan, state);
    expect(started.tiles[1]).toMatchObject({ state: 'todo', underway: true, steps: { done: 1, total: 4 }, label: 'Bars 5–8, Started, 1 of 4 steps' });
    expect(started.tiles[2]).toMatchObject({ state: 'todo', underway: false, label: 'Bars 9–12, Not started' });
    state = earn(plan, state, 'm4-7', 'left', 'b2');
    const rail = model(plan, state);
    expect(rail.tiles.map((tile) => [tile.startLabel, tile.state, tile.barCount])).toEqual([['1', 'silver', 4], ['5', 'learning', 4], ['9', 'todo', 4]]);
    expect(rail.tiles[1]).toMatchObject({ underway: true, steps: { done: 2, total: 4 }, label: 'Bars 5–8, Partway, 2 of 4 steps' });
    expect(rail.tiles[0].label).toBe('Bars 1–4, Silver');
    expect(rail.count).toEqual({ level: 'silver', done: 1, total: 3, text: '1/3', label: '1 of 3 Silver' });
    expect(rail.goals).toEqual([{ level: 'silver', label: 'All Silver', done: 1, total: 3, reached: false }, { level: 'gold', label: 'All Gold', done: 0, total: 3, reached: false }]);
  });

  it('uses the printed number when the piece starts on a pickup bar', () => {
    expect(passageTile({ id: 'p', inMeasure: 0, outMeasure: 2, printedMeasures: [0, 2], barLabel: 'Bars 0–2', skills: [], certification: {} }))
      .toMatchObject({ startLabel: '0', bars: 'Bars 0–2', barCount: 3, state: 'todo' });
    expect(passageTile({ id: 'q', inMeasure: 3, outMeasure: 3, skills: [], certification: {} })).toMatchObject({ startLabel: '4', bars: 'Bars 4–4' });
  });

  it('aims the button at the recommended passage until one is selected', () => {
    const plan = planOf(3); const state = earn(plan, null, 'm0-3', 'silver', 'a');
    expect(model(plan, state)).toMatchObject({ buttonLabel: 'Practice bars 5–8', target: { passageId: 'm4-7', kind: 'next' }, outlinedId: 'm4-7', selectedId: null });
    expect(model(plan, state, 'm8-11')).toMatchObject({ buttonLabel: 'Practice bars 9–12', target: { passageId: 'm8-11', kind: 'selected' }, outlinedId: 'm8-11', selectedId: 'm8-11' });
    expect(model(plan, state, 'gone')).toMatchObject({ target: { passageId: 'm4-7', kind: 'next' }, selectedId: null });
  });

  it('offers Gold once every passage is Silver, and counts the Gold lap', () => {
    const plan = planOf(2); let state = earn(plan, null, 'm0-3', 'silver', 'a'); state = earn(plan, state, 'm4-7', 'silver', 'b');
    const silver = model(plan, state);
    expect(silver).toMatchObject({ buttonLabel: 'Go for Gold: bars 1–4', target: { passageId: 'm0-3', kind: 'gold' }, count: { level: 'gold', text: '0/2', label: '0 of 2 Gold' } });
    expect(silver.goals).toEqual([{ level: 'silver', label: 'All Silver', done: 2, total: 2, reached: true }, { level: 'gold', label: 'All Gold', done: 0, total: 2, reached: false }]);
    for (const [passage, ids] of [['m0-3', ['c', 'd']], ['m4-7', ['e', 'f']]]) for (const id of ids) state = earn(plan, state, passage, 'mastery', id);
    const gold = model(plan, state);
    expect(gold).toMatchObject({ buttonLabel: 'Practice bars 1–4', target: { kind: 'again' }, count: { text: '2/2' } });
    expect(gold.goals.every((goal) => goal.reached)).toBe(true);
  });

  it('counts two Silver steps for a single-hand passage', () => {
    const plan = planOf(1, ['rh']); const state = earn(plan, null, 'm0-3', 'notes', 'a');
    expect(model(plan, state).tiles[0]).toMatchObject({ state: 'learning', steps: { done: 1, total: 2 } });
  });

  it('keeps a usable touch target or says the tiles do not fit', () => {
    expect(railFits(12, 900)).toBe(true);
    expect(railFits(18, 900)).toBe(true);
    expect(railFits(19, 900)).toBe(false);
    expect(railFits(40, 900)).toBe(false);
    expect(railFits(0, 900)).toBe(true);
  });
});

describe('gem offer', () => {
  const board = (over = {}) => ({ mode: 'live', learners: [{ learnerId: 'kid' }],
    categories: [{ id: 'piano', parts: [{ ruleId: 'piano-rung', activity: 'piano-rung' }, { ruleId: 'piano-piece', activity: 'piano-piece' }] }],
    cells: { piano: { kid: { state: 'none', parts: [{ ruleId: 'piano-piece', state: 'none' }] } } }, ...over });
  it('is on only when the live board carries the rule for this learner', () => {
    expect(pieceGemOffered(board(), 'kid')).toBe(true);
    expect(pieceGemOffered(board({ mode: 'dry-run' }), 'kid')).toBe(false);
    expect(pieceGemOffered(board({ mode: 'off' }), 'kid')).toBe(false);
    expect(pieceGemOffered(board(), 'grown-up')).toBe(false);
    expect(pieceGemOffered(board(), 'guest')).toBe(false);
    expect(pieceGemOffered(board({ categories: [{ id: 'piano', parts: [{ ruleId: 'piano-rung', activity: 'piano-rung' }] }] }), 'kid')).toBe(false);
    expect(pieceGemOffered(board({ cells: { piano: { kid: { state: 'disabled', parts: [{ ruleId: 'piano-piece', state: 'disabled' }] } } } }), 'kid')).toBe(false);
    expect(pieceGemOffered(board({ cells: {} }), 'kid')).toBe(false);
    expect(pieceGemOffered(null, 'kid')).toBe(false);
  });
});
