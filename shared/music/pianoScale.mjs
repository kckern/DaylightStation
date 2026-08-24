const PITCH_CLASSES = Object.freeze({
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
  'A#': 10, Bb: 10, B: 11,
});

const MODES = Object.freeze({
  major: { intervals: [0, 2, 4, 5, 7, 9, 11, 12], label: 'major' },
  'natural-minor': { intervals: [0, 2, 3, 5, 7, 8, 10, 12], label: 'natural minor' },
});

export function scaleSpecErrors(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['scale must be an object'];
  if (!Object.hasOwn(PITCH_CLASSES, spec.tonic)) errors.push('scale.tonic must be a musical note such as C, F#, or Bb');
  if (!Number.isInteger(spec.octave) || spec.octave < 0 || spec.octave > 8) errors.push('scale.octave must be an integer from 0 to 8');
  if (!Object.hasOwn(MODES, spec.mode)) errors.push(`scale.mode must be one of: ${Object.keys(MODES).join(', ')}`);
  if (spec.direction !== undefined && !['ascending', 'descending'].includes(spec.direction)) {
    errors.push('scale.direction must be ascending or descending');
  }
  if (spec.octaves !== undefined && (!Number.isInteger(spec.octaves) || spec.octaves < 1 || spec.octaves > 3)) {
    errors.push('scale.octaves must be an integer from 1 to 3');
  }
  if (errors.length === 0) {
    const root = (spec.octave + 1) * 12 + PITCH_CLASSES[spec.tonic];
    const highest = root + 12 * (spec.octaves ?? 1);
    if (highest > 127) errors.push('scale extends beyond the MIDI note range');
  }
  return errors;
}

/** Convert a semantic musical scale into the runtime pitches used by grading. */
export function materializePianoScalePrompt(prompt) {
  const errors = scaleSpecErrors(prompt?.scale);
  if (errors.length > 0) throw new Error(`Invalid piano scale: ${errors.join('; ')}`);
  const spec = prompt.scale;
  const mode = MODES[spec.mode];
  const octaveCount = spec.octaves ?? 1;
  const root = (spec.octave + 1) * 12 + PITCH_CLASSES[spec.tonic];
  const expectedMidi = [];
  for (let octave = 0; octave < octaveCount; octave += 1) {
    expectedMidi.push(...mode.intervals.slice(0, -1).map((interval) => root + octave * 12 + interval));
  }
  expectedMidi.push(root + octaveCount * 12);
  if ((spec.direction ?? 'ascending') === 'descending') expectedMidi.reverse();
  return {
    ...structuredClone(prompt),
    label: prompt.label || `${spec.tonic} ${mode.label} scale`,
    key_signature: prompt.key_signature || `${spec.tonic}${spec.mode === 'natural-minor' ? 'm' : ''}`,
    expected_midi: expectedMidi,
    expected_events: expectedMidi.map((midi, index) => ({
      id: `${prompt.exercise_id || 'scale'}:event:${index}`,
      onsetQuarter: index,
      durationQuarters: 1,
      notes: [{ id: `${prompt.exercise_id || 'scale'}:note:${index}`, midi, hand: 'unassigned' }],
    })),
  };
}
