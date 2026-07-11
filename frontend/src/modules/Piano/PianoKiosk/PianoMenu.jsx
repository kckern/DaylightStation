import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoMidi } from './PianoMidiContext.jsx';
import PianoTile from './PianoTile.jsx';
import LiveKeyboard from './LiveKeyboard.jsx';
import { balancedColumns } from './tileGridLayout.js';

// Order maps to the 4-column grid, row by row (top row → bottom row):
//   Courses    Music      Sheet Music  Studio
//   Composer   Playalong  Singalong    Karaoke
//   Training   Games      Producer
// Training sits directly under Playalong; Music follows Courses; Composer
// follows Studio. Karaoke sits next to Singalong (same mic icon, both are
// karaoke-chrome playback — Karaoke is the searchable song browser, Singalong
// the poster-grid collection). Producer is present but `disabled` (greyed,
// non-clickable) — it stays reachable only via the `producer/*` route (see
// PianoApp.jsx), not the touch UI, until it ships. Composer is a placeholder
// shell for a future tool.
export const PIANO_MODES = [
  { id: 'videos', label: 'Courses', blurb: 'Watch lessons & lectures', icon: 'video' },
  { id: 'music', label: 'Music', blurb: 'Albums & playlists', icon: 'music' },
  { id: 'sheetmusic', label: 'Sheet Music', blurb: 'Scores to play', icon: 'sheet-music' },
  { id: 'studio', label: 'Studio', blurb: 'Free play, record & replay', icon: 'studio' },
  { id: 'composer', label: 'Composer', blurb: 'Write & arrange music', icon: 'quill' },
  { id: 'playalong', label: 'Playalong', blurb: 'Backing tracks to play over', icon: 'playalong' },
  { id: 'singalong', label: 'Karaoke', blurb: 'Grab the mic — sing along', icon: 'singalong' },
  { id: 'lessons', label: 'Training', blurb: 'Technique drills', icon: 'metronome' },
  { id: 'games', label: 'Games', blurb: 'Play note-driven games', icon: 'game' },
  { id: 'producer', label: 'Producer', blurb: 'Coming soon', icon: 'producer', disabled: true },
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
  const cols = balancedColumns(PIANO_MODES.length); // 11 → 4

  const open = (id) => {
    logger.info('piano.mode-enter', { mode: id, pianoId });
    navigate(`${basePath}/${id}`);
  };

  return (
    <main className="piano-home">
      <div className="piano-home__body">
        <ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
          {PIANO_MODES.map((m) => (
            <li key={m.id}>
              <PianoTile
                icon={m.icon}
                label={m.label}
                blurb={m.blurb}
                disabled={m.disabled}
                onClick={m.disabled ? undefined : () => open(m.id)}
              />
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
