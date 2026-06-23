import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import getLogger from '../lib/logging/Logger.js';
import {
  PianoConfigProvider,
  ActivePianoProvider,
  usePianoKioskConfig,
  usePianoRoster,
  resolvePianoConfig,
} from '../modules/Piano/PianoKiosk/PianoConfig.jsx';
import { PianoMidiProvider, usePianoMidi } from '../modules/Piano/PianoKiosk/PianoMidiContext.jsx';
import { useInactivityReturn } from '../modules/Piano/PianoKiosk/useInactivityReturn.js';
import {
  PianoWakeLockProvider,
  usePianoScreensaver,
} from '../modules/Piano/PianoKiosk/usePianoScreensaver.jsx';
import { PianoChrome } from '../modules/Piano/PianoKiosk/PianoChrome.jsx';
import { PianoMenu } from '../modules/Piano/PianoKiosk/PianoMenu.jsx';
import { PianoPicker } from '../modules/Piano/PianoKiosk/PianoPicker.jsx';
import { Videos } from '../modules/Piano/PianoKiosk/modes/Videos/Videos.jsx';
import { Music } from '../modules/Piano/PianoKiosk/modes/Music/Music.jsx';
import { SheetMusic } from '../modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.jsx';
import { Games } from '../modules/Piano/PianoKiosk/modes/Games/Games.jsx';
import { Lessons } from '../modules/Piano/PianoKiosk/modes/Lessons/Lessons.jsx';
import { Studio } from '../modules/Piano/PianoKiosk/modes/Studio/Studio.jsx';
import { Instruments } from '../modules/Piano/PianoKiosk/modes/Instruments/Instruments.jsx';
import { Composers } from '../modules/Piano/PianoKiosk/modes/Composers/Composers.jsx';
import './PianoApp.scss';

/**
 * Connect-gate: BLE pairing is an OS concern, so the browser only sees already-
 * paired ports. Until Web MIDI is connected, show a tap-to-connect screen.
 */
function ConnectGate({ children }) {
  const { status, connect } = usePianoMidi();
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
  const { config, pianoId } = usePianoKioskConfig();
  const { activeNotes, noteHistory } = usePianoMidi();
  const navigate = useNavigate();
  const location = useLocation();
  const logger = useMemo(() => getLogger().child({ component: 'piano-app' }), []);

  // After idle, return to this piano's menu (unless already there).
  useInactivityReturn(activeNotes, noteHistory.length, config.inactivityMinutes, () => {
    const home = `/piano/${pianoId}`;
    if (location.pathname !== home) {
      logger.info('piano.inactivity-reset', { from: location.pathname, pianoId });
      navigate(home);
    }
  });

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

  return (
    <div className="piano-app">
      <PianoChrome voices={config.voices} instruments={config.instruments} label={config.label} pianoId={pianoId} />
      <Routes>
        <Route index element={<PianoMenu />} />
        <Route path="videos" element={<Videos />} />
        <Route path="music" element={<Music />} />
        <Route path="sheetmusic" element={<SheetMusic />} />
        <Route path="games" element={<Games />} />
        <Route path="lessons/*" element={<Lessons />} />
        <Route path="studio" element={<Studio />} />
        <Route path="instruments" element={<Instruments />} />
        <Route path="composers" element={<Composers />} />
        <Route path="*" element={<PianoMenu />} />
      </Routes>
    </div>
  );
}

/** Resolves the active piano from the route + roster, then wires MIDI + shell. */
function ActivePiano() {
  const { pianoId } = useParams();
  const { raw } = usePianoRoster();
  const config = useMemo(() => resolvePianoConfig(raw, pianoId), [raw, pianoId]);

  return (
    <ActivePianoProvider pianoId={pianoId} config={config}>
      <PianoMidiProvider preferredInputName={config.midi.preferredInputName}>
        <ConnectGate>
          <PianoWakeLockProvider>
            <PianoShell />
          </PianoWakeLockProvider>
        </ConnectGate>
      </PianoMidiProvider>
    </ActivePianoProvider>
  );
}

/**
 * PianoApp — dedicated always-on kiosk app for piano-mounted tablets. Supports
 * multiple pianos per household (one kiosk each) via /piano/:pianoId. Sibling of
 * FitnessApp; NOT a screen-framework screen.
 */
export default function PianoApp() {
  useDocumentTitle('Piano');
  const logger = useMemo(() => getLogger().child({ component: 'piano-app' }), []);
  useEffect(() => { logger.info('piano-app.mount', {}); }, [logger]);

  return (
    <PianoConfigProvider>
      <Routes>
        <Route index element={<PianoPicker />} />
        <Route path=":pianoId/*" element={<ActivePiano />} />
      </Routes>
    </PianoConfigProvider>
  );
}
