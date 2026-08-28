import { useCallback, useMemo, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoConnection } from './usePianoConnection.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoScreenOff } from './usePianoScreenOff.js';
import { screenOffFailureMessage } from './useScreenControl.js';
import { useArmedAction } from '../../../lib/identity/useArmedAction.js';
import { launchAndroidTarget } from '../../../lib/fkb.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import PianoMidiMonitor from './PianoMidiMonitor.jsx';
import PianoSheet from './PianoSheet.jsx';
import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';

const directionCopy = (available) => available ? 'connected' : 'not connected';

export default function OperatorDrawer({ open, onClose }) {
  const midi = usePianoMidi();
  const { health, repair, repairConnection } = usePianoConnection();
  const { config, pianoId } = usePianoKioskConfig();
  const turnOffPianoScreen = usePianoScreenOff();
  const logger = useMemo(() => getLogger().child({ component: 'piano-maintenance', pianoId }), [pianoId]);
  const [connectionDetails, setConnectionDetails] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [action, setAction] = useState({ state: 'idle', message: null, name: null });
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const report = useCallback((name, state, message, detail = {}) => {
    setAction({ name, state, message });
    const data = { action: name, state, ...detail };
    if (state === 'failed') logger.warn('piano.maintenance.action', data);
    else logger.info('piano.maintenance.action', data);
  }, [logger]);

  const playTestNote = useCallback(() => {
    report('test-note', 'working', 'Sending test note…');
    const sent = midi.sendNote(60, 100, 0, 500);
    report('test-note', sent ? 'success' : 'failed', sent ? 'Test note command sent.' : 'Piano not connected.', { sent });
  }, [midi, report]);

  const stopStuckNotes = useCallback(() => {
    report('stop-stuck-notes', 'working', 'Stopping notes…');
    const sent = midi.sendPanic();
    report('stop-stuck-notes', sent ? 'success' : 'failed', sent ? 'Stop stuck notes command sent.' : 'Piano not connected.', { sent });
  }, [midi, report]);

  const { armed: screenArmed, trigger: screenOff } = useArmedAction(async () => {
    report('screen-off', 'working', 'Turning off display…');
    const result = await turnOffPianoScreen();
    report('screen-off', result?.ok ? 'success' : 'failed', result?.ok ? 'Display turned off.' : screenOffFailureMessage(result), result);
  }, { armMs: 3000 });

  const { armed: reloadArmed, trigger: reload } = useArmedAction(() => {
    report('restart-app', 'working', 'Restarting piano app…');
    window.location.reload();
  }, { armMs: 3000 });

  const deviceId = config?.screensaver?.deviceId || null;
  const { armed: rebootArmed, trigger: reboot } = useArmedAction(async () => {
    report('reboot-tablet', 'working', 'Requesting tablet reboot…');
    try {
      const result = await DaylightAPI(`api/v1/device/${deviceId}/reboot`, {}, 'POST');
      if (result?.ok === false) throw new Error(result.error || 'request rejected');
      report('reboot-tablet', 'success', 'Tablet reboot requested.');
    } catch (error) {
      report('reboot-tablet', 'failed', `Couldn’t reboot tablet: ${error?.message || 'request failed'}`);
    }
  }, { armMs: 3000 });

  const inputAvailable = health.input.state !== 'down';
  const outputAvailable = health.output.state === 'up';
  const showBluetooth = config?.bluetooth && (health.state === 'offline' || repair.state === 'failed' || connectionDetails);

  return <PianoSheet open={open} title="Piano maintenance" onClose={onClose} className="piano-operator-drawer">
    <section>
      <h3>Connection</h3>
      <p>Piano keys are {directionCopy(inputAvailable)}. Sound controls are {directionCopy(outputAvailable)}.</p>
      <button type="button" className="piano-operator-drawer__restart" onClick={repairConnection} disabled={repair.state === 'working'}>{repair.state === 'working' ? 'Repairing connection…' : 'Repair connection'}</button>
      {repair.message && <p role="status">{repair.message}</p>}
      {outputAvailable && <button type="button" onClick={playTestNote}>Play test note</button>}
      <button type="button" aria-expanded={connectionDetails} onClick={() => setConnectionDetails((value) => !value)}>Connection details</button>
      {connectionDetails && <div className="piano-operator-drawer__details"><p>Input: {health.input.name || 'none'}</p><p>Output: {health.output.name || 'none'}</p><p>Bridge: {health.bridge.state}</p></div>}
      {showBluetooth && <button type="button" onClick={() => { logger.info('piano.maintenance.bluetooth', {}); launchAndroidTarget(config.bluetooth); }}>Open Bluetooth pairing</button>}
    </section>

    <section><h3>Common problems</h3><button type="button" onClick={stopStuckNotes}>Stop stuck notes</button></section>

    <section><h3>Display</h3><button type="button" className={screenArmed ? 'is-armed' : ''} onClick={screenOff}>{screenArmed ? 'Tap again to confirm' : 'Turn off display'}</button></section>

    <section><button type="button" aria-expanded={diagnostics} onClick={() => setDiagnostics((value) => !value)}>Diagnostics</button>{diagnostics && <PianoMidiMonitor />}</section>

    <section><button type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>Advanced recovery</button>{advanced && <div className="piano-operator-drawer__advanced">
      <button type="button" className={reloadArmed ? 'is-armed' : ''} onClick={reload}>{reloadArmed ? 'Tap again to restart piano app' : 'Restart piano app'}</button>
      {deviceId && <button type="button" className={rebootArmed ? 'is-armed' : ''} onClick={reboot}>{rebootArmed ? 'Tap again to reboot tablet' : 'Reboot tablet'}</button>}
    </div>}</section>

    {action.message && <p className={`piano-operator-drawer__status is-${action.state}`} role="status">{action.message}</p>}

    <section><h3>Feedback</h3><button type="button" onClick={() => setFeedbackOpen(true)}>Record feedback</button><FeedbackOverlay open={feedbackOpen} app="piano" context={{ pianoId, surface: 'piano-maintenance' }} onClose={() => setFeedbackOpen(false)} /></section>
  </PianoSheet>;
}
