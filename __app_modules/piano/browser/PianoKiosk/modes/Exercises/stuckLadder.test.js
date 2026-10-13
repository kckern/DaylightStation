import { describe, it, expect } from 'vitest';
import { nextHuntState, huntRungFor, huntingArmed, HUNT_RUNGS, NO_HUNT } from './stuckLadder.js';

/**
 * The ladder, against the session that caused it to exist: thirty consecutive
 * wrong notes at one cursor with no response of any kind from the run.
 */
const wrong = (cursor) => ({ type: 'wrong', cursor });
const right = (cursor) => ({ type: 'onset_complete', cursor });

const fold = (observations, from = NO_HUNT) =>
  observations.reduce((state, o) => nextHuntState(state, o), from);

describe('the stuck ladder', () => {
  it('owes nothing until a child has actually missed a few times', () => {
    expect(fold([wrong(1)]).help).toBeNull();
    expect(fold([wrong(1), wrong(1)]).help).toBeNull();
  });

  it('re-cues the lit key on the third consecutive miss at one target', () => {
    const state = fold([wrong(1), wrong(1), wrong(1)]);
    expect(state.wrongs).toBe(3);
    expect(state.help).toBe('recue');
    expect(state.changed, 'the rung moved, so the run should re-render and log').toBe(true);
  });

  it('does not re-announce a rung it is already on', () => {
    const third = fold([wrong(1), wrong(1), wrong(1)]);
    const fourth = nextHuntState(third, wrong(1));
    expect(fourth.help).toBe('recue');
    expect(fourth.changed, 'a fourth miss climbs nothing — it is already an observation').toBe(false);
  });

  it('names the note once looking harder has stopped being the answer', () => {
    const state = fold(Array.from({ length: 6 }, () => wrong(1)));
    expect(state.help).toBe('reveal');
    expect(state.changed).toBe(true);
  });

  /**
   * THE FIELD CASE. Thirty wrongs at one cursor is what the run used to answer
   * with nothing; it must reach the top rung and then stay put rather than
   * inventing new ones.
   */
  it('climbs to the top rung on the run that caused this and stops there', () => {
    const state = fold(Array.from({ length: 30 }, () => wrong(1)));
    expect(state.wrongs).toBe(30);
    expect(state.help).toBe('reveal');
  });

  it('forgets everything the moment the child moves on', () => {
    const stuck = fold(Array.from({ length: 8 }, () => wrong(1)));
    expect(stuck.help).toBe('reveal');
    const moved = nextHuntState(stuck, right(2));
    expect(moved, 'the next note is owed nothing: those guesses were about a note now played')
      .toMatchObject({ cursor: 2, wrongs: 0, help: null, changed: true });
  });

  it('counts per target, not per run', () => {
    // Two misses here, two misses there: neither target is being hunted.
    const state = fold([wrong(1), wrong(1), right(2), wrong(2), wrong(2)]);
    expect(state.wrongs).toBe(2);
    expect(state.help).toBeNull();
  });

  it('is not armed for a cued run, which is judged against a beat', () => {
    expect(huntingArmed('timed')).toBe(false);
    expect(huntingArmed('cursor')).toBe(true);
    expect(huntingArmed('held')).toBe(true);
  });

  it('exposes its rungs in climbing order, so the caller cannot skip one', () => {
    expect(HUNT_RUNGS.map((r) => r.wrongs)).toEqual([...HUNT_RUNGS.map((r) => r.wrongs)].sort((a, b) => a - b));
    expect(huntRungFor(0)).toBeNull();
    expect(huntRungFor(HUNT_RUNGS[0].wrongs)).toBe(HUNT_RUNGS[0].help);
    expect(huntRungFor(HUNT_RUNGS.at(-1).wrongs + 100)).toBe(HUNT_RUNGS.at(-1).help);
  });
});
