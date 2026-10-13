// LiveKeyboard.jsx — PianoKeyboard bound to the live-note store. The
// subscription re-renders THIS leaf per note event; parents stay still
// (2026-07-06 decoupling audit R1). Use instead of passing activeNotes down
// from a usePianoMidi() consumer.
import { usePianoMidiNotes } from './PianoMidiContext.jsx';
import { PianoKeyboard } from '../components/PianoKeyboard.jsx';

export default function LiveKeyboard(props) {
  const { activeNotes } = usePianoMidiNotes();
  return <PianoKeyboard activeNotes={activeNotes} {...props} />;
}
