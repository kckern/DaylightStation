import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoMidi } from './PianoMidiContext.jsx';
import PianoTile from './PianoTile.jsx';
import LiveKeyboard from './LiveKeyboard.jsx';

// Order maps to the 4-column grid, row by row (top row, then bottom row):
//   Courses  Lessons  Sheet Music  Studio      ← far-left = Courses, far-right = Studio
//   Playalong  Music   Games       Producer    ← far-left = Playalong, far-right = Producer
export const PIANO_MODES = [
  { id: 'videos', label: 'Courses', blurb: 'Watch lessons & lectures', icon: 'video' },
  { id: 'lessons', label: 'Lessons', blurb: 'Technique drills', icon: 'lessons' },
  { id: 'sheetmusic', label: 'Sheet Music', blurb: 'Scores to play', icon: 'sheet-music' },
  { id: 'studio', label: 'Studio', blurb: 'Free play, record & replay', icon: 'studio' },
  { id: 'playalong', label: 'Playalong', blurb: 'Backing tracks to play over', icon: 'playalong' },
  { id: 'music', label: 'Music', blurb: 'Albums & playlists', icon: 'music' },
  { id: 'games', label: 'Games', blurb: 'Play note-driven games', icon: 'game' },
  { id: 'producer', label: 'Producer', blurb: 'Beats, loops & jam', icon: 'producer' },
];

/**
 * PianoMenu — the touch-first home screen for a piano. Tiles route to each mode.
 */
export function PianoMenu() {
  const navigate = useNavigate();
  const { pianoId, basePath, config } = usePianoKioskConfig();
  const { pressNote, releaseNote } = usePianoMidi();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const logger = useMemo(() => getLogger().child({ component: 'piano-menu' }), []);

  const open = (id) => {
    logger.info('piano.mode-enter', { mode: id, pianoId });
    navigate(`${basePath}/${id}`);
  };

  return (
    <main className="piano-home">
      <div className="piano-home__body">
        <ul className="piano-menu__tiles">
          {PIANO_MODES.map((m) => (
            <li key={m.id}>
              <PianoTile icon={m.icon} label={m.label} blurb={m.blurb} onClick={() => open(m.id)} />
            </li>
          ))}
        </ul>
      </div>
      {/* Live keyboard at the foot of the home screen: lights up to the played
          notes (and is touch-playable). No waterfall, no staff — just feedback. */}
      <div className="piano-home__keyboard">
        <LiveKeyboard
          startNote={kb.startNote}
          endNote={kb.endNote}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </div>
    </main>
  );
}

export default PianoMenu;
