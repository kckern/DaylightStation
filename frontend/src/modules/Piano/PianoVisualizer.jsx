import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { configure as configureLogger, getLogger } from '../../lib/logging/Logger.js';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { TheoryPanel } from './components/TheoryPanel';
import { useMidiSubscription } from './useMidiSubscription';
import { resolveBoardRange } from './noteUtils.js';
import './PianoVisualizer.scss';
import { getGameEntry, getGameIds } from './gameRegistry.js';
import { buildLauncherSlots } from './game-platform/launcher/launcherNotes.js';
import { useNoteLauncher } from './game-platform/launcher/useNoteLauncher.js';
import { comboNotesForKeyboard } from './game-platform/launcher/comboForKeyboard.js';
import { useNotesHeldAtMount } from './game-platform/input/heldAtMount.js';
import { useLauncherUser } from './game-platform/launcher/useLauncherUser.js';
import PlayerConfirm from './game-platform/launcher/PlayerConfirm.jsx';
import { bindNoteSlots, useNoteSelection, SELECTION_NOTES } from './game-platform/input/useNoteSelection.js';
import NoteLauncher from './game-platform/launcher/NoteLauncher.jsx';
import HoldRing from './game-platform/launcher/HoldRing.jsx';
import GameBoundary from './game-platform/host/GameBoundary.jsx';
import OfficeGameChrome from './game-platform/chrome/OfficeGameChrome.jsx';
import { usePianoConfig } from './usePianoConfig.js';
import { useInactivityTimer } from './useInactivityTimer.js';
import { useSessionTracking } from './useSessionTracking.js';
import { useSpamDetection } from './useSpamDetection.js';
import { useScreenOverlay } from '../../screen-framework/overlays/ScreenOverlayProvider.jsx';
import useSchoolGameAccess from './PianoKiosk/useSchoolGameAccess.js';

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Renders the running game with the launcher's own selection key masked out.
 *
 * Lives inside the keyed GameBoundary so it remounts per launch, which is what
 * lets `useNotesHeldAtMount` re-capture: the key that picked the game is still
 * down at that instant, and without this the game read it as the player's first
 * input — opening Connect Four dropped a disc in the selecting key's column.
 */
function MountedGame({ Component, activeNotes, ...rest }) {
  const live = useNotesHeldAtMount(activeNotes);
  return <Component activeNotes={live} {...rest} />;
}

export function PianoVisualizer({ onClose, onSessionEnd, initialGame = null }) {
  const { activeNotes, sustainPedal, sessionInfo, noteHistory, subscribe } = useMidiSubscription();
  const { spamState, warningVisible, blackoutRemaining, spamEventCount } = useSpamDetection(activeNotes, noteHistory);
  const { gamesConfig, deviceConfig, appConfig } = usePianoConfig();

  // Launcher slots come from the REGISTRY, not the games config: config only
  // ever listed the five games that had activation combos, which is why chess,
  // connect-four and checkers were unreachable here. They take no config —
  // chess defaults gameConfig to null, the other two never read it.
  //
  // Memoized because the slot array is an effect dependency inside the hook:
  // rebuilt inline it would be a new identity on every render, re-running the
  // selection effect at MIDI rates.
  const { slots, dropped } = useMemo(
    () => buildLauncherSlots(getGameIds().map((id) => ({ id, ...getGameEntry(id) }))),
    []
  );

  // "Hold the lowest and highest key" only works if we know which notes those
  // are on THIS board. The office keyboard is a 76-key (E1..G7); the hardcoded
  // 88-key pair it used to assume does not physically exist there, so the combo
  // could never be played. Derived from the configured range, memoized because
  // the hook takes it as an effect dependency.
  const launcherOptions = useMemo(
    () => ({ comboNotes: comboNotesForKeyboard(deviceConfig?.keyboard) }),
    [deviceConfig?.keyboard],
  );

  // Who is playing. The kiosk knows from its roster context; this screen has to
  // be told, so it remembers the last answer and the top key changes it.
  const { users, currentUser, pickerOpen, openPicker, pickUser } = useLauncherUser();
  const schoolGameAccess = useSchoolGameAccess(currentUser ?? null);

  // The roster, laid out as the same row of keys the games use. It was a
  // tap-only modal — dark-on-dark and unselectable on a screen with no touch,
  // which is the one screen it exists for.
  const userSlots = useMemo(
    () => bindNoteSlots(users, SELECTION_NOTES).slots.map((slot) => ({
      ...slot,
      userId: slot.item.id,
      label: slot.item.group_label || slot.item.name,
      note: slot.note,
      noteName: slot.noteName,
      sharpAfter: false,
    })),
    [users],
  );


  // Who, THEN what. Opening the roster with the top key is the deliberate
  // route; this is the first-run one. Chess files a record per player, so
  // launching with nobody selected quietly files the game under a guest — which
  // is exactly what happened: a game was picked and the roster never appeared.
  //
  // Deliberately NOT derived from `launcherOpen`: that comes back from the hook
  // this value is passed into, and the cycle would not resolve. "Does the roster
  // still owe an answer" is true or false on its own terms; whether it is on
  // screen is a rendering question, below.
  const rosterNeeded = pickerOpen || (!currentUser && users.length > 0);

  // Picking is one key press against a row of six faces, and the row vanishes
  // the instant it lands — so nothing said WHO had been chosen. On a shared
  // instrument, where that answer decides whose record a game is filed under,
  // "did that pick me or my brother" should not be a question the player holds.
  const [confirming, setConfirming] = useState(null);
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(null), 1600);
    return () => clearTimeout(t);
  }, [confirming]);

  const currentUserName = useMemo(() => {
    const u = users.find((x) => x.id === currentUser);
    return u ? (u.group_label || u.name) : null;
  }, [users, currentUser]);

  const { isOpen: launcherOpen, activeGameId, isHolding, dismiss, exitGame, timeoutMs, launchNonce } =
    useNoteLauncher({
      activeNotes, slots, initialGame, onRequestUser: openPicker,
      selectionPaused: rosterNeeded || !schoolGameAccess.unlocked,
      options: launcherOptions,
    });




  // Gated on the row being ON SCREEN, not merely on a player being needed.
  // Enabled by `rosterNeeded` alone, this listened whenever nobody was selected
  // — so any white key between C4 and G5 silently picked a user with no roster
  // visible and nothing to say it had happened. Verified live: a note chose
  // "Felix" while the launcher was closed.
  const rosterVisible = launcherOpen && rosterNeeded;
  useNoteSelection({
    activeNotes, slots: userSlots, enabled: rosterVisible,
    onSelect: (item, slot) => {
      const id = slot.userId ?? item.id;
      pickUser(id);
      setConfirming({ id, name: item.group_label || item.name });
    },
  });

  const activeGameEntry = activeGameId ? getGameEntry(activeGameId) : null;
  const isFullscreenGame = schoolGameAccess.unlocked && activeGameEntry?.layout === 'replace';

  // A deep link, a note struck just before a status refresh, or a player
  // switch must not leave a game alive behind the lock. Rendering is gated in
  // the same commit; this effect also clears the launcher's internal game id.
  useEffect(() => {
    if (activeGameId && !schoolGameAccess.unlocked) exitGame('school-locked');
  }, [activeGameId, schoolGameAccess.unlocked, exitGame]);

  // More released games than launcher keys: the extras are silently unreachable,
  // so say so rather than letting the row read as "everything is here".
  useEffect(() => {
    if (dropped.length === 0) return;
    getLogger().child({ component: 'piano-launcher' }).warn('launcher.slots-overflow', { dropped });
  }, [dropped]);

  const quitGame = useCallback(() => exitGame('game-exit'), [exitGame]);
  const quitCrashedGame = useCallback(() => exitGame('crash'), [exitGame]);

  // An open launcher counts as activity: the player is mid-decision, not idle.
  const { inactivityState, countdownProgress } =
    useInactivityTimer(activeNotes, noteHistory, isFullscreenGame || launcherOpen, onClose);
  const { sessionDuration } = useSessionTracking(noteHistory);

  // Escape closes the launcher; a running game swallows it outright.
  const { registerEscapeInterceptor, unregisterEscapeInterceptor } = useScreenOverlay();
  useEffect(() => {
    if (!isFullscreenGame && !launcherOpen) return undefined;
    registerEscapeInterceptor(() => {
      // Dismiss only — escape is "never mind", so it must not cost the player
      // the game that was running underneath the launcher.
      if (launcherOpen) dismiss('escape');
      return true;
    });
    return () => unregisterEscapeInterceptor();
  }, [isFullscreenGame, launcherOpen, dismiss, registerEscapeInterceptor, unregisterEscapeInterceptor]);

  // Configure root logger so child components using getLogger() directly
  // also get sessionLog: true (routes their events to the JSONL session file)
  useEffect(() => {
    configureLogger({ context: { app: 'piano', sessionLog: true } });
    return () => {
      configureLogger({ context: { sessionLog: false } });
    };
  }, []);

  // Draw the keys this board actually has. It used to call
  // computeKeyboardRange(null), which returns a hardcoded 88 — so the office
  // 76-key (E1..G7) rendered fifteen keys nobody can press, and a note at either
  // end landed in the wrong place on screen.
  const { startNote, endNote } = useMemo(
    () => resolveBoardRange(deviceConfig?.keyboard),
    [deviceConfig?.keyboard],
  );

  useEffect(() => {
    // A MIDI practice session and a board-game session have different
    // lifetimes. The screen framework maps this callback to overlay dismissal;
    // firing it while a replace-game is mounted used to erase a live position
    // simply because the ambient MIDI timer expired underneath it.
    if (sessionInfo?.event === 'session_end' && onSessionEnd && !isFullscreenGame) {
      const timer = setTimeout(() => { onSessionEnd(sessionInfo); }, 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [sessionInfo, onSessionEnd, isFullscreenGame]);

  if (spamState === 'blackout') {
    const mins = Math.floor(blackoutRemaining / 60000);
    const secs = Math.floor((blackoutRemaining % 60000) / 1000);
    return (
      <div className="piano-visualizer">
        <div className="spam-blackout-overlay">
          <div className="blackout-content">
            <h1>Piano Locked</h1>
            <p className="blackout-timer">{mins}:{String(secs).padStart(2, '0')}</p>
            <p className="blackout-message">Please be gentle with the piano.</p>
          </div>
        </div>
      </div>
    );
  }

  // No fullscreen-game modifier class on the root: a `tetris-mode` class used to
  // be added here and nothing in any stylesheet ever selected it, so it read like
  // the mechanism that hid the ambient view while doing nothing at all. What a
  // replace game hides is decided in the JSX below.
  return (
    <div className="piano-visualizer">
      {warningVisible && (
        <div className="spam-warning-overlay">
          <div className="warning-content">
            <h2>Easy on the keys!</h2>
            <p>Warning {spamEventCount} of 3</p>
          </div>
        </div>
      )}
      <div className="piano-header">
        <div className="header-left">
          <div className="session-timer">
            <span className="timer-value">{formatDuration(sessionDuration)}</span>
            <span className="note-count">{noteHistory.length} notes</span>
          </div>
          {sustainPedal && <span className="pedal-indicator">Sustain</span>}
          {inactivityState === 'countdown' && (
            <div className="inactivity-timer">
              <div className="timer-bar" style={{ width: `${countdownProgress}%` }} />
            </div>
          )}
        </div>
        {/* Dropped for a fullscreen game, like the waterfall and keyboard
            below. It used to stay mounted, so the staff / circle of fifths /
            chord name kept drawing under the game and showed through wherever
            the game left a pixel untouched — `.tetris-fullscreen` had no
            background of its own until this was fixed. It also re-renders at
            MIDI rates, which is pure waste behind a game. */}
        {!isFullscreenGame && (
          <div className="header-center">
            <TheoryPanel activeNotes={activeNotes} layout="row" />
          </div>
        )}
      </div>

      {!isFullscreenGame && (
        <div className="waterfall-container">
          <NoteWaterfall
            noteHistory={noteHistory}
            activeNotes={activeNotes}
            startNote={startNote}
            endNote={endNote}
          />
        </div>
      )}

      {!isFullscreenGame && (
        <div className="keyboard-container">
          <PianoKeyboard
            activeNotes={activeNotes}
            startNote={startNote}
            endNote={endNote}
            showLabels={true}
          />
        </div>
      )}

      {sessionInfo?.event === 'session_end' && !isFullscreenGame && (
        <div className="session-summary">
          <p>Session Complete</p>
          <p>{sessionInfo.noteCount} notes in {Math.round(sessionInfo.duration)}s</p>
        </div>
      )}

      {launcherOpen && !rosterVisible && schoolGameAccess.unlocked && (
        <NoteLauncher slots={slots} timeoutMs={timeoutMs} playerName={currentUserName} playerId={currentUser} />
      )}

      {launcherOpen && !rosterVisible && !schoolGameAccess.unlocked && (
        <div className="note-launcher note-launcher--school-locked" role="status">
          <h2>Games are locked</h2>
          <p>
            {schoolGameAccess.status === 'error'
              ? 'School status is unavailable. Games stay locked until it can be checked.'
              : schoolGameAccess.status === 'loading'
                ? 'Checking today’s schoolwork…'
                : 'Finish today’s schoolwork to unlock Games.'}
          </p>
        </div>
      )}

      {/* Second level of the pick: who, then what. Same keyboard, same grammar —
          each player wears the key that chooses them. */}
      {rosterVisible && (
        <NoteLauncher
          slots={userSlots}
          variant="users"
          showTimer={false}
          title="Who's playing? · play their key"
          playerName={currentUserName}
          playerId={currentUser}
        />
      )}


      {/* Sibling of the launcher, not a child: holding the combo with the
          launcher OPEN toggles it shut and only then quits at 2s, so a ring
          living inside the overlay would vanish at exactly the moment the
          player needs to see that holding is doing something. */}
      {isHolding && <HoldRing holdMs={2000} />}

      {confirming && <PlayerConfirm userId={confirming.id} name={confirming.name} />}

      {isFullscreenGame && activeGameEntry?.LazyComponent && schoolGameAccess.unlocked && (
        <div className="tetris-fullscreen">
          {/* This screen has no breadcrumb rail and no user chip, so a game
              opened into a board that named neither itself nor its player. */}
          <OfficeGameChrome
            label={activeGameEntry.label ?? activeGameId}
            icon={activeGameEntry.icon ?? null}
            playerName={currentUserName}
            playerId={currentUser}
          />
          {/* THE STAGE — the room the game is actually given.
              A `replace` game roots itself `position: absolute; inset: 0`, so
              its containing block is whatever positioned ancestor it finds. That
              was `.tetris-fullscreen` itself, which spans the chrome's strip too,
              so chess laid its board out over the full height and the header
              printed across the eighth rank. The chrome was giving space back
              that nothing was taking.
              This is the only positioned box between the two, so `inset: 0` now
              means "below the chrome" for every game at once, rather than each
              game having to know a header exists. */}
          <div className="tetris-fullscreen__stage">
          {/* A game that throws costs the player that game, not the office
              screen. PianoVisualizer never had a boundary; any throw inside any
              game blanked the whole display. */}
          {/* Keyed on the launch, not just the id: re-picking the game already
              running must hand back a NEW game, not the finished board that was
              still on screen. */}
          <GameBoundary
            key={`${activeGameId}:${launchNonce}`}
            resetKey={`${activeGameId}:${launchNonce}`}
            label={activeGameEntry.label ?? 'This game'}
            onExit={quitCrashedGame}
          >
            <Suspense fallback={null}>
              <MountedGame
                Component={activeGameEntry.LazyComponent}
                activeNotes={activeNotes}
                noteHistory={noteHistory}
                /* Note EVENTS, not just note state — a rhythm game scores on the
                   press and cannot recover the timing from a Map. */
                subscribe={subscribe}
                /* The kiosk app config. A game rendered here has no
                   ActivePianoProvider to read it from. */
                appConfig={appConfig}
                gameConfig={gamesConfig?.[activeGameId] ?? null}
                /* Games that keep a record (chess) file it per player. Without
                   this every office-screen game was played by nobody. */
                currentUser={currentUser}
                playerName={currentUserName}
                onDeactivate={quitGame}
              />
            </Suspense>
          </GameBoundary>
          </div>
        </div>
      )}
    </div>
  );
}

export default PianoVisualizer;
