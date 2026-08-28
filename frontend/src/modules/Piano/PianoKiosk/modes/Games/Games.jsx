import { useMemo, useCallback, useContext, useState, Suspense } from 'react';
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
import { readKioskDeviceId } from '../../kioskDeviceIdentity.js';
import GameGate from './GameGate.jsx';
import { gateAppliesTo, gateConfigForLearner } from './gateScope.js';
import MatchGateContext from './MatchGateContext.js';
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

  // learnerId MUST be the roster slug (pianoUser.currentUser), never
  // `currentUser` above — that local resolves to the hydrated PROFILE OBJECT
  // once the roster has loaded (`currentProfile ?? currentUser`), which the
  // games themselves want for display/props. Sending the object as a route
  // param stringifies to the literal "[object Object]", so every child on
  // the piano would meter into one shared bucket instead of their own. Gate 1
  // above (Games()) already keys off this same slug — this keeps all three
  // gates identifying the child the same way, and the gate's ladder is stored
  // per child under exactly this key.
  const learnerId = pianoUser?.currentUser ?? null;
  // Which physical kiosk this browser IS, not which app it is running. A shared
  // literal ('piano-kiosk') cannot tell a wall tablet from a dev laptop, so two
  // clients stamp the same id: every per-device log query merges them, and the
  // device-wide daily cap is one bucket that whichever kiosk is used first
  // spends for both. `readKioskDeviceId` is the SSOT for that identity (the
  // launch URL's `?device=`, persisted); a client with none stays null rather
  // than guessing.
  const deviceId = useMemo(() => readKioskDeviceId(), []);

  // Gate 2 — the playing challenge at a match boundary (D7/D11). It replaces
  // the game on the SAME route rather than sitting over it: MIDI has no focus
  // concept, so exactly one consumer of the note stream at a time.
  //
  // `gatePending` starts armed when the gate applies here, so ENTERING a game is
  // itself a match boundary (D12: nothing reaches a match without passing).
  // Config is loaded before any route renders (PianoApp returns null while the
  // roster is loading), so this initial read is never the "not yet arrived"
  // false.
  //
  // "Applies here" is per child AND per game: the household block is the
  // default, `users.{learnerId}` overrides it key-by-key, and an optional
  // `games:` allowlist narrows it to named game ids. That is what makes a
  // careful rollout possible — one child, one game, watched — instead of
  // switching a challenge on in front of all nine games and every child at
  // once. Both dimensions are absent by default, which reads as "everyone,
  // everywhere", so an unscoped block behaves exactly as it always did.
  const gateEnabled = gateAppliesTo(config.gameGate, { learnerId, gameId });
  const [gatePending, setGatePending] = useState(gateEnabled);
  // Bumped on every match boundary and used as the game's `key`, so a rematch
  // is a genuine REMOUNT — a game that kept its board across "play again"
  // would make the gate a toll on nothing.
  const [matchId, setMatchId] = useState(1);

  // Re-arm when the game itself changes under a mounted host. `:gameId` and
  // `:gameId/:subRoute` render the SAME element, so React preserves this
  // component instance across a params change and the initial `useState` read
  // above never runs again — a game→game move would walk straight into a match
  // on a gate that was passed for a different game. No in-app affordance does
  // that today; this is here so the first one that does cannot silently open a
  // hole. Adjusting state during render (rather than in an effect) so the new
  // game never mounts for a frame before the gate replaces it.
  const [gatedGameId, setGatedGameId] = useState(gameId);
  if (gatedGameId !== gameId) {
    setGatedGameId(gameId);
    setGatePending(gateEnabled);
    setMatchId((value) => value + 1);
  }

  // Gate 3 (below the school lock, gate 1, and below the match gate, gate 2):
  // meter the day's game-time budget. `active: true` only here — D13: only a
  // MOUNTED game is a match, so the picker and every other mode never open a
  // session. That is also why `gatePending` suppresses it: the gate is what you
  // pay WITH, not what you pay for, and a session opened while the child is
  // playing a scale would bill the challenge to their game time. Fail-open
  // states ('off', 'opening', 'unavailable', 'playing', 'idle-paused',
  // 'warning') all fall through to the normal game render below; only an
  // affirmative depletion answer swaps the game for a lock panel.
  const meter = useGameBudgetMeter({
    learnerId, deviceId, active: config.gameLimit?.enabled === true && !gatePending,
  });

  /**
   * A game reached a match boundary and is asking what happens there.
   *
   * Armed: the gate goes back up and the game unmounts. There is no state to
   * lose — this is only ever called where the game was about to reset itself.
   * Unarmed: bump the match id, which remounts the game. That is today's
   * restart behaviour exactly, expressed as a fresh match.
   */
  const requestRematch = useCallback(() => {
    logger.info('piano.game-rematch', { game: gameId, gated: gateEnabled });
    if (gateEnabled) { setGatePending(true); return; }
    setMatchId((value) => value + 1);
  }, [gameId, gateEnabled, logger]);

  const matchGate = useMemo(
    () => ({ armed: gateEnabled, requestRematch }),
    [gateEnabled, requestRematch],
  );

  /**
   * The gate resolved in the child's favour — a genuine pass, or an
   * infrastructure fail-open the child could do nothing about. Both open the
   * match; the gate has already logged which it was.
   */
  const openMatch = useCallback(() => {
    setGatePending(false);
    setMatchId((value) => value + 1);
  }, []);

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

  // A game id nothing answers to is not a gate at all — asking a child to play
  // a scale before telling them the game does not exist would be a toll on
  // nothing, so this is settled before either gate below.
  if (!entry?.LazyComponent) {
    return (
      <div className="piano-mode__placeholder">
        Game not found.{' '}
        <button type="button" onClick={exit}>Back</button>
      </div>
    );
  }

  // Gate 2, IN PLACE OF the game (D11) and inside the same fullscreen stage the
  // game would have had — one route, one MIDI consumer, one box. Above gate 3
  // deliberately: the challenge is what a match is bought with, so it is asked
  // before the day's balance is read.
  if (gatePending) {
    return (
      <div className="piano-game-fullscreen">
        <GameGate
          learnerId={learnerId}
          deviceId={deviceId}
          gateConfig={gateConfigForLearner(config.gameGate, learnerId)}
          // What the child calls this game, so the challenge can say what it is
          // for ("Play this to start Chess") instead of standing there unexplained.
          gameLabel={entry?.label ?? gameId}
          onPassed={openMatch}
          onLeave={exit}
        />
      </div>
    );
  }

  if (meter.state === 'depleted') return <BudgetLock kind="learner" />;
  if (meter.state === 'device-depleted') return <BudgetLock kind="device" />;

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
          watchdog then read a dead page and rebooted it. `matchId` is in the
          reset key so a fresh match also clears a caught crash — a rematch the
          child paid for must not land back on the error card. */}
      <GameBoundary
        resetKey={`${gameId}:${matchId}`}
        gameId={gameId}
        label={entry.label ?? 'This game'}
        onExit={exit}
      >
        <Suspense fallback={<SkeletonStage />}>
          {/* The game announces match boundaries through this context and the
              host decides what happens at them; `key` makes the decision real
              by remounting rather than re-rendering. Games mounted anywhere
              else (the office screen has no provider) read null and restart
              themselves exactly as they always have. */}
          <MatchGateContext.Provider value={matchGate}>
            <entry.LazyComponent
              key={matchId}
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
          </MatchGateContext.Provider>
        </Suspense>
      </GameBoundary>
    </div>
  );
}

export default Games;
