import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import getLogger from '../lib/logging/Logger.js';
import { launchAndroidTarget } from '../lib/fkb.js';
import {
  PianoConfigProvider,
  ActivePianoProvider,
  usePianoKioskConfig,
  usePianoRoster,
  resolvePianoConfig,
} from '../modules/Piano/PianoKiosk/PianoConfig.jsx';
import { PianoMidiProvider, usePianoMidi, usePianoMidiNotes } from '../modules/Piano/PianoKiosk/PianoMidiContext.jsx';
import { PianoUserProvider } from '../modules/Piano/PianoKiosk/PianoUserContext.jsx';
import { useInactivityReturn } from '../modules/Piano/PianoKiosk/useInactivityReturn.js';
import { useScreenControl, screenOffFailureMessage } from '../modules/Piano/PianoKiosk/useScreenControl.js';
import { useArmedAction } from '../modules/Piano/PianoKiosk/useArmedAction.js';
import {
  PianoWakeLockProvider,
  usePianoScreensaver,
  PianoScreenControlProvider,
  useScreenOffCooldown,
} from '../modules/Piano/PianoKiosk/usePianoScreensaver.jsx';
import { DaylightAPI } from '../lib/api.mjs';
import {
  PianoPlaybackProvider,
  usePianoPlayback,
} from '../modules/Piano/PianoKiosk/PianoPlaybackContext.jsx';
import { PianoChrome } from '../modules/Piano/PianoKiosk/PianoChrome.jsx';
import { PianoBreadcrumbProvider } from '../modules/Piano/PianoKiosk/PianoBreadcrumbContext.jsx';
import { PianoSoundProvider } from '../modules/Piano/PianoKiosk/PianoSoundContext.jsx';
import { PianoMenu } from '../modules/Piano/PianoKiosk/PianoMenu.jsx';
import { PianoPicker } from '../modules/Piano/PianoKiosk/PianoPicker.jsx';
import { useRenderWatchdog } from '../modules/Piano/PianoKiosk/useRenderWatchdog.js';
import { applyPianoBodyTheme } from './pianoBodyTheme.js';
import { Videos } from '../modules/Piano/PianoKiosk/modes/Videos/Videos.jsx';
import { Music } from '../modules/Piano/PianoKiosk/modes/Music/Music.jsx';
import { SheetMusic } from '../modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.jsx';
import { Games } from '../modules/Piano/PianoKiosk/modes/Games/Games.jsx';
import { Lessons } from '../modules/Piano/PianoKiosk/modes/Lessons/Lessons.jsx';
import { Studio } from '../modules/Piano/PianoKiosk/modes/Studio/Studio.jsx';
import { Producer } from '../modules/Piano/PianoKiosk/modes/Producer/Producer.jsx';
import { Singalong } from '../modules/Piano/PianoKiosk/modes/Singalong/Singalong.jsx';
import { Composer } from '../modules/Piano/PianoKiosk/modes/Composer/Composer.jsx';
import PianoTest from '../modules/Piano/PianoKiosk/modes/Test/PianoTest.jsx';
import KeepAliveVideo from '../modules/Piano/PianoKiosk/KeepAliveVideo.jsx';
import { PianoMixProvider } from '../modules/Piano/PianoKiosk/PianoMixContext.jsx';
import { usePianoUser } from '../modules/Piano/PianoKiosk/PianoUserContext.jsx';
import { useWhoIsPlaying } from '../modules/Piano/PianoKiosk/useWhoIsPlaying.js';
import { useAutoMidiHistory } from '../modules/Piano/PianoKiosk/useAutoMidiHistory.js';
import WhoIsPlayingPrompt from '../modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx';
import './PianoApp.scss';

/**
 * Connect-gate: BLE pairing is an OS concern, so the browser only sees already-
 * paired ports. Until Web MIDI is connected, show a tap-to-connect screen.
 */
export function ConnectGate({ children }) {
  const { status, connect } = usePianoMidi();
  const { config } = usePianoKioskConfig();
  const { turnOffScreen } = useScreenControl();
  const [dismissed, setDismissed] = useState(false);
  const [screenError, setScreenError] = useState(null);

  useEffect(() => {
    if (status === 'idle') connect();
  }, [status, connect]);

  // 2-tap arm/confirm even here — the connect screen is the highest lock-out-risk
  // surface (no piano paired → no BLE/MIDI wake; once the backlight is off, touch
  // is dead → only FKB REST recovers it), so a stray tap must not blank it.
  const { armed: screenArmed, trigger: triggerScreenOff } = useArmedAction(async () => {
    const res = await turnOffScreen();
    setScreenError(res?.ok === false ? screenOffFailureMessage(res) : null);
  }, { armMs: 3000 });

  // Auto-clear the transient failure note.
  useEffect(() => {
    if (!screenError) return undefined;
    const t = setTimeout(() => setScreenError(null), 4000);
    return () => clearTimeout(t);
  }, [screenError]);

  if (status === 'connected' || dismissed) return children;

  const message = {
    idle: 'Connecting…',
    requesting: 'Connecting…',
    'no-input': 'No piano found. Pair it over Bluetooth, then tap to retry.',
    denied: 'MIDI access was blocked. Tap to grant access.',
    unsupported: 'This browser does not support Web MIDI.',
  }[status] || 'Connect your piano.';

  return (
    <div className="piano-connect-gate">
      <div className="piano-connect-gate__card">
        <h1 className="piano-connect-gate__title">Piano</h1>
        {/* Status line doubles as the transient screen-off failure surface. */}
        <p className="piano-connect-gate__status" role="status" aria-live="polite">{screenError || message}</p>

        <div className="piano-connect-gate__actions">
          {status !== 'unsupported' && (
            <button type="button" className="piano-connect-gate__btn piano-connect-gate__btn--primary" onClick={connect}>
              Connect piano
            </button>
          )}
          {config?.bluetooth && (
            <button
              type="button"
              className="piano-connect-gate__btn piano-connect-gate__btn--ghost"
              onClick={() => launchAndroidTarget(config.bluetooth)}
            >
              Open Bluetooth settings
            </button>
          )}
          <button
            type="button"
            className="piano-connect-gate__skip"
            onClick={() => setDismissed(true)}
          >
            Continue without piano
          </button>
        </div>

        {/* Device action — burn-in kill switch. This gate can sit lit for a long
            time waiting on a pairing, so offer a manual screen-off. Separated by
            a divider because it is a device action, not a connect action. 2-tap
            arm/confirm guards against an unrecoverable stray-tap blackout. */}
        <div className="piano-connect-gate__device">
          <button
            type="button"
            className={`piano-connect-gate__screen-off${screenArmed ? ' is-armed' : ''}`}
            aria-live="polite"
            onClick={triggerScreenOff}
          >
            {screenArmed ? 'Tap again to confirm' : 'Turn off screen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Drives the tablet screensaver independent of the connect gate. Mounted ABOVE
 * <ConnectGate> (unlike PianoShell) so an idle tablet still sleeps its screen
 * even when no piano is connected — otherwise the screensaver would only arm
 * once Web MIDI connects, and a tablet parked on the connect screen would never
 * sleep. Shares the wake-lock context with the modes below, so a playing video
 * still keeps the screen awake. Renders nothing.
 */
function ScreensaverDriver() {
  const { config } = usePianoKioskConfig();
  const { activeNotes, noteHistory } = usePianoMidiNotes();
  // Global playing flag: Listen-mode performs via timestamped sendNoteAt (no
  // activeNotes churn), so without this hold a long performance would blank the
  // screen mid-piece. keepAlive holds it awake, same gate useInactivityReturn uses.
  const { playing } = usePianoPlayback();
  usePianoScreensaver({
    deviceId: config.screensaver?.deviceId,
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
  const { playing, videoActive } = usePianoPlayback();
  const { users, currentUser, setCurrentUser } = usePianoUser();
  const [whoOpen, setWhoOpen] = useState(false);
  const { turnOffScreen } = useScreenControl();
  const beginScreenOffCooldown = useScreenOffCooldown();

  // Who's-Playing "Turn off screen": for someone who just wants to play in peace.
  // Turn the backlight off, then suppress MIDI-wake across all three paths — the
  // in-browser screensaver (local), and the backend midi-wake + on-device APK
  // (via the suppress-wake endpoint) — so a played note won't re-light it until
  // they've been idle offCooldownMinutes. Treated as a dismiss-to-guest.
  const handleScreenOff = useMemo(() => async () => {
    const minutes = config.screensaver?.offCooldownMinutes ?? 30;
    await turnOffScreen();
    beginScreenOffCooldown();
    const deviceId = config.screensaver?.deviceId;
    if (deviceId) {
      DaylightAPI(`api/v1/device/${deviceId}/screen/suppress-wake`, { minutes }, 'POST').catch(() => {});
    }
    setCurrentUser('guest');
    setWhoOpen(false);
  }, [config.screensaver, turnOffScreen, beginScreenOffCooldown, setCurrentUser]);

  // Re-prompt "who's playing?" after an idle gap so the next player is credited.
  // Suppressed while a video lecture is open: the open player is already earning
  // watch credit for the current user, so a mid-lesson re-prompt would mis-credit.
  useWhoIsPlaying(activeNotes, noteHistory.length, config.whoIsPlayingMinutes, () => {
    // Suppress mid-performance too: Listen mode performs via timestamped MIDI
    // with no activeNotes churn, so the idle-gap could otherwise fire mid-piece.
    if (videoActive || playing) return;
    logger.info('piano.who-is-playing.prompt', { pianoId });
    setWhoOpen(true);
  });

  // Always-on MIDI history: capture/segment/flush .mid files under the player.
  useAutoMidiHistory(subscribe, currentUser, config.autoRecord);

  // After idle, return to this piano's menu (unless already there).
  // keepAlive=playing suppresses the timer while audio/video is actively playing.
  useInactivityReturn(activeNotes, noteHistory.length, config.inactivityMinutes, () => {
    const home = basePath;
    if (location.pathname !== home) {
      logger.info('piano.inactivity-reset', { from: location.pathname, pianoId });
      navigate(home);
    }
  }, playing);

  const MODE_LABELS = { videos: 'Courses', playalong: 'Playalong', singalong: 'Singalong', music: 'Music', sheetmusic: 'Sheet Music', games: 'Games', lessons: 'Training', studio: 'Studio', composer: 'Composer', producer: 'Producer' };
  const modeKey = Object.keys(MODE_LABELS).find((k) => location.pathname.includes(`/${k}`));
  const modeLabel = modeKey ? MODE_LABELS[modeKey] : '';

  return (
    <PianoSoundProvider>
      <PianoBreadcrumbProvider>
        <div className="piano-app">
          <WhoIsPlayingPrompt
            open={whoOpen}
            users={users}
            onPick={(id) => { setCurrentUser(id); setWhoOpen(false); }}
            onDismiss={() => { setCurrentUser('guest'); setWhoOpen(false); }}
            onScreenOff={handleScreenOff}
          />
          <PianoChrome modeLabel={modeLabel} modeKey={modeKey} />
          <Routes>
            <Route index element={<PianoMenu />} />
            <Route path="videos/*" element={<Videos />} />
            <Route path="playalong/*" element={<Videos source={config.playalong} />} />
            <Route path="singalong/*" element={<Singalong />} />
            <Route path="music/*" element={<Music />} />
            <Route path="sheetmusic/*" element={<SheetMusic />} />
            <Route path="games/*" element={<Games />} />
            <Route path="lessons/*" element={<Lessons />} />
            <Route path="studio/*" element={<Studio />} />
            <Route path="composer/*" element={<Composer />} />
            <Route path="producer/*" element={<Producer />} />
            <Route path="test/*" element={<PianoTest />} />
            <Route path="*" element={<PianoMenu />} />
          </Routes>
        </div>
      </PianoBreadcrumbProvider>
    </PianoSoundProvider>
  );
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
          SM-T590 kiosk. Outside ConnectGate so it runs on every piano screen,
          including the connect/menu screens. See KeepAliveVideo.jsx. */}
      <KeepAliveVideo />
      <PianoUserProvider pianoId={pianoId}>
      <PianoMidiProvider preferredInputName={config.midi.preferredInputName}>
        <PianoWakeLockProvider>
          {/* Screensaver runs above the connect gate so an idle tablet sleeps
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
              <ConnectGate>
                <PianoMixProvider>
                  <PianoShell />
                </PianoMixProvider>
              </ConnectGate>
            </PianoPlaybackProvider>
          </PianoScreenControlProvider>
        </PianoWakeLockProvider>
      </PianoMidiProvider>
      </PianoUserProvider>
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
  const logger = useMemo(() => getLogger().child({ component: 'piano-app' }), []);
  useEffect(() => { logger.info('piano-app.mount', {}); }, [logger]);
  useEffect(() => applyPianoBodyTheme(), []);
  // Self-heal: if the Fully WebView's compositor gets stuck (renderer pegs, fps
  // collapses, a reload won't clear it), restart the WebView via the Fully JS
  // Interface. No-op outside the kiosk. See useRenderWatchdog.js.
  useRenderWatchdog();
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
    </PianoConfigProvider>
  );
}
