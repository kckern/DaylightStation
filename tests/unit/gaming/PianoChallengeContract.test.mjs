import { describe, expect, it } from 'vitest';
import { PianoScaleChallengePolicy } from '../../../backend/src/3_applications/piano/PianoScaleChallengePolicy.mjs';
import { generateScaleAbc, midiToAbc } from '../../../frontend/src/modules/MusicNotation/renderers/abc.js';
import { advanceScaleProgress } from '../../../frontend/src/modules/Piano/challenge/provider/scaleProgress.js';

describe('semantic piano challenge contract', () => {
  it('uses the exact same pitches for staff generation and grading', () => {
    const policy = new PianoScaleChallengePolicy();
    for (let challengeSequence = 0; challengeSequence < 4; challengeSequence += 1) {
      const prepared = policy.prepare({
        userId: 'guest', challengeId: `challenge-${challengeSequence}`, kind: 'scale',
        requirements: { curriculum: 'foundation-major-scales' },
        context: { challenge_sequence: challengeSequence },
      });
      const { expected_midi: pitches, key_signature: key } = prepared.prompt;
      const abc = generateScaleAbc(pitches, key);
      expect(abc.split('\n').at(-1)).toBe(`${pitches.map((pitch) => midiToAbc(pitch, key)).join(' ')} |]`);

      let progress = 0;
      for (const pitch of pitches) progress = advanceScaleProgress(pitches, progress, pitch).progress;
      expect(progress).toBe(pitches.length);
    }
  });

  it('treats F4 as correct and D4 as wrong for an F-major exercise', () => {
    const prepared = new PianoScaleChallengePolicy().prepare({
      userId: 'guest', challengeId: 'challenge-f', kind: 'scale',
      requirements: { curriculum: 'foundation-major-scales' },
      context: { challenge_sequence: 2 },
    });
    expect(prepared.prompt).toMatchObject({
      scale: { tonic: 'F', octave: 4 },
      expected_midi: [65, 67, 69, 70, 72, 74, 76, 77],
    });
    expect(advanceScaleProgress(prepared.prompt.expected_midi, 0, 65)).toMatchObject({ wrong: false, progress: 1 });
    expect(advanceScaleProgress(prepared.prompt.expected_midi, 0, 62)).toMatchObject({ wrong: true, progress: 0 });
  });
});
