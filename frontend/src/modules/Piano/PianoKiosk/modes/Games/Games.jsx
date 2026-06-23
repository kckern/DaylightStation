import { useMemo, useState, Suspense } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { getGameIds, getGameEntry } from '../../../gameRegistry.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';

// Friendly labels for the registry ids.
const GAME_LABELS = {
  'space-invaders': 'Space Invaders',
  tetris: 'Tetris',
  flashcards: 'Flashcards',
  hero: 'Note Hero',
  'side-scroller': 'Side Scroller',
};

/**
 * Games mode — picks a registered piano game and mounts it fullscreen, fed by the
 * shared Web-MIDI (BLE) stream from usePianoMidi(). Games receive the same
 * contract as the wall-display visualizer: activeNotes, noteHistory, gameConfig,
 * onDeactivate.
 */
export function Games() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-games' }), []);
  const { activeNotes, noteHistory } = usePianoMidi();
  const { config } = usePianoKioskConfig();
  const [selected, setSelected] = useState(null);
  const ids = getGameIds();
  const gamesConfig = config.games; // from PianoConfig context — no office-tv HA coupling

  const pick = (id) => {
    setSelected(id);
    logger.info('piano.game-enter', { game: id });
  };

  const exit = () => {
    logger.info('piano.game-exit', { game: selected });
    setSelected(null);
  };

  const entry = selected ? getGameEntry(selected) : null;

  if (entry?.LazyComponent) {
    return (
      <div className="piano-game-fullscreen">
        <button type="button" className="piano-game-fullscreen__back" onClick={exit}>
          ‹ Games
        </button>
        <Suspense fallback={<div className="piano-mode__placeholder">Loading…</div>}>
          <entry.LazyComponent
            activeNotes={activeNotes}
            noteHistory={noteHistory}
            gameConfig={gamesConfig?.[selected]}
            onDeactivate={exit}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <section className="piano-mode piano-mode--games">
      <h2>Games</h2>
      <ul className="piano-mode__grid">
        {ids.map((id) => (
          <li key={id}>
            <button type="button" className="piano-mode__tile" onClick={() => pick(id)}>
              {GAME_LABELS[id] ?? id}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default Games;
