import { useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { getGameEntry } from '../../../gameRegistry.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';

/**
 * Lessons mode — hosts Note Hero (the timing game) fullscreen, fed by the shared
 * Web-MIDI (BLE) stream. Note Hero moved here from Games as the first guided
 * lesson; it reads better as "learn to play in time" than as an arcade game.
 * Back (breadcrumb / browser Back) navigates up to the menu.
 */
export function Lessons() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-lessons' }), []);
  const navigate = useNavigate();
  const { activeNotes, noteHistory, pressNote, releaseNote } = usePianoMidi();
  const { config } = usePianoKioskConfig();
  const entry = getGameEntry('hero');

  usePianoBreadcrumb(useMemo(() => [{ label: 'Note Hero' }], []));

  const exit = () => {
    logger.info('piano.lessons-exit', {});
    navigate('..', { relative: 'path' });
  };

  if (!entry?.LazyComponent) {
    return (
      <div className="piano-mode__placeholder">
        Note Hero isn’t available right now. <button type="button" onClick={exit}>Back</button>
      </div>
    );
  }

  return (
    <div className="piano-game-fullscreen">
      <Suspense fallback={<div className="piano-mode__placeholder">Loading…</div>}>
        <entry.LazyComponent
          activeNotes={activeNotes}
          noteHistory={noteHistory}
          gameConfig={config.games?.hero}
          onDeactivate={exit}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </Suspense>
    </div>
  );
}

export default Lessons;
