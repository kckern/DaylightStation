import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoUser } from './PianoUserContext.jsx';
import PianoTile from './PianoTile.jsx';
import PianoMenuActivity from './PianoMenuActivity.jsx';
import LiveKeyboard from './LiveKeyboard.jsx';
import { balancedColumns } from './tileGridLayout.js';
import usePianoCurfew from './usePianoCurfew.js';

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
//
// Games is `disabled` for the same greyed/non-clickable treatment, but for a
// household reason rather than an unshipped one: it is turned off at the tile
// while it is a source of contention over the tablet. Note that this closes the
// touch-UI door only — the note launcher (game-platform/launcher/) still opens
// games from PianoVisualizer, so re-enabling here is the whole revert.
export const PIANO_MODES = [
  { id: 'videos', label: 'Courses', blurb: 'Watch lessons & lectures', icon: 'video' },
  { id: 'music', label: 'Music', blurb: 'Albums & playlists', icon: 'music' },
  { id: 'sheetmusic', label: 'Sheet Music', blurb: 'Scores to play', icon: 'sheet-music' },
  { id: 'studio', label: 'Studio', blurb: 'Free play, record & replay', icon: 'studio' },
  { id: 'composer', label: 'Composer', blurb: 'Write & arrange music', icon: 'quill' },
  { id: 'playalong', label: 'Playalong', blurb: 'Backing tracks to play over', icon: 'playalong' },
  { id: 'singalong', label: 'Karaoke', blurb: 'Grab the mic — sing along', icon: 'singalong' },
  { id: 'exercises', label: 'Exercises', blurb: 'Drills, scales & chords', icon: 'metronome' },
  { id: 'games', label: 'Games', blurb: 'Play note-driven games', icon: 'game', disabled: true },
  { id: 'producer', label: 'Producer', blurb: 'Coming soon', icon: 'producer', disabled: true },
];

/**
 * PianoMenu — the touch-first home screen for a piano. Tiles route to each mode.
 *
 * Under curfew (config.curfew, default 19:00–06:00) the whole menu goes dark:
 * every tile and every activity-strip card greys out and stops responding. The
 * one thing still working is the piano — sitting down and playing auto-enters
 * Studio (useAutoStudioEntry in PianoApp), which is deliberately independent of
 * this menu, so evening free play is unaffected.
 */
export function PianoMenu() {
  const navigate = useNavigate();
  const { pianoId, basePath, config } = usePianoKioskConfig();
  const { pressNote, releaseNote } = usePianoMidi();
  const { setCurrentUser } = usePianoUser();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const logger = useMemo(() => getLogger().child({ component: 'piano-menu' }), []);
  const cols = balancedColumns(PIANO_MODES.length); // 11 → 4
  const curfew = usePianoCurfew(config?.curfew);

  const open = (id) => {
    if (curfew) return; // belt-and-braces: the tiles are already disabled
    logger.info('piano.mode-enter', { mode: id, pianoId });
    navigate(`${basePath}/${id}`);
  };

  return (
    <main className={`piano-home${curfew ? ' is-curfew' : ''}`}>
      <div className="piano-home__body">
        <PianoMenuActivity
          disabled={curfew}
          onOpenCourse={(courseId, userId) => {
            logger.info('piano.menu-activity.open-course', { courseId, userId });
            // Tapping a player's card IS picking that player: their progress,
            // their credit (owner-requested 2026-07-28 — supersedes the
            // original no-switch design).
            if (userId) setCurrentUser(userId);
            navigate(`${basePath}/videos/${String(courseId).replace(/^plex:/, '')}`);
          }}
        />
        <ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
          {PIANO_MODES.map((m) => (
            <li key={m.id}>
              <PianoTile
                icon={m.icon}
                label={m.label}
                blurb={m.blurb}
                disabled={m.disabled || curfew}
                onClick={m.disabled || curfew ? undefined : () => open(m.id)}
              />
            </li>
          ))}
        </ul>
        {curfew && (
          <p className="piano-home__curfew" role="status">
            Screen time is over for tonight — but the piano is still on. Just play.
          </p>
        )}
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
