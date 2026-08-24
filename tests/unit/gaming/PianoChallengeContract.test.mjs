import { describe, expect, it } from 'vitest';
import { BankChallengePolicy } from '../../../backend/src/3_applications/piano/BankChallengePolicy.mjs';
import { generateScaleAbc, midiToAbc } from '../../../frontend/src/modules/MusicNotation/renderers/abc.js';
import {
  createAssessmentAttempt,
  observeAssessment,
  prepareExerciseAssessment,
  startAssessmentAttempt,
} from '../../../frontend/src/modules/Piano/performance/assessmentSession.js';

function pitchesOf(prompt) {
  return prompt.expected_events.flatMap((event) => event.notes.map((note) => note.midi));
}

const scaleSeed = {
  id: 'scales/major',
  title: 'Major scale',
  key: 'C',
  ordering: 'strict',
  supports: ['free', 'metronome', 'cued'],
  events: [0, 2, 4, 5, 7, 9, 11, 12].map((interval) => ({
    value: '8th',
    notes: [{ midi: 60 + interval, hand: 'right' }],
  })),
  expansion: { axes: { root: { values: 'all' } } },
  derived: { form: 'scale' },
};
const policy = () => new BankChallengePolicy({
  exerciseBank: { allSeeds: () => [scaleSeed] },
  attemptStore: { listRecent: () => [] },
});
const preparedScale = (challengeSequence) => policy().prepare({
  userId: 'guest',
  challengeId: `challenge-${challengeSequence}`,
  kind: 'scale',
  requirements: { curriculum: 'piano-foundations-v1' },
  context: { challenge_sequence: challengeSequence },
});

function attemptFor(prepared) {
  const configured = prepareExerciseAssessment({
    instance: {
      id: prepared.prompt.exercise_id,
      ordering: prepared.kind === 'chord' ? 'any' : 'strict',
      events: prepared.prompt.expected_events,
    },
    mode: 'free',
    purpose: 'challenge',
  });
  return startAssessmentAttempt(createAssessmentAttempt(configured), { time: 0 });
}

describe('semantic piano challenge contract', () => {
  it('uses the exact same pitches for staff generation and grading', () => {
    for (let challengeSequence = 0; challengeSequence < 4; challengeSequence += 1) {
      const prepared = preparedScale(challengeSequence);
      const pitches = pitchesOf(prepared.prompt);
      const { key_signature: key } = prepared.prompt;
      const abc = generateScaleAbc(pitches, key);
      expect(abc.split('\n').at(-1)).toBe(`${pitches.map((pitch) => midiToAbc(pitch, key)).join(' ')} |]`);

      let attempt = attemptFor(prepared);
      for (const [index, pitch] of pitches.entries()) {
        attempt = observeAssessment(attempt, { midi: pitch, time: index + 1 }).attempt;
      }
      expect(attempt.status).toBe('completed');
    }
  });

  it('treats F4 as correct and D4 as wrong for an F-major exercise', () => {
    const prepared = Array.from({ length: 12 }, (_, sequence) => preparedScale(sequence))
      .find((candidate) => pitchesOf(candidate.prompt)[0] === 65);
    expect(prepared).toBeTruthy();
    expect(prepared.prompt.expected_events).toEqual(expect.any(Array));
    expect(pitchesOf(prepared.prompt)).toEqual([65, 67, 69, 70, 72, 74, 76, 77]);
    expect(observeAssessment(attemptFor(prepared), { midi: 65, time: 1 }).attempt).toMatchObject({ cursor: 1, wrong: [] });
    expect(observeAssessment(attemptFor(prepared), { midi: 62, time: 1 }).attempt).toMatchObject({ cursor: 0, wrong: [expect.any(Object)] });
  });
});
