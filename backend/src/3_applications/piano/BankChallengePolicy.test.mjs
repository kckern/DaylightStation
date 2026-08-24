import { describe, expect, it } from 'vitest';
import { BankChallengePolicy, estimateLevel, promptLabel, rankCandidates } from './BankChallengePolicy.mjs';

const triadSeed = {
  id: 'triads/all',
  title: 'Triads',
  key: 'C',
  staff: 'treble',
  ordering: 'any',
  supports: ['free', 'cued'],
  events: [{ notes: [{ midi: 60, hand: 'right' }, { midi: 64, hand: 'right' }, { midi: 67, hand: 'right' }] }],
  expansion: { axes: { root: { values: 'all' }, quality: { values: [{ id: 'major', intervals: [0, 4, 7] }] } } },
  derived: { form: 'chord' },
};

const scaleSeed = {
  id: 'scales/modes',
  title: 'Modes',
  key: 'C',
  ordering: 'strict',
  supports: ['free', 'metronome', 'cued'],
  events: [0, 2, 4, 5, 7, 9, 11, 12].map((s) => ({ value: '8th', notes: [{ midi: 60 + s, hand: 'right' }] })),
  expansion: { axes: { root: { values: 'all' } } },
  derived: { form: 'scale' },
};

const patternSeed = {
  ...scaleSeed,
  id: 'patterns/rhythm',
  title: 'Rhythm pattern',
  derived: { form: 'sequence' },
  tempo: { start_bpm: 84 },
};

const bank = (seeds = [triadSeed, scaleSeed, patternSeed]) => ({ available: () => true, allSeeds: () => seeds });
const store = (attempts) => ({ listRecent: () => attempts });

describe('level estimation', () => {
  it('starts new players low rather than guessing', () => {
    expect(estimateLevel([])).toBe(2);
    expect(estimateLevel([{ status: 'completed', score: 1, prompt: { level: 9 } }])).toBe(2);
  });

  it('climbs on sustained success and eases off on struggle', () => {
    const at = (score) => ({ status: 'completed', score, prompt: { level: 4 } });
    expect(estimateLevel([at(0.95), at(0.95), at(0.95), at(0.95)])).toBe(5);
    expect(estimateLevel([at(0.3), at(0.4), at(0.3), at(0.35)])).toBe(3);
    expect(estimateLevel([at(0.75), at(0.7), at(0.8), at(0.75)])).toBe(4, 'the middle holds steady');
  });

  it('ignores attempts that were never completed', () => {
    const aborted = [{ status: 'aborted', score: null }, { status: 'aborted', score: null }, { status: 'aborted', score: null }];
    expect(estimateLevel(aborted)).toBe(2);
  });

  it('stays inside the scale', () => {
    const at = (score) => ({ status: 'completed', score, prompt: { level: 10 } });
    expect(estimateLevel([at(1), at(1), at(1)])).toBeLessThanOrEqual(10);
    const low = (score) => ({ status: 'completed', score, prompt: { level: 1 } });
    expect(estimateLevel([low(0), low(0), low(0)])).toBeGreaterThanOrEqual(1);
  });
});

describe('candidate ranking', () => {
  const instances = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('puts the least-attempted first', () => {
    const attempts = [
      { prompt: { exercise_id: 'a' }, status: 'completed', score: 0.9 },
      { prompt: { exercise_id: 'a' }, status: 'completed', score: 0.9 },
      { prompt: { exercise_id: 'b' }, status: 'completed', score: 0.9 },
    ];
    expect(rankCandidates(instances, attempts).map((r) => r.instance.id)).toEqual(['c', 'b', 'a']);
  });

  it('breaks ties on the weakest average', () => {
    const attempts = [
      { prompt: { exercise_id: 'a' }, status: 'completed', score: 0.95 },
      { prompt: { exercise_id: 'b' }, status: 'completed', score: 0.40 },
    ];
    expect(rankCandidates([{ id: 'a' }, { id: 'b' }], attempts)[0].instance.id).toBe('b');
  });
});

describe('preparing a challenge from the bank', () => {
  const policy = (attempts = []) => new BankChallengePolicy({ exerciseBank: bank(), attemptStore: store(attempts) });

  it('serves a chord for the chord kind and a scale for the scale kind', () => {
    const chord = policy().prepare({ userId: 'u', challengeId: 'c1', kind: 'chord' });
    expect(chord.prompt.exercise_id).toMatch(/^triads\//);
    expect(chord.prompt.ordering).toBe('any');

    const scale = policy().prepare({ userId: 'u', challengeId: 'c2', kind: 'scale' });
    expect(scale.prompt.exercise_id).toMatch(/^scales\//);
    expect(scale.prompt.ordering).toBe('strict');
  });

  it('makes adaptive rhythm challenges cued with an exact generated requirement', () => {
    const prepared = policy().prepare({ userId: 'u', challengeId: 'rhythm', kind: 'timed-pattern' });
    expect(prepared.prompt.mode).toBe('cued');
    expect(prepared.prompt.expected_events).toEqual(expect.any(Array));
    expect(prepared.prompt.tempo_bpm).toBeGreaterThan(0);
    expect(prepared.requirement).toMatchObject({
      mode: 'cued', rubric: { criteria: { completeness: 1, cleanliness: 1, placement: 0.8 } },
    });
  });

  it('carries the notes to play and the level it chose', () => {
    const prepared = policy().prepare({ userId: 'u', challengeId: 'c1', kind: 'chord' });
    expect(prepared.prompt.expected_midi.length).toBe(3);
    expect(prepared.prompt.level).toBeGreaterThan(0);
    expect(prepared.selection.curriculum).toBe('exercise-bank');
    expect(prepared.selection.pool).toBeGreaterThan(1, 'the pool is the bank, not a constant');
  });

  it('rotates through equally-stale candidates so a session does not repeat', () => {
    const p = policy();
    const first = p.prepare({ userId: 'u', challengeId: 'c1', kind: 'chord', context: { challenge_sequence: 0 } });
    const second = p.prepare({ userId: 'u', challengeId: 'c2', kind: 'chord', context: { challenge_sequence: 1 } });
    expect(second.prompt.exercise_id).not.toBe(first.prompt.exercise_id);
  });

  it('prefers what the player has not done', () => {
    const prepared = policy().prepare({ userId: 'u', challengeId: 'c1', kind: 'chord' });
    const seen = [{ prompt: { exercise_id: prepared.prompt.exercise_id }, status: 'completed', score: 0.99 }];
    const next = policy(seen).prepare({ userId: 'u', challengeId: 'c2', kind: 'chord' });
    expect(next.prompt.exercise_id).not.toBe(prepared.prompt.exercise_id);
  });

  it('widens the band rather than failing when the level is empty', () => {
    // Nothing sits at level 10, but the game must still get a card.
    const prepared = policy().prepare({ userId: 'u', challengeId: 'c1', kind: 'chord', requirements: { level: 10 } });
    expect(prepared.prompt.exercise_id).toBeTruthy();
  });

  it('refuses a kind the bank has no form for', () => {
    expect(() => policy().prepare({ userId: 'u', challengeId: 'c1', kind: 'yodelling' }))
      .toThrow(/Unsupported piano challenge kind/);
  });

  it('refuses when the bank holds nothing of that form', () => {
    const empty = new BankChallengePolicy({ exerciseBank: bank([scaleSeed]), attemptStore: store([]) });
    expect(() => empty.prepare({ userId: 'u', challengeId: 'c1', kind: 'chord' })).toThrow(/No bank material/);
  });
});

describe('prompt labels', () => {
  it('names the instance, not the seed', () => {
    expect(promptLabel({ title: 'Triads', axes: { root: 'D', quality: 'minor' } })).toBe('D minor');
    expect(promptLabel({ title: 'Triads', axes: { root: 'D', quality: 'minor', inversion: '1st' } })).toBe('D minor 1st inversion');
  });

  it('keeps the title when the axes alone name nothing', () => {
    // A drill transposed to A is "A", which is a key, not an exercise.
    expect(promptLabel({ title: 'Play C-D-E', axes: { root: 'A' } })).toBe('A — Play C-D-E');
    expect(promptLabel({ title: 'Play C-D-E', axes: {} })).toBe('Play C-D-E');
  });
});
