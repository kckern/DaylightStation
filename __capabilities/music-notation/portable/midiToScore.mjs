// midiToScore — Standard MIDI (normalised) → MusicNotation Score model. Pure.
//
// The Score model is MusicNotation's decoupling seam (see parseMusicXml.js): all
// renderers (abc / vexflow / svg staff / falling-notes) and the cursor/play-along
// layers consume it. Converting MIDI straight to this model skips the lossy
// MIDI→MusicXML transcription step entirely.
//
// Input is a normalised intermediate (a thin adapter pulls it off a @tonejs/midi
// object): { ppq, tempo, timeSig:[beats,beatType], key?:{fifths}, notes:[{ticks,
// durationTicks, midi}] }.

// pitch class → { step, alter } using sharp spelling.
const PC_SPELL = [
  { step: 'C', alter: 0 }, { step: 'C', alter: 1 }, { step: 'D', alter: 0 }, { step: 'D', alter: 1 },
  { step: 'E', alter: 0 }, { step: 'F', alter: 0 }, { step: 'F', alter: 1 }, { step: 'G', alter: 0 },
  { step: 'G', alter: 1 }, { step: 'A', alter: 0 }, { step: 'A', alter: 1 }, { step: 'B', alter: 0 },
];

/** MIDI note number → { step, octave, alter }. 60 = C4. */
export function midiToPitch(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return { ...PC_SPELL[pc], octave: Math.floor(midi / 12) - 1 };
}

/**
 * Convert a normalised MIDI intermediate into a Score model.
 * @param {{ppq:number, tempo?:number, timeSig?:number[], key?:{fifths:number}, notes:Array}} parsed
 */
export function midiToScore(parsed) {
  const ppq = parsed.ppq || 480;
  const [beats, beatType] = parsed.timeSig || [4, 4];

  const notes = [...(parsed.notes || [])]
    .sort((a, b) => a.ticks - b.ticks || a.midi - b.midi)
    .map((n) => ({
      staff: 1,
      voice: 1,
      rest: false,
      chord: false,
      duration: n.durationTicks,
      durationQuarters: n.durationTicks / ppq,
      onsetQuarter: n.ticks / ppq,
      midi: n.midi,
      pitch: midiToPitch(n.midi),
    }));

  return {
    divisions: ppq,
    tempo: parsed.tempo ?? 100,
    timeSig: { beats, beatType },
    key: parsed.key || { fifths: 0 },
    parts: [{ id: 'P1', name: 'MIDI', staves: 1, clefs: {}, measures: [], notes }],
  };
}

export default midiToScore;
