import { describe, it, expect } from 'vitest';
import { deckSets, deckProjection } from './deckProgress.js';
import { keysInstance } from '../Games/gateMaterial.js';

/**
 * The rung this exists for, as a household authors it: three pitches, three
 * consecutive cards each. Built from the real material factory rather than a
 * hand-written fixture, so a change to how reps are dealt fails here.
 */
const SIGHTREAD_3x3 = { kind: 'keys', notes: 3, arrangement: 'sequence', reps: 3 };
const standing = (instance, cursor) => deckProjection(instance, deckSets(instance), cursor);

describe('reading a run\'s own set/rep structure', () => {
  it('finds three sets of three in the gate\'s sight-reading deck', () => {
    const sets = deckSets(keysInstance(SIGHTREAD_3x3, 0));
    expect(sets.map((set) => set.size)).toEqual([3, 3, 3]);
  });

  it('groups only CONSECUTIVE repeats, so a scale that revisits a pitch is not a deck', () => {
    // G up to the octave and back: the bottom G returns nine notes later.
    const scale = { events: [67, 69, 71, 72, 74, 76, 78, 79, 78, 76, 74, 72, 71, 69, 67].map((midi, i) => ({ id: `n${i}`, notes: [{ midi }] })) };
    expect(deckSets(scale).every((set) => set.size === 1)).toBe(true);
    expect(standing(scale, 0)).toBeNull();
  });

  it('declines a run of distinct notes — the staff already shows where you are', () => {
    const line = { events: [60, 62, 64, 65].map((midi, i) => ({ id: `n${i}`, notes: [{ midi }] })) };
    expect(standing(line, 1)).toBeNull();
  });

  it('declines a single card, and anything with no pitch in it', () => {
    expect(deckSets({ events: [{ id: 'one', notes: [{ midi: 60 }] }] })).toBeNull();
    expect(deckSets({ events: [{ id: 'a', notes: [] }, { id: 'b', notes: [] }] })).toBeNull();
    expect(deckSets(null)).toBeNull();
  });
});

describe('where the child is in the deck', () => {
  const instance = keysInstance(SIGHTREAD_3x3, 0);

  it('banks nothing and marks the first set current before a note is played', () => {
    const { steps, current_step: current } = standing(instance, 0);
    expect(steps.map((s) => s.pass_count)).toEqual([0, 0, 0]);
    expect(steps.map((s) => s.state)).toEqual(['current', 'upcoming', 'upcoming']);
    expect(current.id).toBe('card-1');
  });

  it('banks reps within the live set as the cursor walks it', () => {
    expect(standing(instance, 2).steps.map((s) => s.pass_count)).toEqual([2, 0, 0]);
    expect(standing(instance, 2).steps[0].passed).toBe(false);
  });

  it('closes a set and moves the current marker on at its last card', () => {
    const { steps } = standing(instance, 3);
    expect(steps[0]).toMatchObject({ passed: true, pass_count: 3, state: 'passed' });
    expect(steps[1].state).toBe('current');
  });

  it('never banks a rep into a set the cursor has not reached', () => {
    expect(standing(instance, 4).steps.map((s) => s.pass_count)).toEqual([3, 1, 0]);
  });

  it('finishes with every rep banked and no current set', () => {
    const projection = standing(instance, 9);
    expect(projection.steps.every((s) => s.passed)).toBe(true);
    expect(projection.current_step).toBeNull();
    expect(projection.complete).toBe(true);
  });

  it('carries no label on any set — a reading deck must not print the answer', () => {
    for (const step of standing(instance, 0).steps) {
      expect(step.display).toBeUndefined();
      expect(step.title).toBeUndefined();
    }
  });

  it('survives a cursor that is nonsense rather than throwing at a child', () => {
    expect(standing(instance, -5).steps[0].pass_count).toBe(0);
    expect(standing(instance, NaN).steps[0].pass_count).toBe(0);
    expect(standing(instance, undefined).steps[0].pass_count).toBe(0);
  });
});
