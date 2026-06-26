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
import { PianoMidiProvider, usePianoMidi } from '../modules/Piano/PianoKiosk/PianoMidiContext.jsx';
import { PianoUserProvider } from '../modules/Piano/PianoKiosk/PianoUserContext.jsx';
import { useInactivityReturn } from '../modules/Piano/PianoKiosk/useInactivityReturn.js';
import {
  PianoWakeLockProvider,
  usePianoScreensaver,
} from '../modules/Piano/PianoKiosk/usePianoScreensaver.jsx';
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
import { Composers } from '../modules/Piano/PianoKiosk/modes/Composers/Composers.jsx';
import PianoTest from '../modules/Piano/PianoKiosk/modes/Test/PianoTest.jsx';
import KeepAliveVideo from '../modules/Piano/PianoKiosk/KeepAliveVideo.jsx';
import { PianoMixProvider } from '../modules/Piano/PianoKiosk/PianoMixContext.jsx';
import { usePianoUser } from '../modules/Piano/PianoKiosk/PianoUserContext.jsx';
import { useWhoIsPlaying } from '../modules/Piano/PianoKiosk/useWhoIsPlaying.js';
import WhoIsPlayingPrompt from '../modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx';
import './PianoApp.scss';

/**
 * Connect-gate: BLE pairing is an OS concern, so the browser only sees already-
 * paired ports. Until Web MIDI is connected, show a tap-to-connect screen.
 */
function ConnectGate({ children }) {
  const { status, connect } = usePianoMidi();
  const { config } = usePianoKioskConfig();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (status === 'idle') connect();
  }, [status, connect]);

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
      <h1>Piano</h1>
      <p>{message}</p>
      {status !== 'unsupported' && (
        <button type="button" className="piano-connect-gate__btn" onClick={connect}>
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
  );
}

function PianoShell() {
  const { config, pianoId, basePath } = usePianoKioskConfig();
  const { activeNotes, noteHistory } = usePianoMidi();
  const navigate = useNavigate();
  const location = useLocation();
  const logger = useMemo(() => getLogger().child({ component: 'piano-app' }), []);
  const { playing } = usePianoPlayback();
  const { users, setCurrentUser } = usePianoUser();
  const [whoOpen, setWhoOpen] = useState(false);

  // Re-prompt "who's playing?" after an idle gap so the next player is credited.
  useWhoIsPlaying(activeNotes, noteHistory.length, config.whoIsPlayingMinutes, () => {
    logger.info('piano.who-is-playing.prompt', { pianoId });
    setWhoOpen(true);
  });

  // After idle, return to this piano's menu (unless already there).
  // keepAlive=playing suppresses the timer while audio/video is actively playing.
  useInactivityReturn(activeNotes, noteHistory.length, config.inactivityMinutes, () => {
    const home = basePath;
    if (location.pathname !== home) {
      logger.info('piano.inactivity-reset', { from: location.pathname, pianoId });
      navigate(home);
    }
  }, playing);

  // Screensaver: a MIDI note wakes the tablet screen; idle sleeps it. Guardrails
  // (playing video / quiet hours) live in the hook. Inert until a deviceId is
  // configured under the piano's `screensaver` config.
  usePianoScreensaver({
    deviceId: config.screensaver?.deviceId,
    activeNotes,
    noteHistory,
    timeoutMinutes: config.screensaver?.timeoutMinutes,
    quietHours: config.screensaver?.quietHours,
  });

  const MODE_LABELS = { videos: 'Courses', music: 'Music', sheetmusic: 'Sheet Music', games: 'Games', lessons: 'Lessons', studio: 'Studio', producer: 'Producer', composers: 'Composers' };
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
          />
          <PianoChrome modeLabel={modeLabel} modeKey={modeKey} />
          <Routes>
            <Route index element={<PianoMenu />} />
            <Route path="videos/*" element={<Videos />} />
            <Route path="music/*" element={<Music />} />
            <Route path="sheetmusic/*" element={<SheetMusic />} />
            <Route path="games/*" element={<Games />} />
            <Route path="lessons/*" element={<Lessons />} />
            <Route path="studio/*" element={<Studio />} />
            <Route path="producer/*" element={<Producer />} />
            <Route path="composers" element={<Composers />} />
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
        <ConnectGate>
          <PianoPlaybackProvider>
            <PianoMixProvider>
              <PianoWakeLockProvider>
                <PianoShell />
              </PianoWakeLockProvider>
            </PianoMixProvider>
          </PianoPlaybackProvider>
        </ConnectGate>
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

  return (
    <PianoConfigProvider>
      <PianoRoutes />
    </PianoConfigProvider>
  );
}
