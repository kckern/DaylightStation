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
import useGameBudgetMeter from '../../useGameBudgetMeter.js';

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
 * Budget-gate lock panel (gate 3) — shown in place of the game once the day's
 * piano game-time budget is spent. Two distinct copies: a learner's own
 * allowance runs out on their schedule, a shared device allowance runs out on
 * everyone's. Styled like the school lock above it (`piano-mode__placeholder`)
 * so a depleted-budget refusal reads as the same family of "not right now",
 * not a different app.
 */
const BUDGET_LOCK_COPY = {
  learner: {
    heading: 'Games are done for today',
    body: 'You’ve used your piano game time for today. It comes back tomorrow.',
  },
  device: {
    heading: 'The piano’s games are done for today',
    body: 'This piano has reached its shared game time for the day.',
  },
};

function BudgetLock({ kind }) {
  const { heading, body } = BUDGET_LOCK_COPY[kind];
  return (
    <section className="piano-mode__placeholder piano-games__budget-lock" role="status">
      <h2>{heading}</h2>
      <p>{body}</p>
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

  // Gate 3 (below the school lock, gate 1): meter the day's game-time budget.
  // `active: true` only here — D13: only a MOUNTED game is a match, so the
  // picker and every other mode never open a session. Fail-open states
  // ('off', 'opening', 'unavailable', 'playing', 'idle-paused', 'warning')
  // all fall through to the normal game render below; only an affirmative
  // depletion answer swaps the game for a lock panel.
  //
  // learnerId MUST be the roster slug (pianoUser.currentUser), never
  // `currentUser` above — that local resolves to the hydrated PROFILE OBJECT
  // once the roster has loaded (`currentProfile ?? currentUser`), which the
  // games themselves want for display/props. Sending the object as a route
  // param stringifies to the literal "[object Object]", so every child on
  // the piano would meter into one shared bucket instead of their own. Gate 1
  // above (Games()) already keys off this same slug — this keeps both gates
  // identifying the child the same way.
  const learnerId = pianoUser?.currentUser ?? null;
  const meter = useGameBudgetMeter({
    learnerId, deviceId: 'piano-kiosk', active: config.gameLimit?.enabled === true,
  });

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

  if (meter.state === 'depleted') return <BudgetLock kind="learner" />;
  if (meter.state === 'device-depleted') return <BudgetLock kind="device" />;

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
      {/* Non-blocking: the child keeps playing while low on time. Sits above
          the game but never intercepts input — a countdown, not a wall. */}
      {meter.warn && (
        <div className="piano-games__budget-warning" role="status">
          {Math.ceil(meter.secondsLeft / 60)} min of game time left
        </div>
      )}
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
