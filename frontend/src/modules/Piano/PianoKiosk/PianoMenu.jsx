import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import Icon from './icons/Icon.jsx';

export const PIANO_MODES = [
  { id: 'videos', label: 'Videos', blurb: 'Watch lessons & lectures', icon: 'video' },
  { id: 'music', label: 'Music', blurb: 'Albums & playlists', icon: 'music' },
  { id: 'sheetmusic', label: 'Sheet Music', blurb: 'Scores to play', icon: 'sheet-music' },
  { id: 'games', label: 'Games', blurb: 'Play note-driven games', icon: 'game' },
  { id: 'lessons', label: 'Lessons', blurb: 'Guided & theory lessons', icon: 'lessons' },
  { id: 'studio', label: 'Studio', blurb: 'Free play, record & replay', icon: 'studio' },
];

/**
 * PianoMenu — the touch-first home screen for a piano. Tiles route to each mode.
 */
export function PianoMenu() {
  const navigate = useNavigate();
  const { pianoId, basePath } = usePianoKioskConfig();
  const logger = useMemo(() => getLogger().child({ component: 'piano-menu' }), []);

  const open = (id) => {
    logger.info('piano.mode-enter', { mode: id, pianoId });
    navigate(`${basePath}/${id}`);
  };

  return (
    <main className="piano-menu">
      <ul className="piano-menu__tiles">
        {PIANO_MODES.map((m) => (
          <li key={m.id}>
            <button type="button" className="piano-menu__tile" onClick={() => open(m.id)}>
              <Icon name={m.icon} className="piano-menu__tile-icon" />
              <span className="piano-menu__tile-label">{m.label}</span>
              <span className="piano-menu__tile-blurb">{m.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default PianoMenu;
