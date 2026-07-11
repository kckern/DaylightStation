import { useMemo, Suspense } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { getGameIds, getGameEntry } from '../../../gameRegistry.js';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import PianoTile from '../../PianoTile.jsx';
import { balancedColumns } from '../../tileGridLayout.js';

// Friendly labels for the registry ids.
const GAME_LABELS = {
  'space-invaders': 'Space Invaders',
  tetris: 'Tetris',
  flashcards: 'Flashcards',
  hero: 'Note Hero',
  'side-scroller': 'Side Scroller',
};

// Per-game tile icons (currentColor SVGs in ../../icons/svg).
const GAME_ICONS = {
  'space-invaders': 'game-space-invaders',
  tetris: 'game-tetris',
  flashcards: 'game-flashcards',
  hero: 'game-hero',
  'side-scroller': 'game-side-scroller',
};

/**
 * Games mode — picks a registered piano game and mounts it fullscreen, fed by the
 * shared Web-MIDI (BLE) stream from usePianoMidi().
 *
 * Routed so the game id lives in the URL (deep-linkable, survives reload,
 * physical/browser Back becomes an "up" gesture):
 *   index    → game picker grid
 *   :gameId  → fullscreen game host
 *
 * All navigation is RELATIVE (navigate('subpath') / navigate('..')) so the mode
 * works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 */
export function Games() {
  return (
    <Routes>
      <Route index element={<GamePicker />} />
      <Route path=":gameId" element={<GameHost />} />
    </Routes>
  );
}

/** Game picker — grid of registered game tiles; tap to enter a game (relative nav). */
function GamePicker() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-games' }), []);
  const navigate = useNavigate();
  // Note Hero now lives under Lessons (it's a timing/learning game), so it is
  // excluded from the arcade Games picker.
  const ids = getGameIds().filter((id) => id !== 'hero');
  const cols = balancedColumns(ids.length); // 4 → 4, centered, no empty column

  return (
    <section className="piano-menu piano-mode--games">
      <ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
        {ids.map((id) => (
          <li key={id}>
            <PianoTile
              icon={GAME_ICONS[id] || 'game'}
              label={GAME_LABELS[id] ?? id}
              onClick={() => {
                logger.info('piano.game-enter', { game: id });
                navigate(id);
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Game host — resolves the game entry from the URL param, wires MIDI, and
 * renders the game fullscreen. Back navigates up (relative).
 */
function GameHost() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-games' }), []);
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { pressNote, releaseNote } = usePianoMidi();
  const { activeNotes, noteHistory } = usePianoMidiNotes();
  const { config } = usePianoKioskConfig();
  const entry = getGameEntry(gameId);

  // Current location in the header breadcrumb (Games › this game). The breadcrumb
  // replaces the old in-canvas back pill — tap the "Games" crumb to exit.
  usePianoBreadcrumb(useMemo(() => [{ label: GAME_LABELS[gameId] ?? gameId }], [gameId]));

  const exit = () => {
    logger.info('piano.game-exit', { game: gameId });
    navigate('..', { relative: 'path' });
  };

  if (!entry?.LazyComponent) {
    return (
      <div className="piano-mode__placeholder">
        Game not found.{' '}
        <button type="button" onClick={exit}>Back</button>
      </div>
    );
  }

  return (
    <div className="piano-game-fullscreen">
      <Suspense fallback={<div className="piano-mode__placeholder">Loading…</div>}>
        <entry.LazyComponent
          activeNotes={activeNotes}
          noteHistory={noteHistory}
          gameConfig={config.games?.[gameId]}
          onDeactivate={exit}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </Suspense>
    </div>
  );
}

export default Games;
