import { useMemo } from 'react';
import { NoteWaterfall } from '../../../components/NoteWaterfall.jsx';
import { StudioTopPane } from '../../../components/StudioTopPane.jsx';
import { StudioTriptych } from '../../../components/StudioTriptych.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { computeKeyboardRange } from '../../../noteUtils.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoPreferences } from '../../usePianoPreferences.js';
import Icon from '../../icons/Icon.jsx';

/** ms → M:SS for the recording read-out. */
function mmss(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Studio play view — the freeform instrument. Three stacked panes that all read
 * from the live MIDI surface: the current-chord staff on top, the falling-notes
 * waterfall filling the middle, and a touch-playable keyboard pinned at the foot.
 * A single Record button floats over the staff: tap to start (it shows a count-up
 * timer and blinks red while capturing), tap again to stop — the take auto-saves
 * and shows up under the Recordings tab. All review/curation lives there.
 */
export default function StudioPlay({ recording, elapsedMs, onRecordToggle }) {
  const { activeNotes, noteHistory, pressNote, releaseNote } = usePianoMidi();
  const { startNote, endNote } = useMemo(() => computeKeyboardRange(null), []);

  // Top-pane layout preference. Precedence: saved user pref → piano.yml
  // (studio.topPaneLayout household default) → hardcoded 'staff'. Default stays
  // staff-only; the theory triptych is strictly opt-in.
  const { config } = usePianoKioskConfig();
  const configDefault = config?.studio?.topPaneLayout || 'staff';
  const { getPref, setPref, loaded } = usePianoPreferences();
  const layout = loaded ? getPref('topPaneLayout', configDefault) : configDefault;
  const isTriptych = layout === 'triptych';
  const toggleLayout = () => setPref('topPaneLayout', isTriptych ? 'staff' : 'triptych');

  return (
    <div className="piano-studio-play">
      <button
        type="button"
        className="piano-studio-play__layout-toggle"
        onClick={toggleLayout}
        aria-pressed={isTriptych}
        aria-label={isTriptych ? 'Show staff only' : 'Show theory triptych'}
        title={isTriptych ? 'Staff only' : 'Theory triptych'}
      >
        {isTriptych ? 'Staff' : 'Theory'}
      </button>

      <button
        type="button"
        className={`piano-studio-play__record${recording ? ' is-recording' : ''}`}
        onClick={onRecordToggle}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        aria-pressed={recording}
      >
        <span className="piano-studio-play__record-dot" />
        <span className="piano-studio-play__record-label">
          {recording ? mmss(elapsedMs) : 'Record'}
        </span>
        {recording && <Icon name="stop" />}
      </button>

      {isTriptych ? (
        <StudioTopPane align="stretch">
          <StudioTriptych activeNotes={activeNotes} />
        </StudioTopPane>
      ) : (
        <StudioTopPane activeNotes={activeNotes} />
      )}

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
