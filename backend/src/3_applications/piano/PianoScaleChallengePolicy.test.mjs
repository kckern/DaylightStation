import { describe, expect, it } from 'vitest';
import { PianoScaleChallengePolicy } from './PianoScaleChallengePolicy.mjs';

function prepare(policy, overrides = {}) {
  return policy.prepare({
    userId: 'guest',
    challengeId: 'challenge-1',
    kind: 'scale',
    requirements: { curriculum: 'foundation-major-scales' },
    context: { challenge_sequence: 0 },
    ...overrides,
  });
}

describe('PianoScaleChallengePolicy', () => {
  it('materializes a semantic request into one internally consistent exercise', () => {
    const result = prepare(new PianoScaleChallengePolicy());
    expect(result).toMatchObject({
      challenge_id: 'challenge-1',
      kind: 'scale',
      timeout_ms: 90000,
      pedagogy_policy_version: 'foundation-major-scales-v1',
      selection: { curriculum: 'foundation-major-scales', prior_attempts: 0, prior_average: null },
      prompt: {
        label: 'C major scale',
        scale: { tonic: 'C', octave: 4, mode: 'major', direction: 'ascending', octaves: 1 },
        expected_midi: [60, 62, 64, 65, 67, 69, 71, 72],
      },
    });
  });

  it('explores unattempted exercises before revisiting completed ones', () => {
    const attemptStore = {
      listRecent: () => [{ status: 'completed', score: 0.2, prompt: { scale: { tonic: 'C', mode: 'major' } } }],
    };
    const result = prepare(new PianoScaleChallengePolicy({ attemptStore }), {
      context: { challenge_sequence: 1 },
    });
    expect(result.prompt.scale.tonic).toBe('F');
    expect(result.selection.prior_attempts).toBe(0);
  });

  it('revisits the weakest exercise after each candidate has evidence', () => {
    const attempts = ['C', 'G', 'F', 'D'].map((tonic, index) => ({
      status: 'completed',
      score: tonic === 'F' ? 0.25 : 0.8 + index * 0.01,
      prompt: { scale: { tonic, mode: 'major' } },
    }));
    const result = prepare(new PianoScaleChallengePolicy({ attemptStore: { listRecent: () => attempts } }));
    expect(result.prompt.scale.tonic).toBe('F');
    expect(result.selection).toMatchObject({ prior_attempts: 1, prior_average: 0.25 });
  });

  it('rejects unsupported kinds and curricula at the Piano boundary', () => {
    const policy = new PianoScaleChallengePolicy();
    expect(() => prepare(policy, { kind: 'rhythm' })).toThrow(/Unsupported piano challenge kind/);
    expect(() => prepare(policy, { requirements: { curriculum: 'imaginary' } })).toThrow(/Unknown piano curriculum/);
  });

  it.each([
    ['scale', 8],
    ['chord', 3],
    ['arpeggio', 4],
    ['timed-pattern', 4],
  ])('materializes the journey %s family from the adaptive curriculum', (kind, noteCount) => {
    const result = prepare(new PianoScaleChallengePolicy(), {
      kind,
      requirements: { curriculum: 'pokemon-journey-foundations' },
    });
    expect(result).toMatchObject({
      kind,
      pedagogy_policy_version: 'adaptive-piano-journey-v1',
      selection: { curriculum: 'pokemon-journey-foundations', paced: false, tempo_bpm: null },
    });
    expect(result.prompt.expected_midi).toHaveLength(noteCount);
    expect(result.prompt.max_mistakes).toBeUndefined();
  });

  it('introduces a 60 BPM pulse after two strong performances', () => {
    const attemptStore = {
      listRecent: () => [
        { kind: 'timed-pattern', status: 'completed', score: 0.9, prompt: { exercise_id: 'pattern-c-step' } },
        { kind: 'timed-pattern', status: 'completed', score: 0.86, prompt: { exercise_id: 'pattern-g-turn' } },
      ],
    };
    const result = prepare(new PianoScaleChallengePolicy({ attemptStore }), {
      kind: 'timed-pattern',
      requirements: { curriculum: 'pokemon-journey-foundations' },
    });
    expect(result.selection).toMatchObject({ paced: true, tempo_bpm: 60 });
    expect(result.prompt).toMatchObject({ tempo_bpm: 60, lead_in_ms: 2000 });
    expect(result.prompt.target_offsets_ms).toEqual(expect.arrayContaining([0, 1000]));
  });

  it('adjusts paced work in five-BPM steps toward the 70–90% practice band', () => {
    const fasterAttempts = [
      { kind: 'scale', status: 'completed', score: 0.96, prompt: { tempo_bpm: 70 } },
      { kind: 'scale', status: 'completed', score: 0.94, prompt: { tempo_bpm: 65 } },
    ];
    const faster = prepare(new PianoScaleChallengePolicy({ attemptStore: { listRecent: () => fasterAttempts } }), {
      kind: 'scale', requirements: { curriculum: 'pokemon-journey-foundations' },
    });
    expect(faster.selection.tempo_bpm).toBe(75);

    const slowerAttempts = [
      { kind: 'scale', status: 'completed', score: 0.62, prompt: { tempo_bpm: 55 } },
      { kind: 'scale', status: 'completed', score: 0.66, prompt: { tempo_bpm: 55 } },
      { kind: 'scale', status: 'completed', score: 0.9, prompt: {} },
      { kind: 'scale', status: 'completed', score: 0.88, prompt: {} },
    ];
    const slower = prepare(new PianoScaleChallengePolicy({ attemptStore: { listRecent: () => slowerAttempts } }), {
      kind: 'scale', requirements: { curriculum: 'pokemon-journey-foundations' },
    });
    expect(slower.selection.tempo_bpm).toBe(50);
  });
});
