import { useCallback, useEffect, useMemo, Suspense } from 'react';
import { configure as configureLogger, getLogger } from '../../lib/logging/Logger.js';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { TheoryPanel } from './components/TheoryPanel';
import { useMidiSubscription } from './useMidiSubscription';
import { computeKeyboardRange } from './noteUtils.js';
import './PianoVisualizer.scss';
import { getGameEntry, getGameIds } from './gameRegistry.js';
import { buildLauncherSlots } from './game-platform/launcher/launcherNotes.js';
import { useNoteLauncher } from './game-platform/launcher/useNoteLauncher.js';
import NoteLauncher from './game-platform/launcher/NoteLauncher.jsx';
import HoldRing from './game-platform/launcher/HoldRing.jsx';
import GameBoundary from './game-platform/host/GameBoundary.jsx';
import { usePianoConfig } from './usePianoConfig.js';
import { useInactivityTimer } from './useInactivityTimer.js';
import { useSessionTracking } from './useSessionTracking.js';
import { useSpamDetection } from './useSpamDetection.js';
import { useScreenOverlay } from '../../screen-framework/overlays/ScreenOverlayProvider.jsx';

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export function PianoVisualizer({ onClose, onSessionEnd, initialGame = null }) {
  const { activeNotes, sustainPedal, sessionInfo, noteHistory } = useMidiSubscription();
  const { spamState, warningVisible, blackoutRemaining, spamEventCount } = useSpamDetection(activeNotes, noteHistory);
  const { gamesConfig } = usePianoConfig();

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

  const { isOpen: launcherOpen, activeGameId, isHolding, dismiss, exitGame, timeoutMs } =
    useNoteLauncher({ activeNotes, slots, initialGame });

  const activeGameEntry = activeGameId ? getGameEntry(activeGameId) : null;
  const isFullscreenGame = activeGameEntry?.layout === 'replace';

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

  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(null),
    []
  );

  useEffect(() => {
    if (sessionInfo?.event === 'session_end' && onSessionEnd) {
      const timer = setTimeout(() => { onSessionEnd(sessionInfo); }, 2000);
      return () => clearTimeout(timer);
    }
  }, [sessionInfo, onSessionEnd]);

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

  return (
    <div className={`piano-visualizer${isFullscreenGame ? ' tetris-mode' : ''}`}>
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
        <div className="header-center">
          <TheoryPanel activeNotes={activeNotes} layout="row" />
        </div>
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

      {sessionInfo?.event === 'session_end' && (
        <div className="session-summary">
          <p>Session Complete</p>
          <p>{sessionInfo.noteCount} notes in {Math.round(sessionInfo.duration)}s</p>
        </div>
      )}

      {launcherOpen && <NoteLauncher slots={slots} timeoutMs={timeoutMs} />}

      {/* Sibling of the launcher, not a child: holding the combo with the
          launcher OPEN toggles it shut and only then quits at 2s, so a ring
          living inside the overlay would vanish at exactly the moment the
          player needs to see that holding is doing something. */}
      {isHolding && <HoldRing holdMs={2000} />}

      {isFullscreenGame && activeGameEntry?.LazyComponent && (
        <div className="tetris-fullscreen">
          {/* A game that throws costs the player that game, not the office
              screen. PianoVisualizer never had a boundary; any throw inside any
              game blanked the whole display. */}
          <GameBoundary
            resetKey={activeGameId}
            label={activeGameEntry.label ?? 'This game'}
            onExit={quitCrashedGame}
          >
            <Suspense fallback={null}>
              <activeGameEntry.LazyComponent
                activeNotes={activeNotes}
                noteHistory={noteHistory}
                gameConfig={gamesConfig?.[activeGameId] ?? null}
                onDeactivate={quitGame}
              />
            </Suspense>
          </GameBoundary>
        </div>
      )}
    </div>
  );
}

export default PianoVisualizer;
