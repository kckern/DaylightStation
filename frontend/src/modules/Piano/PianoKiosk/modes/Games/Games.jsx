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
import GameBoundary from '../../../game-platform/host/GameBoundary.jsx';
import { resolvePianoPlayerName } from '../../../game-platform/identity/playerName.js';
import useSchoolGameAccess from '../../useSchoolGameAccess.js';
import { gameSubRouteTarget } from './gameSubRoute.js';

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
  const pianoUser = useContext(PianoUserContext);
  const gameAccess = useSchoolGameAccess(pianoUser?.currentUser ?? null);

  if (!gameAccess.unlocked) {
    const message = gameAccess.status === 'error'
      ? 'School status is unavailable. Games stay locked until it can be checked.'
      : gameAccess.state === 'indeterminate'
        ? 'School could not determine today’s plan. Ask a grown-up for help.'
        : gameAccess.status === 'locked'
          ? 'Choose your own profile, then finish today’s schoolwork to unlock Games.'
      : gameAccess.status === 'loading'
        ? 'Checking today’s schoolwork…'
        : 'Finish today’s schoolwork to unlock Games.';
    return (
      <section className="piano-mode__placeholder piano-games__school-lock" role="status">
        <h2>Games are locked</h2>
        <p>{message}</p>
      </section>
    );
  }

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
        {ids.map((id) => {
          const entry = getGameEntry(id);
          return (
            <li key={id}>
              <PianoTile
                icon={entry?.icon || 'game'}
                label={entry?.label ?? id}
                blurb={entry?.status === 'preview' ? 'Preview' : null}
                disabled={entry?.status !== 'released'}
                onClick={() => {
                  logger.info('piano.game-enter', { game: id });
                  navigate(id);
                }}
              />
            </li>
          );
        })}
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
  const playerName = resolvePianoPlayerName(currentUser);
  const entry = getGameEntry(gameId);

  // Current location in the header breadcrumb (Games › this game). The breadcrumb
  // replaces the old in-canvas back pill — tap the "Games" crumb to exit.
  usePianoBreadcrumb(useMemo(() => [{ label: entry?.label ?? gameId }], [entry?.label, gameId]));

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
      {/* A game that throws costs the player that game — not the kiosk. Without
          this, any throw blanked the whole screen, and the tablet's render
          watchdog then read a dead page and rebooted it. */}
      <GameBoundary resetKey={gameId} label={entry.label ?? 'This game'} onExit={exit}>
        <Suspense fallback={<SkeletonStage />}>
          <entry.LazyComponent
            activeNotes={activeNotes}
            noteHistory={noteHistory}
            gameConfig={config.games?.[gameId]}
            subRoute={subRoute ?? null}
            onSubRoute={goSubRoute}
            currentUser={currentUser}
            playerName={playerName}
            onDeactivate={exit}
            onNoteOn={pressNote}
            onNoteOff={releaseNote}
          />
        </Suspense>
      </GameBoundary>
    </div>
  );
}

export default Games;
