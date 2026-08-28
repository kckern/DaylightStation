// exerciseAbc.js — instance-to-ABC notation conversion for ExerciseNotation.jsx,
// split out so Fast Refresh can hot-reload the notation component on its own.
import { generateAbc, generateMelodyAbc, midiToAbc } from '../../../../MusicNotation/renderers/abc.js';

export function instanceToAbc(instance) {
  if (!instance?.events?.length) return '';
  if (instance.ordering === 'any') {
    return generateAbc(new Map(instance.events.flatMap((event) => event.notes).map((note) => [note.midi, note])), instance.key ?? 'C');
  }
  const notesFor = (hand) => instance.events.map((event) => {
    const note = event.notes.find((candidate) => candidate.hand === hand)
      ?? (event.notes.length === 1 && !event.notes[0].hand ? event.notes[0] : null);
    return note ?? { rest: true };
  });
  const right = notesFor('right');
  const left = notesFor('left');
  const hasRight = right.some((note) => !note.rest);
  const hasLeft = left.some((note) => !note.rest);
  if (hasRight !== hasLeft) {
    const hand = hasRight ? right : left;
    const clef = hasRight ? 'treble' : 'bass';
    const tokens = hand.map((note) => {
      if (!note || note.rest) return 'x';
      const finger = note.finger != null ? `!${note.finger}!` : '';
      return `${finger}${midiToAbc(note.midi, instance.key ?? 'C')}`;
    }).join(' ');
    return `X:1\nL:1/16\nM:${instance.meter ?? '4/4'}\nK:${instance.key ?? 'C'}\nV:MAIN clef=${clef}\n[V:MAIN] ${tokens} |]`;
  }
  return generateMelodyAbc({
    meter: instance.meter ?? '4/4',
    hands: { right: [{ notes: right }], left: [{ notes: left }] },
  }, instance.key ?? 'C');
}
