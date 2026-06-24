import { useMemo } from 'react';
import { NoteWaterfall } from '../../../components/NoteWaterfall.jsx';
import { CurrentChordStaff } from '../../../components/CurrentChordStaff.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { computeKeyboardRange } from '../../../noteUtils.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';

/**
 * Studio play view — the freeform instrument. Three stacked panes that all read
 * from the live MIDI surface: the current-chord staff on top, the falling-notes
 * waterfall filling the middle, and a touch-playable keyboard pinned at the foot.
 * Pressing the on-screen keyboard sounds the piano (echoed out the MIDI port) and
 * feeds the same activeNotes/noteHistory, so it drives the staff and waterfall too.
 */
export default function StudioPlay() {
  const { activeNotes, noteHistory, pressNote, releaseNote } = usePianoMidi();
  const { startNote, endNote } = useMemo(() => computeKeyboardRange(null), []);

  return (
    <div className="piano-studio-play">
      <div className="piano-studio-play__staff">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>

      <div className="piano-studio-play__waterfall">
        <NoteWaterfall
          noteHistory={noteHistory}
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
        />
      </div>

      <div className="piano-studio-play__keys">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </div>
    </div>
  );
}
