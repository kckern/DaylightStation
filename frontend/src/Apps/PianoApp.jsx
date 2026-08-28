import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';
import { attachPageLifecycleLogging } from '../lib/logging/pageLifecycle.js';
import {
  PianoConfigProvider,
  ActivePianoProvider,
  usePianoKioskConfig,
  usePianoRoster,
} from '../modules/Piano/PianoKiosk/PianoConfig.jsx';
import { resolvePianoConfig } from '../modules/Piano/PianoKiosk/pianoConfigModel.js';
import { PianoMidiProvider, usePianoMidi, usePianoMidiNotes } from '../modules/Piano/PianoKiosk/PianoMidiContext.jsx';
import { PianoUserProvider } from '../modules/Piano/PianoKiosk/PianoUserContext.jsx';
import { useInactivityReturn } from '../modules/Piano/PianoKiosk/useInactivityReturn.js';
import { useAutoStudioEntry } from '../modules/Piano/PianoKiosk/useAutoStudioEntry.js';
import {
  PianoWakeLockProvider,
  PianoScreenControlProvider,
} from '../modules/Piano/PianoKiosk/usePianoScreensaver.jsx';
import { usePianoScreensaver } from '../modules/Piano/PianoKiosk/usePianoScreensaverHooks.js';
import { usePianoScreenOff } from '../modules/Piano/PianoKiosk/usePianoScreenOff.js';
import { KIOSK_DEVICE_ID } from '../modules/Piano/PianoKiosk/kioskDeviceIdentity.js';
import { useKioskLaunchCommand } from '../modules/Piano/PianoKiosk/useKioskLaunchCommand.js';
import { openPianoContent, openPianoCourseLesson } from '../modules/Piano/PianoKiosk/pianoContentOpen.js';
import { PianoPlaybackProvider } from '../modules/Piano/PianoKiosk/PianoPlaybackContext.jsx';
import { usePianoPlayback } from '../modules/Piano/PianoKiosk/usePianoPlayback.js';
import { PianoChrome } from '../modules/Piano/PianoKiosk/PianoChrome.jsx';
import { DeviceStatePublisher } from '../screen-framework/publishers/DeviceStatePublisher.jsx';
import { PianoBreadcrumbProvider } from '../modules/Piano/PianoKiosk/PianoBreadcrumbContext.jsx';
import { PianoSoundProvider } from '../modules/Piano/PianoKiosk/PianoSoundContext.jsx';
import { PianoPresetProvider } from '../modules/Piano/PianoKiosk/usePianoPreset.js';
import { PianoMenu } from '../modules/Piano/PianoKiosk/PianoMenu.jsx';
import { PianoPicker } from '../modules/Piano/PianoKiosk/PianoPicker.jsx';
import { useRenderWatchdog } from '../modules/Piano/PianoKiosk/useRenderWatchdog.js';
import { useJankRebootPrompt } from '../modules/Piano/PianoKiosk/useJankRebootPrompt.js';
import RebootPromptModal from '../modules/Piano/PianoKiosk/RebootPromptModal.jsx';
import { applyPianoBodyTheme } from './pianoBodyTheme.js';
import { Videos } from '../modules/Piano/PianoKiosk/modes/Videos/Videos.jsx';
import { Music } from '../modules/Piano/PianoKiosk/modes/Music/Music.jsx';
import { SheetMusic } from '../modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.jsx';
import { Games } from '../modules/Piano/PianoKiosk/modes/Games/Games.jsx';
import { Exercises } from '../modules/Piano/PianoKiosk/modes/Exercises/Exercises.jsx';
import { Studio } from '../modules/Piano/PianoKiosk/modes/Studio/Studio.jsx';
import { Producer } from '../modules/Piano/PianoKiosk/modes/Producer/Producer.jsx';
import { Singalong } from '../modules/Piano/PianoKiosk/modes/Singalong/Singalong.jsx';
import { Playalong } from '../modules/Piano/PianoKiosk/modes/Playalong/Playalong.jsx';
import { Composer } from '../modules/Piano/PianoKiosk/modes/Composer/Composer.jsx';
import PianoTest from '../modules/Piano/PianoKiosk/modes/Test/PianoTest.jsx';
import KeepAliveVideo from '../modules/Piano/PianoKiosk/KeepAliveVideo.jsx';
import PianoDesignScale from '../modules/Piano/PianoKiosk/PianoDesignScale.jsx';
import { PianoMixProvider } from '../modules/Piano/PianoKiosk/PianoMixContext.jsx';
import { PianoConnectionProvider } from '../modules/Piano/PianoKiosk/PianoConnectionContext.jsx';
import { usePianoUser } from '../modules/Piano/PianoKiosk/PianoUserContext.jsx';
import { useIdleGap } from '../lib/identity/useIdleGap.js';
import { useWhoPromptAutoClose } from '../modules/Piano/PianoKiosk/useWhoPromptAutoClose.js';
import { useAutoMidiHistory } from '../modules/Piano/PianoKiosk/useAutoMidiHistory.js';
import ProfilePicker from '../lib/identity/ProfilePicker.jsx';
import { ShutdownBlackout, useShutdownLock } from '../hooks/useShutdownLock.js';
import './PianoApp.scss';

/**
 * The app slug this kiosk's events are filed under, on both sides: it becomes
 * `context.app` on every event and the directory name the backend session-file
 * transport writes into (`media/logs/piano-kiosk/*.jsonl`).
 */
export const PIANO_KIOSK_LOG_APP = 'piano-kiosk';

/**
 * Fleet visibility: publish this tablet's live device-state (idle / playing
 * video / karaoke) so the /media Devices view shows it. Identity comes from
 * the served config's screensaver.deviceId (yellow-room-tablet) — explicit,
 * never inferred, so a laptop opening /piano can't impersonate the tablet.
 * Mounted above the route shell so an idle or disconnected tablet still
 * reports. Player mounts register via usePlayerSessionBinding.
 */
function PianoFleetPublisher() {
  const { config } = usePianoKioskConfig();
  return <DeviceStatePublisher deviceId={config.screensaver?.deviceId ?? null} />;
}

/**
 * Listens for a parent-initiated app launch from the admin UI and performs it
 * in-page (intent extras need FKB's startIntent, which only exists here).
 *
 * Mounted beside ScreensaverDriver so it runs whether or not anyone is at the
 * keyboard — the whole point is that a parent can start a game remotely.
 * The hook's own identity guard drops anything not addressed to this device, so
 * mounting it on a laptop dev tab is harmless.
 *
 * ALSO wires DoNow's `piano.launch` arm (spec §5, surface `piano-kiosk`):
 * `onPianoOpen` resolves a bare contentId via `openPianoContent`
 * (`pianoContentOpen.js`) — reachable today for SheetMusic-shaped
 * (`source:localId`) content ids only, which it navigates to that mode's
 * `sheetmusic/view/*` route; anything else stays a structured warn + no-op
 * (no other piano mode exposes a generic "open by contentId" resolver — see
 * that module's doc comment). Mounted here (not inside useKioskLaunchCommand
 * itself) because this is the one place with both Router context (useNavigate)
 * and this piano's resolved basePath.
 */
function KioskLaunchListener() {
  const navigate = useNavigate();
  const { basePath } = usePianoKioskConfig();
  const { setCurrentUser } = usePianoUser();
  const { setPlaying, setVideoActive } = usePianoPlayback();
  const { sendPanic } = usePianoMidi();
  const onPianoOpen = useCallback(
    (contentId, { play = null } = {}) => { openPianoContent({ contentId, basePath, navigate, play }); },
    [basePath, navigate]
  );
  const onPianoCourseOpen = useCallback(({ learnerId, courseId, lessonId }) => {
    // The School handoff owns the kiosk now. Navigation unmounts the current
    // mode/player; these explicit resets silence scheduled MIDI immediately
    // and prevent the prior activity's identity locks from leaking visually.
    setPlaying(false);
    setVideoActive(false);
    sendPanic?.();
    setCurrentUser(learnerId);
    openPianoCourseLesson({ courseId, lessonId, basePath, navigate });
  }, [basePath, navigate, sendPanic, setCurrentUser, setPlaying, setVideoActive]);
  useKioskLaunchCommand({ onPianoOpen, onPianoCourseOpen });
  return null;
}

function ScreensaverDriver() {
  const { config } = usePianoKioskConfig();
  const { activeNotes, noteHistory } = usePianoMidiNotes();
  // Global playing flag: Listen-mode performs via timestamped sendNoteAt (no
  // activeNotes churn), so without this hold a long performance would blank the
  // screen mid-piece. keepAlive holds it awake, same gate useInactivityReturn uses.
  const { playing } = usePianoPlayback();
  // Only the tablet itself may drive its own backlight. The served config's
  // deviceId is shared by every client that loads this piano, so a second client
  // (a laptop dev tab) would otherwise run its OWN idle clock and sleep the
  // tablet mid-lesson — its wake-lock / `playing` / MIDI-wake state is local and
  // blind to what the tablet is doing (2026-07-15). Gate on self-identity: this
  // client drives the screen only when its `?device=` identity matches the
  // configured target; otherwise pass a falsy deviceId, which makes the hook inert.
  const configDeviceId = config.screensaver?.deviceId;
  const isThisDevice = !!configDeviceId && KIOSK_DEVICE_ID === configDeviceId;
  usePianoScreensaver({
    deviceId: isThisDevice ? configDeviceId : null,
    activeNotes,
    noteHistory,
    timeoutMinutes: config.screensaver?.timeoutMinutes,
    quietHours: config.screensaver?.quietHours,
    offCooldownMinutes: config.screensaver?.offCooldownMinutes,
    keepAlive: playing,
  });
  return null;
}

function PianoShell() {
  const { config, pianoId, basePath } = usePianoKioskConfig();
  const { subscribe } = usePianoMidi();
  const { activeNotes, noteHistory } = usePianoMidiNotes();
  const navigate = useNavigate();
  const location = useLocation();
  const logger = useMemo(() => getLogger().child({ component: 'piano-app' }), []);
  const { playing, videoActive, playerLocks = [] } = usePianoPlayback();
  const { users, currentUser, setCurrentUser } = usePianoUser();
  const [whoOpen, setWhoOpen] = useState(false);

  // Who's-Playing "Turn off screen": for someone who just wants to play in peace.
  // The shared screen-off action (usePianoScreenOff) turns the backlight off,
  // suppresses MIDI-wake for the cooldown window, and drops to guest; here we
  // also close the prompt. The chrome chip's manual switcher runs the very same
  // action, so both entry points behave identically.
  const screenOff = usePianoScreenOff();
  const handleScreenOff = useCallback(async () => {
    await screenOff();
    setWhoOpen(false);
  }, [screenOff]);

  // Re-prompt "who's playing?" after an idle gap so the next player is credited.
  // Suppressed while a video lecture is open: the open player is already earning
  // watch credit for the current user, so a mid-lesson re-prompt would mis-credit.
  useIdleGap(activeNotes, noteHistory.length, config.whoIsPlayingMinutes, () => {
    // Suppress mid-performance too: Listen mode performs via timestamped MIDI
    // with no activeNotes churn, so the idle-gap could otherwise fire mid-piece.
    //
    // And suppress it while any activity holds the player lock. A game credits
    // its result to whoever started it, and a child thinking for two minutes
    // about a move is EXACTLY the idle gap this prompt watches for — so without
    // this, the one moment the prompt is most likely to fire is the middle of a
    // game, and answering it hands the game to somebody else. The chrome chip
    // was already locked; this was the other door into the same picker.
    if (videoActive || playing || playerLocks.length > 0) return;
    logger.info('piano.who-is-playing.prompt', { pianoId });
    setWhoOpen(true);
  });

  // Silent auto-close (keeps the current player): the qualifying tap above can
  // itself launch playback or open the chip's picker, and the prompt's 30s
  // timeout would then dismiss to Guest over an active lesson / a fresh pick.
  const closeWhoPrompt = useCallback(() => {
    setWhoOpen((was) => {
      if (was) logger.info('piano.who-is-playing.auto-close', { pianoId });
      return false;
    });
  }, [logger, pianoId]);
  useWhoPromptAutoClose({ open: whoOpen, close: closeWhoPrompt, videoActive, playing, currentUser });

  // Always-on MIDI history: capture/segment/flush .mid files under the player.
  useAutoMidiHistory(subscribe, currentUser, config.autoRecord);

  const idleReturnRef = useRef(false);

  // After idle, return to this piano's menu (unless already there).
  // keepAlive=playing suppresses the timer while audio/video is actively playing.
  useInactivityReturn(activeNotes, noteHistory.length, config.inactivityMinutes, () => {
    const home = basePath;
    if (location.pathname !== home) {
      logger.info('piano.inactivity-reset', { from: location.pathname, pianoId });
      // Mark idle-driven ONLY when the idle return is actually leaving Studio —
      // useAutoStudioEntry only consumes this flag on a Studio→menu transition.
      // An idle return from any other route (e.g. /videos) must NOT leave a
      // stale true sitting here for a later, unrelated manual Studio exit to
      // misread as idle-driven (which would re-arm auto-entry and defeat the
      // manual disarm).
      idleReturnRef.current = location.pathname.startsWith(`${basePath}/studio`);
      navigate(home);
    }
  }, playing);

  // Auto-enter Studio when someone sits down and plays on the menu
  // (spec 2026-07-28-piano-auto-studio-design.md).
  useAutoStudioEntry({
    pathname: location.pathname,
    basePath,
    noteHistory,
    autoStudio: config.autoStudio,
    inactivityMinutes: config.inactivityMinutes,
    consumeIdleReturn: () => { const v = idleReturnRef.current; idleReturnRef.current = false; return v; },
    onEnter: () => navigate(`${basePath}/studio`),
  });

  const MODE_LABELS = { videos: 'Courses', playalong: 'Playalong', singalong: 'Karaoke', music: 'Music', sheetmusic: 'Sheet Music', games: 'Games', exercises: 'Exercises', studio: 'Studio', composer: 'Composer', producer: 'Producer' };
  const modeKey = Object.keys(MODE_LABELS).find((k) => location.pathname.includes(`/${k}`));
  const modeLabel = modeKey ? MODE_LABELS[modeKey] : '';
  // The bridge watchdog is outside the WebView, and a DEAD WebView previously
  // gave it no way to distinguish the menu from a child mid-game. Send only the
  // game id (never the player or position) so it can keep recovery non-disruptive
  // while a game is open. The next beat clears this when the player exits.
  const watchdogActivity = useMemo(() => {
    const gamePrefix = `${basePath.replace(/\/$/, '')}/games/`;
    if (!location.pathname.startsWith(gamePrefix)) return null;
    const id = location.pathname.slice(gamePrefix.length).split('/')[0];
    return id ? { type: 'game', id } : null;
  }, [basePath, location.pathname]);
  useRenderWatchdog({ activity: watchdogActivity });

  return (
      <PianoBreadcrumbProvider>
        <div className="piano-app">
          <ProfilePicker
            open={whoOpen && playerLocks.length === 0}
            users={users}
            onPick={(id) => { setCurrentUser(id); setWhoOpen(false); }}
            onDismiss={() => { setCurrentUser('guest'); setWhoOpen(false); }}
            onScreenOff={handleScreenOff}
          />
          <PianoChrome modeLabel={modeLabel} modeKey={modeKey} />
          <Routes>
            <Route index element={<PianoMenu />} />
            <Route path="videos/*" element={<Videos />} />
            <Route path="playalong/*" element={<Playalong />} />
            <Route path="singalong/*" element={<Singalong />} />
            <Route path="music/*" element={<Music />} />
            <Route path="sheetmusic/*" element={<SheetMusic />} />
            <Route path="games/*" element={<Games />} />
            <Route path="exercises/*" element={<Exercises />} />
            {/* The old Training route kept working: bookmarks and the kiosk's
                own history point at it, and a dead link on a wall-mounted
                tablet is not something anyone goes and fixes. */}
            <Route path="lessons/*" element={<Navigate to="../exercises" replace />} />
            <Route path="studio/*" element={<Studio />} />
            <Route path="composer/*" element={<Composer />} />
            <Route path="producer/*" element={<Producer />} />
            <Route path="test/*" element={<PianoTest />} />
            <Route path="*" element={<PianoMenu />} />
          </Routes>
        </div>
      </PianoBreadcrumbProvider>
  );
}

function PianoShutdownGate({ children }) {
  const { sendPanic } = usePianoMidi();
  const shutdown = useShutdownLock(KIOSK_DEVICE_ID ? `piano:${KIOSK_DEVICE_ID}` : '');
  useEffect(() => { if (shutdown.locked) sendPanic?.(); }, [shutdown.locked, sendPanic]);
  return shutdown.locked ? <ShutdownBlackout /> : children;
}

/** Resolves the active piano from the route + roster, then wires MIDI + shell. */
function ActivePiano({ pianoId: pianoIdProp, basePath: basePathProp }) {
  const params = useParams();
  const pianoId = pianoIdProp ?? params.pianoId;
  const basePath = basePathProp ?? `/piano/${pianoId}`;
  const { raw } = usePianoRoster();
  const config = useMemo(() => resolvePianoConfig(raw, pianoId), [raw, pianoId]);

  return (
    <ActivePianoProvider pianoId={pianoId} basePath={basePath} config={config}>
      {/* Always-on keep-alive video — fixes the WebView frame-clock stall on the
          SM-T590 kiosk. It runs on every piano screen, including while the
          connection is unavailable. See KeepAliveVideo.jsx. */}
      <KeepAliveVideo />
      {/* Fixed design canvas: every screen inside lays out at the tablet's
          resolution and scales to fit whatever browser is looking. */}
      <PianoDesignScale width={config.display?.designWidth} height={config.display?.designHeight}>
      <PianoUserProvider pianoId={pianoId}>
      <PianoMidiProvider preferredInputName={config.midi.preferredInputName}>
        <PianoShutdownGate>
        <PianoWakeLockProvider>
          {/* Screensaver runs above the route shell so an idle tablet sleeps
              even with no piano connected; the wake-lock provider is hoisted
              with it so a playing video (a hold set by the modes below) still
              keeps the screen awake. PianoScreenControlProvider wraps both the
              screensaver and the shell so the Who's-Playing "Turn off screen"
              button (in the shell) can arm the screensaver's MIDI-wake mute.
              PianoPlaybackProvider is hoisted above ScreensaverDriver too so the
              screensaver can read the global `playing` flag (keepAlive): Listen
              mode performs via timestamped MIDI with no activeNotes churn, so
              that flag is the only signal keeping the screen awake mid-piece. */}
          <PianoScreenControlProvider>
            <PianoPlaybackProvider>
              <ScreensaverDriver />
              <PianoFleetPublisher />
              <KioskLaunchListener />
              <PianoMixProvider>
                <PianoSoundProvider>
                  <PianoConnectionProvider>
                    <PianoPresetProvider><PianoShell /></PianoPresetProvider>
                  </PianoConnectionProvider>
                </PianoSoundProvider>
              </PianoMixProvider>
            </PianoPlaybackProvider>
          </PianoScreenControlProvider>
        </PianoWakeLockProvider>
        </PianoShutdownGate>
      </PianoMidiProvider>
      </PianoUserProvider>
      </PianoDesignScale>
    </ActivePianoProvider>
  );
}

/**
 * Branches on roster size (must run inside PianoConfigProvider so usePianoRoster
 * works). A single/default piano serves directly under /piano (no :pianoId URL
 * segment). 2+ pianos keep the chooser at /piano and a per-piano /piano/:pianoId.
 */
function PianoRoutes() {
  const { loading, pianos } = usePianoRoster();
  if (loading) return null;
  const single = pianos.length === 1;
  return single ? (
    <Routes>
      <Route path="/*" element={<ActivePiano pianoId={pianos[0].id} basePath="/piano" />} />
    </Routes>
  ) : (
    <Routes>
      <Route index element={<PianoPicker />} />
      <Route path=":pianoId/*" element={<ActivePiano />} />
    </Routes>
  );
}

/**
 * PianoApp — dedicated always-on kiosk app for piano-mounted tablets. A single
 * (default) piano serves at /piano; multi-piano households use /piano/:pianoId
 * (one kiosk each). Sibling of FitnessApp; NOT a screen-framework screen.
 */
export default function PianoApp() {
  useDocumentTitle('Piano');

  // Tag every event this kiosk emits so it reaches disk. The backend's
  // sessionFile transport drops any event whose context lacks BOTH `app` and
  // `sessionLog`, and nothing here used to set either — so on 2026-08-16 the
  // whole video remount storm existed only in container stdout, which Docker
  // truncated on the next restart about 90 minutes later.
  //
  // The slug is `piano-kiosk`, NOT `piano`: `piano` already belongs to
  // PianoVisualizer, the wall-screen widget registered in screen-framework's
  // builtins, which is the only other surface setting `app: 'piano'`. Reusing
  // it would interleave two unrelated surfaces into one session file, which is
  // precisely the confusion that made `media/logs/piano/` look like kiosk
  // evidence when it was nothing of the kind.
  //
  // Configured during render rather than in an effect: descendants build their
  // loggers with getLogger().child({ component }) while THEY render, and a
  // child snapshots the root context at creation. An effect runs after those
  // children have already rendered, so their loggers would be created untagged
  // and stay that way for the life of the page.
  useMemo(() => {
    // Session logging runs at 'info'. Per-component debug can be turned on at
    // runtime with window.DAYLIGHT_LOG_LEVEL='debug' when investigating.
    configureLogger({ level: 'info', context: { app: PIANO_KIOSK_LOG_APP, sessionLog: true } });
  }, []);
  // Leaving the kiosk must not leave the rest of the SPA claiming to be it.
  useEffect(() => () => { configureLogger({ context: { sessionLog: false } }); }, []);

  // Record the document's own suspend/resume transitions. The tablet WebView can
  // pause media and throttle timers without the app ever hearing about it; when
  // that happens these lines are the only evidence that the cause was external.
  useEffect(() => attachPageLifecycleLogging({ app: PIANO_KIOSK_LOG_APP }), []);

  // Carries app + sessionLog explicitly (not just by inheritance) so this child
  // emits the session-log.start that opens a fresh file on the backend.
  const logger = useMemo(() => getLogger().child({ component: 'piano-app', app: PIANO_KIOSK_LOG_APP, sessionLog: true }), []);
  useEffect(() => { logger.info('piano-app.mount', {}); }, [logger]);
  useEffect(() => applyPianoBodyTheme(), []);
  // User-controlled recovery: instead of silently reloading/restarting/rebooting
  // when the SM-T590 render latch hits, ask the user (reboot now / not now → snooze
  // 1h → re-arm). The bridge watchdog is configured to only auto-act on a TRUE hang
  // (no heartbeat), leaving this alive-but-slow case to the user. See
  // useJankRebootPrompt.js / reference_piano_tablet_jank_current_state.
  const jankReboot = useJankRebootPrompt();
  // Always-on frame telemetry (1/min): the 2026-07-01 jank hunt stalled because
  // fps was only measured inside the side-scroller or via probes that reloaded
  // the page (fresh pages read 60 while aged pages had decayed to ~10). This
  // gives a continuous aged-page fps record in prod logs; the side-scroller
  // temporarily re-arms it to 5s while PLAYING.
  useEffect(() => {
    getLogger().startDiagnostics({ intervalMs: 60000 });
    return () => getLogger().stopDiagnostics();
  }, []);

  return (
    <PianoConfigProvider>
      <PianoRoutes />
      <RebootPromptModal open={jankReboot.open} onReboot={jankReboot.onReboot} onDismiss={jankReboot.onDismiss} />
    </PianoConfigProvider>
  );
}
