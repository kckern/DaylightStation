import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent } from '../../../../../../../shared/music/learnCoach.mjs';
import { boardColumns, letterOf, passageTile, pathLayout, pieceGemOffered, railFits, railModel } from './passageRail.js';

const segment = (index, bars = 4, parts = ['rh', 'lh']) => ({ id: `m${index * 4}-${index * 4 + bars - 1}`, inMeasure: index * 4, outMeasure: index * 4 + bars - 1,
  printedMeasures: [index * 4 + 1, index * 4 + bars], barLabel: `Bars ${index * 4 + 1}–${index * 4 + bars}`, playableParts: parts });
const planOf = (count, parts) => createCoachPlan({ scoreId: 'files:t.mxl', fingerprint: 'f', segments: Array.from({ length: count }, (_, index) => segment(index, 4, parts)) });
const pass = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1, placement: 1 }, diagnostics: { expected_notes: 8, matched_notes: 8 } };
const earn = (plan, state, passage, skill, id) => applyCoachEvent(state, { id, type: 'outcome', result: pass,
  task: plan.tasks.find((task) => task.passageId === passage && task.skill === skill) }, { plan, now: '2026-11-18T20:00:00.000Z', dayKey: '2026-11-18' });
const project = (plan, state) => projectCoach({ plan, state, dayKey: '2026-11-18' });
const model = (plan, state, selectedId = null, extra = {}) => { const projection = project(plan, state); return railModel({ segments: projection.segments, projection, selectedId, ...extra }); };
const bronze = (plan, state, ids) => ids.reduce((acc, id) => earn(plan, acc, id, 'silver', `b-${id}`), state);
const path = (rail) => rail.tokens.map((token) => `${token.letter}:${token.state}${token.isNext ? '*' : ''}${token.isTarget ? '>' : ''}`).join(' ');
const links = (rail) => rail.tokens.slice(1).map((token) => token.link);

describe('letters', () => {
  it('names passages A to Z, then AA', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(letterOf)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
  it('gives each passage its letter, its bars and its state words', () => {
    const plan = planOf(3); let state = earn(plan, null, 'm0-3', 'silver', 'a');
    state = earn(plan, state, 'm4-7', 'right', 'b');
    const started = model(plan, state);
    expect(started.tiles[1]).toMatchObject({ letter: 'B', state: 'todo', underway: true, steps: { done: 1, total: 4 }, label: 'B, bars 5–8, Started, 1 of 4 steps' });
    state = earn(plan, state, 'm4-7', 'left', 'b2');
    const rail = model(plan, state);
    expect(rail.tiles.map((tile) => [tile.letter, tile.startLabel, tile.state])).toEqual([['A', '1', 'silver'], ['B', '5', 'learning'], ['C', '9', 'todo']]);
    expect(rail.tiles[0].label).toBe('A, bars 1–4, Bronze');
    expect(passageTile({ id: 'p', inMeasure: 0, outMeasure: 2, printedMeasures: [0, 2], barLabel: 'Bars 0–2', skills: [], certification: {} }))
      .toMatchObject({ startLabel: '0', bars: 'Bars 0–2', barCount: 3, state: 'todo', label: 'Bars 0–2, Not started' });
  });
});

describe('the path', () => {
  it('starts as plain lettered discs with the first one next, and says what to do', () => {
    const rail = model(planOf(6), null);
    expect(path(rail)).toBe('A:todo*> B:todo C:todo D:todo E:todo F:todo');
    expect(links(rail)).toEqual(['plain', 'plain', 'plain', 'plain', 'plain']);
    expect(rail).toMatchObject({ caption: 'Learn A', target: { passageId: 'm0-3', kind: 'next' }, nextId: 'm0-3', selectedId: null, lap: 'silver' });
    expect(rail.tokens[0].aria).toBe('Learn A, bars 1–4');
    expect(rail.tokens[1].aria).toBe('B, bars 5–8, Not started');
    expect(rail.ladder).toMatchObject({ current: 'bronze', text: 'Bronze · 0 of 6', gemLevel: false });
    expect(rail.ladder.levels.map((item) => `${item.level}:${item.state}`)).toEqual(['bronze:current', 'silver:later', 'gold:later', 'diamond:later']);
  });

  it('offers no join until every passage is Bronze (the Bronze lap), then only the next one as a socket', () => {
    const plan = planOf(6);
    // A alone: no join yet, B is next.
    expect(path(model(plan, bronze(plan, null, ['m0-3'])))).toBe('A:silver B:todo*> C:todo D:todo E:todo F:todo');
    // A and B: still the Bronze lap. C is next and no join is offered.
    const ab = model(plan, bronze(plan, null, ['m0-3', 'm4-7']));
    expect(path(ab)).toBe('A:silver B:silver C:todo*> D:todo E:todo F:todo');
    expect(ab.ladder.text).toBe('Bronze · 2 of 6');
    // Every passage Bronze: the Silver lap opens on A+B, one socket, never a second.
    const all = model(plan, bronze(plan, null, ['m0-3', 'm4-7', 'm8-11', 'm12-15', 'm16-19', 'm20-23']));
    expect(path(all)).toBe('A:silver A+B:socket*> B:silver C:silver D:silver E:silver F:silver');
    expect(links(all)).toEqual(['socket', 'socket', 'plain', 'plain', 'plain', 'plain']);
    expect(all).toMatchObject({ caption: 'Play A and B together', target: { passageId: 'join:m0-3:m4-7', kind: 'next' } });
    expect(all.tokens[1]).toMatchObject({ kind: 'socket', aria: 'Play A and B together, bars 1–8', label: 'A+B, bars 1–8, not played through yet' });
    expect(all.tokens.filter((token) => token.kind === 'socket')).toHaveLength(1);
    expect(all.ladder).toMatchObject({ current: 'silver', text: 'Silver · 0 of 5', gemLevel: true });
    expect(all.ladder.levels.map((item) => item.state)).toEqual(['earned', 'current', 'later', 'later']);
  });

  it('keeps a backfilled join (A–B Silver while C is untouched) folded and recommends C, with no socket', () => {
    const plan = planOf(3);
    let state = bronze(plan, null, ['m0-3', 'm4-7']);
    state = earn(plan, state, 'join:m0-3:m4-7', 'silver', 'j');
    const rail = model(plan, state);
    expect(path(rail)).toBe('A–B:joined C:todo*>');
    expect(rail.caption).toBe('Learn C');
    expect(rail.ladder.text).toBe('Bronze · 2 of 3');
  });

  it('folds an earned join into one silver coin named for its span, and climbs the tree', () => {
    const plan = planOf(6);
    let state = bronze(plan, null, ['m0-3', 'm4-7', 'm8-11', 'm12-15', 'm16-19', 'm20-23']);
    state = earn(plan, state, 'join:m0-3:m4-7', 'silver', 'j1');
    let rail = model(plan, state);
    expect(path(rail)).toBe('A–B:joined C:silver C+D:socket*> D:silver E:silver F:silver');
    state = earn(plan, state, 'join:m8-11:m12-15', 'silver', 'j2');
    rail = model(plan, state);
    // The lowest level first: E+F before A–D.
    expect(path(rail)).toBe('A–B:joined C–D:joined E:silver E+F:socket*> F:silver');
    state = earn(plan, state, 'join:m16-19:m20-23', 'silver', 'j4');
    rail = model(plan, state);
    // A higher join's socket is named for its span; its halves are the two silver coins.
    expect(path(rail)).toBe('A–B:joined A–D:socket*> C–D:joined E–F:joined');
    expect(rail.caption).toBe('Play A–B and C–D together');
    expect(rail.ladder.text).toBe('Silver · 3 of 5');
    state = earn(plan, state, 'join:m0-3:m12-15', 'silver', 'j3');
    rail = model(plan, state);
    expect(path(rail)).toBe('A–D:joined All:socket*> E–F:joined');
    expect(rail.caption).toBe('Play it all');
    expect(rail.tokens[1].aria).toBe('Play it all, bars 1–24');
  });

  it('opens out for Gold once the piece is played through: silver links, A in time', () => {
    const plan = planOf(2);
    let state = bronze(plan, null, ['m0-3', 'm4-7']);
    state = earn(plan, state, 'join:m0-3:m4-7', 'silver', 'j');
    const rail = model(plan, state);
    expect(rail.lap).toBe('gold');
    expect(path(rail)).toBe('A:silver*> B:silver');
    expect(links(rail)).toEqual(['joined']);
    expect(rail).toMatchObject({ caption: 'A in time', target: { passageId: 'm0-3', kind: 'gold' } });
    expect(rail.ladder).toMatchObject({ current: 'gold', text: 'Gold · 0 of 2' });
    // While a join's Silver lands the host holds the Silver drawing: the whole piece is one coin.
    expect(path(model(plan, state, 'join:m0-3:m4-7', { lap: 'silver' }))).toBe('A–B:joined*>');
    for (const [passage, ids] of [['m0-3', ['c', 'd']], ['m4-7', ['e', 'f']]]) for (const id of ids) state = earn(plan, state, passage, 'mastery', id);
    const gold = model(plan, state, null, { polish: { gem: true, diamond: true } });
    expect(path(gold)).toBe('A:gold> B:gold');
    expect(gold).toMatchObject({ caption: 'Play A again', target: { kind: 'again' } });
    expect(gold.ladder).toMatchObject({ current: 'diamond', text: 'Diamond · earned' });
    expect(gold.ladder.levels.map((item) => item.state)).toEqual(['earned', 'earned', 'earned', 'earned']);
    expect(model(plan, state).ladder).toMatchObject({ current: 'diamond', text: 'Diamond · in Polish' });
  });

  it('moves the play disc to a selected token and keeps the next one larger', () => {
    const plan = planOf(4); const state = bronze(plan, null, ['m0-3']);
    const rail = model(plan, state, 'm12-15');
    expect(path(rail)).toBe('A:silver B:todo* C:todo D:todo>');
    expect(rail).toMatchObject({ caption: 'Learn D', selectedId: 'm12-15', target: { passageId: 'm12-15', kind: 'selected' }, nextId: 'm4-7' });
    expect(rail.tokens[3]).toMatchObject({ isSelected: true, aria: 'Learn D, bars 13–16' });
    expect(model(plan, state, 'gone')).toMatchObject({ target: { passageId: 'm4-7', kind: 'next' }, selectedId: null });
    // A selected passage inside an earned join opens the fold, so it can be seen.
    let joined = bronze(plan, null, ['m0-3', 'm4-7']); joined = earn(plan, joined, 'join:m0-3:m4-7', 'silver', 'j');
    expect(path(model(plan, joined, 'm4-7'))).toBe('A:silver B:silver> C:todo* D:todo');
  });

  it('has no joins for a one-passage piece, whose Bronze is the piece played through', () => {
    const plan = planOf(1); const state = earn(plan, null, 'm0-3', 'silver', 'a');
    const rail = model(plan, state);
    expect(path(rail)).toBe('A:silver*>');
    expect(rail.cards).toHaveLength(1);
    // No Silver rung: the one passage's Bronze is the piece played through.
    expect(rail.ladder.levels.map((item) => `${item.level}:${item.state}`)).toEqual(['bronze:earned', 'gold:current', 'diamond:later']);
  });

  it('puts every passage, every join played through and the socket on the board, in play order', () => {
    const plan = planOf(4);
    let state = bronze(plan, null, ['m0-3', 'm4-7', 'm8-11']);
    state = earn(plan, state, 'join:m0-3:m4-7', 'silver', 'j');
    const rail = model(plan, state);
    expect(rail.cards.map((card) => `${card.letter}:${card.kind}${card.isTarget ? '>' : ''}`)).toEqual(['A:passage', 'B:passage', 'A–B:join', 'C:passage', 'D:passage>']);
    expect(rail.cards[2]).toMatchObject({ state: 'joined', label: 'A–B, bars 1–8, Silver' });
  });
});

describe('path layout', () => {
  it('shrinks tokens to a 44px floor, then compacts', () => {
    expect(pathLayout(6, 840)).toEqual({ size: 56, compact: false });
    expect(pathLayout(14, 840).size).toBeGreaterThanOrEqual(44);
    expect(pathLayout(14, 840).compact).toBe(false);
    expect(pathLayout(24, 840)).toMatchObject({ compact: true });
    expect(pathLayout(5, 0)).toEqual({ size: 56, compact: false });
    expect(railFits(12, 900)).toBe(true);
    expect(railFits(40, 900)).toBe(false);
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

describe('boardColumns', () => {
  it('fills every row of the board evenly, so a row never ends in blank cells it could have shared', () => {
    expect(boardColumns(4)).toBe(4);
    expect(boardColumns(7)).toBe(7);
    expect(boardColumns(12)).toBe(6);
    expect(boardColumns(13)).toBe(7);
    expect(boardColumns(15)).toBe(5);
    expect(boardColumns(30)).toBe(8);
    expect(boardColumns(0)).toBe(1);
  });
});

describe('a step down', () => {
  it('names the half on the caption and rings its token while the join is worked on', () => {
    const plan = planOf(4);
    let state = bronze(plan, null, ['m0-3', 'm4-7', 'm8-11', 'm12-15']);
    for (const id of ['join:m0-3:m4-7', 'join:m8-11:m12-15']) state = earn(plan, state, id, 'silver', `j-${id}`);
    const projection = project(plan, state);
    const rail = railModel({ segments: projection.segments, projection, selectedId: 'join:m0-3:m12-15', stepDown: 'join:m8-11:m12-15' });
    expect(rail.caption).toBe('Play C–D first');
    expect(rail.tokens.filter((token) => token.isStepDown).map((token) => token.letter)).toEqual(['C–D']);
    expect(rail.names).toMatchObject({ 'm0-3': 'A', 'join:m8-11:m12-15': 'C–D', 'join:m0-3:m12-15': 'All' });
    expect(railModel({ segments: projection.segments, projection, selectedId: 'join:m0-3:m12-15' }).caption).toBe('Play it all');
  });
});
