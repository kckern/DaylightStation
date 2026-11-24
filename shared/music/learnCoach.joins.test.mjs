import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent, coachSummary, buildJoinTree } from './learnCoach.mjs';

const seg = (n, parts = ['rh', 'lh']) => ({ id: `p${n}`, inMeasure: (n - 1) * 4, outMeasure: n * 4 - 1, printedMeasures: [String((n - 1) * 4 + 1), String(n * 4)], playableParts: parts });
const many = (count, parts) => Array.from({ length: count }, (_, i) => seg(i + 1, parts));
const planOf = (count = 6, parts) => createCoachPlan({ scoreId: 'files:t.musicxml', fingerprint: 'fp', segments: many(count, parts), tempoMap: [{ onsetQuarter: 0, bpm: 100 }], goldLadder: { minBpm: 40 } });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 0.95, placement: 0.95 }, verdict: { passed: true }, diagnostics: { expected_notes: 10, matched_notes: 10, wrong_notes: 0, missed_notes: 0 } };
const bad = { ...good, criteria: { completeness: 0.4, cleanliness: 0.4, placement: 0.4 }, diagnostics: { expected_notes: 10, matched_notes: 4, wrong_notes: 6, missed_notes: 6 } };
const dayKey = '2026-11-23';
const proj = (plan, state) => projectCoach({ plan, state, dayKey });
let seq = 0;
const play = (state, plan, task, result = good) => applyCoachEvent(state, { id: `e${++seq}`, type: 'outcome', task, result }, { plan, now: '2026-11-23T18:00:00Z', dayKey });
const check = (plan, id) => plan.segments.find((s) => s.id === id).tasks.find((t) => t.assist === 'none');
const bronze = (state, plan, ids) => ids.reduce((acc, id) => play(acc, plan, check(plan, id)), state);

describe('join tree', () => {
  it('orders six passages as the spec does', () => {
    expect(planOf(6).segments.map((s) => s.id)).toEqual(['p1', 'p2', 'join:p1:p2', 'p3', 'p4', 'join:p3:p4', 'join:p1:p4', 'p5', 'p6', 'join:p5:p6', 'join:p1:p6']);
  });
  it('carries an odd unit to the next level', () => {
    expect(planOf(3).segments.map((s) => s.id)).toEqual(['p1', 'p2', 'join:p1:p2', 'p3', 'join:p1:p3']);
    expect(planOf(5).segments.filter((s) => s.kind === 'join').map((s) => s.id)).toEqual(['join:p1:p2', 'join:p3:p4', 'join:p1:p4', 'join:p1:p5']);
  });
  it('makes no join for a one-passage piece', () => {
    expect(planOf(1).segments.map((s) => s.id)).toEqual(['p1']);
  });
  it('gives each join its range, parts, seam and final flag', () => {
    const plan = planOf(6, ['rh']);
    const join = plan.segments.find((s) => s.id === 'join:p1:p2');
    expect(join).toMatchObject({ kind: 'join', inMeasure: 0, outMeasure: 7, playableParts: ['rh'], final: false, seam: { left: 3, right: 4 } });
    expect(plan.segments.at(-1)).toMatchObject({ id: 'join:p1:p6', final: true, inMeasure: 0, outMeasure: 23 });
    expect(join.tasks.filter((t) => t.track === 'silver').map((t) => t.skill)).toEqual(['notes', 'silver']);
    // The final join has no Gold ladder of its own: its timed play is Polish.
    expect(plan.segments.at(-1).tasks.some((t) => t.track === 'gold')).toBe(false);
    expect(plan.segments.at(-1).demonstration).toBeNull();
  });
  it('is exported pure', () => {
    expect(buildJoinTree(many(2)).map((j) => j.id)).toEqual(['join:p1:p2']);
  });
});

describe('piece Silver is the final join', () => {
  it('counts passages only and offers the first join once every passage is Bronze', () => {
    const plan = planOf(6);
    let state = bronze(undefined, plan, ['p1', 'p2']);
    let p = proj(plan, state);
    expect(p.piece).toMatchObject({ total: 6, silver: 2, pieceSilver: false, joins: { total: 5, silver: 0 } });
    expect(p.recommended.passageId).toBe('p3');
    state = bronze(state, plan, ['p3', 'p4', 'p5', 'p6']);
    p = proj(plan, state);
    expect(p.recommended).toMatchObject({ passageId: 'join:p1:p2', assist: 'none' });
  });
  it('never recommends a join over a passage that has no Bronze yet', () => {
    const plan = planOf(4);
    expect(proj(plan, bronze(undefined, plan, ['p1', 'p2', 'p3'])).recommended.passageId).toBe('p4');
    expect(proj(plan, bronze(undefined, plan, ['p1'])).recommended.passageId).toBe('p2');
  });
  it('certifies the piece when the final join passes, not before', () => {
    const plan = planOf(2);
    let state = bronze(undefined, plan, ['p1', 'p2']);
    expect(proj(plan, state).piece.pieceSilver).toBe(false);
    state = play(state, plan, check(plan, 'join:p1:p2'));
    const p = proj(plan, state);
    expect(p.piece.pieceSilver).toBe(true);
    expect(coachSummary(p, { now: 'x', state }).pieceSilver).toBe(true);
    expect(coachSummary(p, { now: 'x', state }).passages).toHaveLength(2);
  });
  it('is the passage itself on a one-passage piece', () => {
    const plan = planOf(1);
    expect(proj(plan).piece.pieceSilver).toBe(false);
    expect(proj(plan, bronze(undefined, plan, ['p1'])).piece.pieceSilver).toBe(true);
  });
});

describe('test out first', () => {
  it('opens an untouched passage or join on its Silver check', () => {
    expect(proj(planOf(2)).recommended).toMatchObject({ passageId: 'p1', assist: 'none' });
  });
  it('falls back to the hand steps after a failed check', () => {
    const plan = planOf(2);
    const state = play(undefined, plan, check(plan, 'p1'), bad);
    expect(proj(plan, state).recommended).toMatchObject({ passageId: 'p1', skill: 'right' });
  });
  it('a passage already under way keeps its ladder order', () => {
    const plan = planOf(2);
    const right = plan.segments[0].tasks.find((t) => t.skill === 'right');
    const state = play(undefined, plan, right);
    expect(proj(plan, state).recommended).toMatchObject({ passageId: 'p1', skill: 'left' });
  });
});

describe('join drills', () => {
  const missTwice = (plan, id, result) => { const t = check(plan, id); return play(play(bronze(undefined, plan, ['p1', 'p2']), plan, t, result), plan, t, result); };
  const cleanPart = { diagnostics: { expected_notes: 10, missed_notes: 0, wrong_notes: 0 } };
  const brokenPart = { diagnostics: { expected_notes: 10, missed_notes: 6, wrong_notes: 2 } };
  it('drills the hand that broke across the whole join', () => {
    const plan = planOf(2);
    const result = { ...bad, parts: { rh: cleanPart, lh: brokenPart } };
    expect(proj(plan, missTwice(plan, 'join:p1:p2', result)).recommended).toMatchObject({ passageId: 'join:p1:p2', reason: 'one-hand', parts: ['lh'], range: { start: 0, end: 7 }, depth: 1 });
  });
  it('drills the seam when the misses sit on it', () => {
    const plan = planOf(2);
    const span = (missed) => ({ diagnostics: { expected_notes: 4, missed_notes: missed, wrong_notes: 0 } });
    const result = { ...bad, spans: { 'measure:2': span(0), 'measure:3': span(3), 'measure:4': span(2) } };
    expect(proj(plan, missTwice(plan, 'join:p1:p2', result)).recommended).toMatchObject({ reason: 'seam', range: { start: 3, end: 4 }, parts: ['rh', 'lh'], label: 'Practice the join' });
  });
  it('falls back to the generic bar drill when the misses are elsewhere', () => {
    const plan = planOf(2);
    const span = (missed) => ({ diagnostics: { expected_notes: 4, missed_notes: missed, wrong_notes: 0 } });
    // Spread over both halves (neither carries three quarters of it): the worst bar and the way into it.
    const result = { ...bad, spans: { 'measure:1': span(3), 'measure:2': span(1), 'measure:6': span(2) } };
    expect(proj(plan, missTwice(plan, 'join:p1:p2', result)).recommended).toMatchObject({ reason: 'focus-bars', range: { start: 0, end: 1 } });
  });
});

describe('a plan handed back to createCoachPlan', () => {
  it('rebuilds the same plan; joins are derived, never input', () => {
    const plan = planOf(6);
    const again = createCoachPlan({ ...plan, segments: plan.segments });
    expect(again.segments.map((s) => s.id)).toEqual(plan.segments.map((s) => s.id));
    expect(again.tasks.map((t) => t.key)).toEqual(plan.tasks.map((t) => t.key));
  });
});

describe('join Gold (stage 3)', () => {
  const gold = (plan, id, skill) => plan.segments.find((s) => s.id === id).tasks.find((t) => t.skill === skill);
  const goldAll = (state, plan, ids) => ids.reduce((acc, id) => { const t = gold(plan, id, 'mastery'); return play(play(acc, plan, t), plan, t); }, state);
  it('gives a join a Gold ladder at the plan speeds: 50, 70, 85, score tempo', () => {
    const plan = planOf(4);
    const join = plan.segments.find((s) => s.id === 'join:p1:p2');
    expect(join.tasks.filter((t) => t.track === 'gold').map((t) => [t.skill, t.tempoPercent, t.mode])).toEqual([['timed-50', 50, 'cued'], ['timed-70', 70, 'cued'], ['timed-85', 85, 'cued'], ['mastery', 100, 'cued']]);
    expect(join.demonstration).toBe(join.tasks.find((t) => t.mastery));
  });
  it('unlocks join Gold only when the join has Silver and both halves are Gold', () => {
    const plan = planOf(4);
    let state = bronze(undefined, plan, ['p1', 'p2']);
    expect(proj(plan, state).gold['join:p1:p2']).toBeNull();
    state = play(state, plan, check(plan, 'join:p1:p2'));
    expect(proj(plan, state).gold['join:p1:p2']).toBeNull();
    state = goldAll(state, plan, ['p1']);
    expect(proj(plan, state).gold['join:p1:p2']).toBeNull();
    state = goldAll(state, plan, ['p2']);
    expect(proj(plan, state).gold['join:p1:p2']).toMatchObject({ skill: 'mastery' }); // test out first
  });
  it('a failed test-out walks 50, 70, 85, then score tempo', () => {
    const plan = planOf(4);
    let state = goldAll(play(bronze(undefined, plan, ['p1', 'p2']), plan, check(plan, 'join:p1:p2')), plan, ['p1', 'p2']);
    const top = gold(plan, 'join:p1:p2', 'mastery');
    state = play(play(state, plan, top, bad), plan, top, bad);
    expect(proj(plan, state).gold['join:p1:p2']).toMatchObject({ skill: 'timed-50' });
  });
  it('Polish is ready when every passage and join below the top is Gold; the top join is Polish itself', () => {
    const plan = planOf(4);
    const ids = plan.segments.map((s) => s.id);
    expect(ids.at(-1)).toBe('join:p1:p4');
    let state = bronze(undefined, plan, ['p1', 'p2', 'p3', 'p4']);
    state = ['join:p1:p2', 'join:p3:p4', 'join:p1:p4'].reduce((acc, id) => play(acc, plan, check(plan, id)), state);
    state = goldAll(state, plan, ['p1', 'p2', 'p3', 'p4']);
    expect(proj(plan, state).piece).toMatchObject({ pieceSilver: true, polishReady: false, joins: { total: 3, silver: 3, gold: 0 } });
    state = goldAll(state, plan, ['join:p1:p2']);
    expect(proj(plan, state).piece.polishReady).toBe(false);
    state = goldAll(state, plan, ['join:p3:p4']);
    expect(proj(plan, state).piece.polishReady).toBe(true);
    expect(proj(plan, state).piece.joins.gold).toBe(2);
  });
  it('a one-passage piece is Polish-ready when its passage is Gold', () => {
    const plan = planOf(1);
    expect(proj(plan).piece.polishReady).toBe(false);
    expect(proj(plan, goldAll(undefined, plan, ['p1'])).piece.polishReady).toBe(true);
  });
});

describe('retention', () => {
  const played = (plan) => play(bronze(undefined, plan, ['p1', 'p2']), plan, check(plan, 'join:p1:p2'));
  it('offers the final join check as a review three days after the piece was played through', () => {
    const plan = planOf(2); const state = played(plan);
    expect(projectCoach({ plan, state, dayKey: '2026-11-25' }).review).toBeNull();
    const later = projectCoach({ plan, state, dayKey: '2026-11-26' });
    expect(later.review).toMatchObject({ passageId: 'join:p1:p2', assist: 'none', review: true, reason: 'retention' });
  });
  it('is answered by passing it, and comes round again three days later', () => {
    const plan = planOf(2); let state = played(plan);
    const review = projectCoach({ plan, state, dayKey: '2026-11-26' }).review;
    state = applyCoachEvent(state, { id: 'r1', type: 'outcome', task: review, result: good }, { plan, now: '2026-11-26T18:00:00Z', dayKey: '2026-11-26' });
    expect(projectCoach({ plan, state, dayKey: '2026-11-27' }).review).toBeNull();
    expect(projectCoach({ plan, state, dayKey: '2026-11-29' }).review).toMatchObject({ reason: 'retention' });
  });
  it('waits for a piece that has not been played through', () => {
    const plan = planOf(2);
    expect(projectCoach({ plan, state: bronze(undefined, plan, ['p1', 'p2']), dayKey: '2026-12-30' }).review).toBeNull();
  });
});

describe('review fixes', () => {
  it('a plan serialized for the server and rebuilt there is the same plan', async () => {
    const { serializeCoachPlan } = await import('../../__app_modules/learning/piano/browser/PianoKiosk/modes/SheetMusic/learnCoachClient.js');
    const plan = planOf(4);
    const again = createCoachPlan(serializeCoachPlan(plan));
    expect(again.segments.map((s) => s.id)).toEqual(plan.segments.map((s) => s.id));
    expect(proj(again).piece.total).toBe(4);
  });
  it('a join id handed in as input is never a passage', () => {
    const again = createCoachPlan({ scoreId: 'files:t.musicxml', fingerprint: 'fp', segments: [...many(2), { id: 'join:x:y', inMeasure: 0, outMeasure: 7, playableParts: ['rh'] }] });
    expect(again.segments.map((s) => s.id)).toEqual(['p1', 'p2', 'join:p1:p2']);
  });
  it('retention is offered ahead of a due mastery review', () => {
    const plan = planOf(2);
    let state = play(bronze(undefined, plan, ['p1', 'p2']), plan, check(plan, 'join:p1:p2'));
    const top = plan.segments.find((s) => s.id === 'p1').tasks.find((t) => t.mastery);
    state = play(play(state, plan, top), plan, top);
    expect(projectCoach({ plan, state, dayKey: '2026-11-27' }).review).toMatchObject({ reason: 'retention', passageId: 'join:p1:p2' });
  });
  it('a join can be set aside and names where it goes next', () => {
    const plan = planOf(4);
    const state = bronze(undefined, plan, ['p1', 'p2', 'p3', 'p4']);
    const p = proj(plan, state);
    expect(p.recommended.passageId).toBe('join:p1:p2');
    expect(p.afterSetAside['join:p1:p2']).toBe('join:p3:p4');
  });
});

describe('laps (2026-11-23 night)', () => {
  const gold = (plan, id) => plan.segments.find((s) => s.id === id).tasks.find((t) => t.mastery);
  const goldAll = (state, plan, ids) => ids.reduce((acc, id) => { const t = gold(plan, id); return play(play(acc, plan, t), plan, t); }, state);
  const silverAll = (state, plan, ids) => ids.reduce((acc, id) => play(acc, plan, check(plan, id)), state);
  // Walk the recommendation, passing each unit's check, and list the units in the order they came.
  const walk = (plan) => {
    let state; const seen = [];
    for (let guard = 0; guard < 40; guard += 1) {
      const next = proj(plan, state).recommended;
      if (!next) break;
      seen.push(next.passageId); state = play(state, plan, check(plan, next.passageId));
    }
    return { seen, state };
  };
  it('recommends every passage, then the joins lowest level first, the whole piece last', () => {
    expect(walk(planOf(6)).seen).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'join:p1:p2', 'join:p3:p4', 'join:p5:p6', 'join:p1:p4', 'join:p1:p6']);
    expect(walk(planOf(5)).seen).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'join:p1:p2', 'join:p3:p4', 'join:p1:p4', 'join:p1:p5']);
  });
  it('keeps plan.segments in play order (saved keys and states unchanged)', () => {
    expect(planOf(3).segments.map((s) => s.id)).toEqual(['p1', 'p2', 'join:p1:p2', 'p3', 'join:p1:p3']);
  });
  it('names the lap and its count', () => {
    const plan = planOf(3);
    expect(proj(plan)).toMatchObject({ lap: 'bronze', lapProgress: { done: 0, total: 3 } });
    let state = bronze(undefined, plan, ['p1', 'p2']);
    expect(proj(plan, state)).toMatchObject({ lap: 'bronze', lapProgress: { done: 2, total: 3 } });
    state = bronze(state, plan, ['p3']);
    expect(proj(plan, state)).toMatchObject({ lap: 'silver', lapProgress: { done: 0, total: 2 } });
    state = silverAll(state, plan, ['join:p1:p2', 'join:p1:p3']);
    expect(proj(plan, state)).toMatchObject({ lap: 'gold', lapProgress: { done: 0, total: 4 } });
    state = goldAll(state, plan, ['p1', 'p2', 'p3', 'join:p1:p2']);
    expect(proj(plan, state)).toMatchObject({ lap: 'diamond', recommended: null });
  });
  it('a one-passage piece goes Bronze, then Gold', () => {
    const plan = planOf(1);
    expect(proj(plan).lap).toBe('bronze');
    expect(proj(plan, bronze(undefined, plan, ['p1']))).toMatchObject({ lap: 'gold', lapProgress: { done: 0, total: 1 } });
  });
  it('a backfilled state (A, B Bronze, A–B Silver, C untouched) recommends C', () => {
    const plan = planOf(3);
    const state = silverAll(bronze(undefined, plan, ['p1', 'p2']), plan, ['join:p1:p2']);
    const p = proj(plan, state);
    expect(p.recommended).toMatchObject({ passageId: 'p3', assist: 'none' });
    expect(p).toMatchObject({ lap: 'bronze', lapProgress: { done: 2, total: 3 } });
    expect(p.segments.find((s) => s.id === 'join:p1:p2').certification.silver).toBeTruthy();
  });
  it('a later-lap unit chosen from the board still records', () => {
    const plan = planOf(3);
    let state = bronze(undefined, plan, ['p1', 'p2']);
    expect(proj(plan, state).recommended.passageId).toBe('p3');
    state = play(state, plan, check(plan, 'join:p1:p2'));
    expect(proj(plan, state).segments.find((s) => s.id === 'join:p1:p2').certification.silver).toBeTruthy();
    expect(proj(plan, state).piece.joins.silver).toBe(1);
    // A Gold step on a Bronze passage records too, before the Gold lap.
    state = goldAll(state, plan, ['p1']);
    expect(proj(plan, state).segments.find((s) => s.id === 'p1').certification.gold).toBeTruthy();
    expect(proj(plan, state).recommended.passageId).toBe('p3');
  });
  it('the Gold lap follows lap order (passages, then the joins below the top) and only after piece Silver', () => {
    const plan = planOf(4);
    let state = bronze(undefined, plan, ['p1', 'p2', 'p3', 'p4']);
    expect(proj(plan, state).piece.nextGoldPassageId).toBeNull();
    state = silverAll(state, plan, ['join:p1:p2', 'join:p3:p4', 'join:p1:p4']);
    expect(proj(plan, state).piece.nextGoldPassageId).toBe('p1');
    state = goldAll(state, plan, ['p1', 'p2', 'p3', 'p4']);
    expect(proj(plan, state).piece.nextGoldPassageId).toBe('join:p1:p2');
    state = goldAll(state, plan, ['join:p1:p2']);
    expect(proj(plan, state).piece.nextGoldPassageId).toBe('join:p3:p4');
    state = goldAll(state, plan, ['join:p3:p4']);
    expect(proj(plan, state)).toMatchObject({ lap: 'diamond', piece: { nextGoldPassageId: null, polishReady: true } });
  });
});

describe('step down to the smaller join (2026-11-23 late)', () => {
  const span = (missed) => ({ diagnostics: { expected_notes: 4, missed_notes: missed, wrong_notes: 0 } });
  const spansOf = (map) => Object.fromEntries(Object.entries(map).map(([measure, missed]) => [`measure:${measure}`, span(missed)]));
  const ready4 = (plan) => ['join:p1:p2', 'join:p3:p4'].reduce((acc, id) => play(acc, plan, check(plan, id)), bronze(undefined, plan, ['p1', 'p2', 'p3', 'p4']));
  const missTwice = (state, plan, task, result) => play(play(state, plan, task, result), plan, task, { ...result });
  it('practises the half the misses sit in, at the parent\'s parts and pace, and names it by its bars', () => {
    const plan = planOf(4); const top = check(plan, 'join:p1:p4');
    const state = missTwice(ready4(plan), plan, top, { ...bad, spans: spansOf({ 9: 3, 10: 2, 13: 1 }) });
    const next = proj(plan, state).recommended;
    expect(next).toMatchObject({ passageId: 'join:p1:p4', reason: 'smaller-join', stepDown: 'join:p3:p4', range: { start: 8, end: 15 },
      parts: ['rh', 'lh'], mode: 'free', depth: 1, label: 'Play bars 9–16' });
    expect(next.parent.key).toBe(top.key);
  });
  it('steps down to the passage when a two-passage join breaks in one of them', () => {
    const plan = planOf(2);
    const state = missTwice(bronze(undefined, plan, ['p1', 'p2']), plan, check(plan, 'join:p1:p2'), { ...bad, spans: spansOf({ 5: 3, 6: 2 }) });
    expect(proj(plan, state).recommended).toMatchObject({ reason: 'smaller-join', stepDown: 'p2', range: { start: 4, end: 7 } });
  });
  it('drills the seam first when the worst bar sits on it', () => {
    const plan = planOf(4);
    const state = missTwice(ready4(plan), plan, check(plan, 'join:p1:p4'), { ...bad, spans: spansOf({ 7: 4, 9: 1 }) });
    expect(proj(plan, state).recommended).toMatchObject({ reason: 'seam', range: { start: 7, end: 8 } });
  });
  it('steps down, not to the seam, when the misses spread evenly through the half that starts at the seam', () => {
    const plan = planOf(4);
    const state = missTwice(ready4(plan), plan, check(plan, 'join:p1:p4'), { ...bad, spans: spansOf({ 8: 2, 9: 2, 10: 2, 11: 2, 12: 2, 13: 2, 14: 2, 15: 2 }) });
    expect(proj(plan, state).recommended).toMatchObject({ reason: 'smaller-join', stepDown: 'join:p3:p4' });
  });
  it('drills the hand first when one hand broke', () => {
    const plan = planOf(4);
    const parts = { rh: { diagnostics: { expected_notes: 10, missed_notes: 0, wrong_notes: 0 } }, lh: { diagnostics: { expected_notes: 10, missed_notes: 6, wrong_notes: 2 } } };
    const state = missTwice(ready4(plan), plan, check(plan, 'join:p1:p4'), { ...bad, parts, spans: spansOf({ 9: 3 }) });
    expect(proj(plan, state).recommended).toMatchObject({ reason: 'one-hand', parts: ['lh'], range: { start: 0, end: 15 } });
  });
  it('passing the half twice steps back up to the join', () => {
    const plan = planOf(4); const top = check(plan, 'join:p1:p4');
    let state = missTwice(ready4(plan), plan, top, { ...bad, spans: spansOf({ 9: 3 }) });
    const down = proj(plan, state).recommended;
    state = play(play(state, plan, down), plan, down);
    expect(state.resume.key).toBe(top.key);
    expect(proj(plan, state).recommended).toMatchObject({ passageId: 'join:p1:p4', depth: 0 });
  });
  it('credits nothing of the half: no counts, no achievements, no evidence on its steps, no coin taken', () => {
    const plan = planOf(4); const top = check(plan, 'join:p1:p4');
    let state = missTwice(ready4(plan), plan, top, { ...bad, spans: spansOf({ 9: 3 }) });
    const before = proj(plan, state).segments.find((s) => s.id === 'join:p3:p4');
    const down = proj(plan, state).recommended;
    expect(plan.tasks.some((t) => t.key === down.key)).toBe(false);
    const counts = structuredClone(state.counts); const achievements = Object.keys(state.achievements);
    state = play(play(state, plan, down), plan, down);
    expect(Object.keys(state.achievements)).toEqual(achievements);
    const half = plan.segments.find((s) => s.id === 'join:p3:p4');
    for (const t of [...half.tasks, ...plan.segments.filter((s) => s.id === 'p3' || s.id === 'p4').flatMap((s) => s.tasks)]) {
      expect(state.counts[t.key]).toEqual(counts[t.key]);
      expect(state.evidence.some((e) => e.task.key === down.key && e.eligible.includes(t.key))).toBe(false);
    }
    const after = proj(plan, state).segments.find((s) => s.id === 'join:p3:p4');
    expect(after.skills.map((t) => t.ready)).toEqual(before.skills.map((t) => t.ready));
    expect(after.certification.silver).toBeTruthy();
  });
  it('a timed step down on a join\'s Gold credits none of the passage\'s Gold rungs', () => {
    const plan = planOf(4);
    const timed = plan.segments.find((s) => s.id === 'join:p1:p2').tasks.find((t) => t.skill === 'timed-70');
    let state = missTwice(ready4(plan), plan, timed, { ...bad, spans: spansOf({ 1: 3, 2: 2 }) });
    const down = projectCoach({ plan, state, dayKey }).goldResume;
    expect(down).toMatchObject({ reason: 'smaller-join', stepDown: 'p1', mode: 'cued', tempoPercent: 70, range: { start: 0, end: 3 } });
    state = play(play(state, plan, down), plan, down);
    const p1 = proj(plan, state).segments.find((s) => s.id === 'p1');
    expect(p1.skills.filter((t) => t.track === 'gold').some((t) => t.ready)).toBe(false);
    expect(p1.certification.gold).toBeFalsy();
    expect(state.goldResume.key).toBe(timed.key);
  });
  it('the retention run of the whole piece steps down the same way', () => {
    const plan = planOf(2);
    let state = play(bronze(undefined, plan, ['p1', 'p2']), plan, check(plan, 'join:p1:p2'));
    const review = projectCoach({ plan, state, dayKey: '2026-11-26' }).review;
    expect(review).toMatchObject({ reason: 'retention' });
    const miss = (s, id) => applyCoachEvent(s, { id, type: 'outcome', task: review, result: { ...bad, spans: spansOf({ 5: 3, 6: 2 }) } }, { plan, now: '2026-11-26T18:00:00Z', dayKey: '2026-11-26' });
    state = miss(miss(state, 'r1'), 'r2');
    const next = projectCoach({ plan, state, dayKey: '2026-11-26' }).recommended;
    expect(next).toMatchObject({ reason: 'smaller-join', stepDown: 'p2', range: { start: 4, end: 7 }, depth: 1 });
    expect(next.parent).toMatchObject({ review: true, reason: 'retention' });
  });
});
