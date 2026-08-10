import { describe, expect, it } from 'vitest';
import { materializePianoScalePrompt, scaleSpecErrors } from './pianoScale.mjs';

describe('materializePianoScalePrompt', () => {
  it.each([
    ['C', 4, [60, 62, 64, 65, 67, 69, 71, 72]],
    ['G', 4, [67, 69, 71, 72, 74, 76, 78, 79]],
    ['F', 4, [65, 67, 69, 70, 72, 74, 76, 77]],
    ['D', 4, [62, 64, 66, 67, 69, 71, 73, 74]],
  ])('turns semantic %s major into its grading pitches', (tonic, octave, expected) => {
    const prompt = materializePianoScalePrompt({
      scale: { tonic, octave, mode: 'major', direction: 'ascending', octaves: 1 },
    });
    expect(prompt.expected_midi).toEqual(expected);
    expect(prompt.label).toBe(`${tonic} major scale`);
    expect(prompt.key_signature).toBe(tonic);
  });

  it('rejects invalid semantic music instead of generating an ambiguous exercise', () => {
    expect(scaleSpecErrors({ tonic: 'H', octave: 4, mode: 'major' })).toContain(
      'scale.tonic must be a musical note such as C, F#, or Bb',
    );
  });
});
