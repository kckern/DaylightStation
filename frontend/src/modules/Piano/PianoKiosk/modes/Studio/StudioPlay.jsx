import { useMemo } from 'react';
import { NoteWaterfall } from '../../../components/NoteWaterfall.jsx';
import { StudioTopPane } from '../../../components/StudioTopPane.jsx';
import { TheoryPanel } from '../../../components/TheoryPanel.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { computeKeyboardRange } from '../../../noteUtils.js';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';

/**
 * Studio play view — the freeform instrument. Three stacked panes that all read
 * from the live MIDI surface: the current-chord staff on top, the falling-notes
 * waterfall filling the middle, and a touch-playable keyboard pinned at the foot.
 * The Record button now lives in the tab bar (see Studio.jsx / RecordButton.jsx),
 * so it no longer floats over the staff here.
 */
export default function StudioPlay() {
  const { pressNote, releaseNote } = usePianoMidi();
  const { activeNotes, noteHistory } = usePianoMidiNotes();
  const { startNote, endNote } = useMemo(() => computeKeyboardRange(null), []);

  return (
    <div className="piano-studio-play">
      {/* Theory triptych is the default top pane — circle of fifths · staff · chord. */}
      <StudioTopPane align="stretch">
        <TheoryPanel activeNotes={activeNotes} layout="row" />
      </StudioTopPane>

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
