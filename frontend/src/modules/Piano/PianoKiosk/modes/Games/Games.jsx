import { useMemo, useContext, Suspense } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { getGameIds, getGameEntry } from '../../../gameRegistry.js';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import PianoUserContext from '../../PianoUserContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import PianoTile from '../../PianoTile.jsx';
import { balancedColumns } from '../../tileGridLayout.js';
import { SkeletonStage } from '../../Skeleton.jsx';

// Friendly labels for the registry ids. 'card-game' keeps its registry id but
// every player-facing surface calls it Battle Stadium; the campaign rewrite of
// this registry landed in parallel with the earlier rename and reverted the
// label by accident — restored (and renamed per 2026-08-11) at the origin merge.
const GAME_LABELS = {
  'card-game': 'Battle Stadium',
  'space-invaders': 'Space Invaders',
  tetris: 'Tetris',
  flashcards: 'Flashcards',
  hero: 'Piano Hero',
  'side-scroller': 'Side Scroller',
  chess: 'Piano Chess',
};

// Per-game tile icons (currentColor SVGs in ../../icons/svg).
const GAME_ICONS = {
  'card-game': 'game-battle-stadium',
  'space-invaders': 'game-space-invaders',
  tetris: 'game-tetris',
  flashcards: 'game-flashcards',
  hero: 'game-hero',
  'side-scroller': 'game-side-scroller',
  chess: 'game-chess',
};

/**
 * Relative destination for a game-owned URL segment.
 *
 * From /games/hero, append the first segment directly. Once a segment already
 * exists, replace that leaf with a sibling. Re-appending the game id from the
 * latter state produces /hero/hero/:segment.
 */
export function gameSubRouteTarget(currentSubRoute, next) {
  if (!next) return currentSubRoute ? '..' : '.';
  return currentSubRoute ? `../${next}` : next;
}

/**
 * Games mode — picks a registered piano game and mounts it fullscreen, fed by the
 * shared Web-MIDI (BLE) stream from usePianoMidi().
 *
 * Routed so the game id lives in the URL (deep-linkable, survives reload,
 * physical/browser Back becomes an "up" gesture):
 *   index             → game picker grid
 *   :gameId           → fullscreen game host
 *   :gameId/:subRoute → the same host, with one more segment the GAME gives
 *                       meaning to (Piano Hero uses it for the collection tab,
 *                       so /piano/games/hero/video-games opens on that tab).
 *                       Games owns the routing; the game owns what it means.
 *
 * All navigation is RELATIVE (navigate('subpath') / navigate('..')) so the mode
 * works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 */
export function Games() {
  return (
    <Routes>
      <Route index element={<GamePicker />} />
      <Route path=":gameId" element={<GameHost />} />
      <Route path=":gameId/:subRoute" element={<GameHost />} />
    </Routes>
  );
}

/** Game picker — grid of registered game tiles; tap to enter a game (relative nav). */
function GamePicker() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-games' }), []);
  const navigate = useNavigate();
  const ids = getGameIds();
  const cols = balancedColumns(ids.length);

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
  const { gameId, subRoute } = useParams();
  const navigate = useNavigate();
  const { pressNote, releaseNote } = usePianoMidi();
  const { activeNotes, noteHistory } = usePianoMidiNotes();
  const { config } = usePianoKioskConfig();
  // Optional like PianoUserChip — games fall back to no user (default levels)
  // when mounted outside the kiosk's PianoUserProvider.
  const pianoUser = useContext(PianoUserContext);
  const currentUser = pianoUser?.currentProfile ?? pianoUser?.currentUser ?? null;
  const entry = getGameEntry(gameId);

  // Current location in the header breadcrumb (Games › this game). The breadcrumb
  // replaces the old in-canvas back pill — tap the "Games" crumb to exit.
  usePianoBreadcrumb(useMemo(() => [{ label: GAME_LABELS[gameId] ?? gameId }], [gameId]));

  const exit = () => {
    logger.info('piano.game-exit', { game: gameId });
    navigate(subRoute ? '../..' : '..', { relative: 'path' });
  };

  // A game asking to change its own sub-route REPLACES rather than pushes: Back
  // should leave the game, not walk back through every tab you looked at.
  const goSubRoute = (next) => {
    navigate(gameSubRouteTarget(subRoute, next), { relative: 'path', replace: true });
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
      <Suspense fallback={<SkeletonStage />}>
        <entry.LazyComponent
          activeNotes={activeNotes}
          noteHistory={noteHistory}
          gameConfig={config.games?.[gameId]}
          subRoute={subRoute ?? null}
          onSubRoute={goSubRoute}
          currentUser={currentUser}
          onDeactivate={exit}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </Suspense>
    </div>
  );
}

export default Games;
