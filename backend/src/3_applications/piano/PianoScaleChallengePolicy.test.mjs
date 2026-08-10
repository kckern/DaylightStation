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
});
