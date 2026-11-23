import { describe, expect, it } from 'vitest';
import { createCoachPlan, projectCoach, applyCoachEvent, coachSummary, buildJoinTree } from './learnCoach.mjs';

const seg = (n, parts = ['rh', 'lh']) => ({ id: `p${n}`, inMeasure: (n - 1) * 4, outMeasure: n * 4 - 1, printedMeasures: [String((n - 1) * 4 + 1), String(n * 4)], playableParts: parts });
const many = (count, parts) => Array.from({ length: count }, (_, i) => seg(i + 1, parts));
const planOf = (count = 6, parts) => createCoachPlan({ scoreId: 'files:t.musicxml', fingerprint: 'fp', segments: many(count, parts), tempoMap: [{ onsetQuarter: 0, bpm: 100 }] });
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
    expect(join.tasks.map((t) => t.skill)).toEqual(['notes', 'silver']);
    expect(join.tasks.some((t) => t.track === 'gold')).toBe(false);
    expect(join.demonstration).toBeNull();
  });
  it('is exported pure', () => {
    expect(buildJoinTree(many(2)).map((j) => j.id)).toEqual(['join:p1:p2']);
  });
});

describe('piece Silver is the final join', () => {
  it('counts passages only and offers the first join after its two passages', () => {
    const plan = planOf(6);
    let state = bronze(undefined, plan, ['p1']);
    expect(proj(plan, state).recommended.passageId).toBe('p2');
    state = bronze(state, plan, ['p2']);
    const p = proj(plan, state);
    expect(p.piece).toMatchObject({ total: 6, silver: 2, pieceSilver: false, joins: { total: 5, silver: 0 } });
    expect(p.recommended).toMatchObject({ passageId: 'join:p1:p2', assist: 'none' });
  });
  it('never recommends a join over a passage that has no Silver yet', () => {
    const plan = planOf(4);
    const state = bronze(undefined, plan, ['p1', 'p2', 'p3']);
    expect(proj(plan, state).recommended.passageId).toBe('join:p1:p2');
    const only = bronze(undefined, plan, ['p1']);
    expect(proj(plan, only).recommended.passageId).toBe('p2');
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
    const result = { ...bad, spans: { 'measure:1': span(3), 'measure:2': span(1) } };
    expect(proj(plan, missTwice(plan, 'join:p1:p2', result)).recommended).toMatchObject({ reason: 'focus-bars', range: { start: 0, end: 1 } });
  });
});
