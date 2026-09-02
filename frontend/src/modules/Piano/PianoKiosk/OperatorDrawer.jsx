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
import TransportSheet from './transport/TransportSheet.jsx';
import SettingsTile from './SettingsTile.jsx';
import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';
import './SettingsSheets.scss';

// Bridge link → dot tone + words. One place, so the card and the chip agree.
const bridgeRow = (bridge) => {
  if (bridge.unavailable) return { tone: 'off', text: 'not running' };
  if (bridge.state === 'open') return { tone: 'on', text: 'connected' };
  if (['idle', 'connecting', 'reconnecting'].includes(bridge.state)) return { tone: 'warn', text: `${bridge.state}…` };
  return { tone: 'off', text: bridge.state || 'not connected' };
};

function StatusRow({ label, tone, text }) {
  return <div className="piano-settings__statusrow"><span className={`piano-settings__dot is-${tone}`} aria-hidden /><span>{label}: {text}</span></div>;
}

export default function OperatorDrawer({ open, onClose }) {
  const midi = usePianoMidi();
  const { health, repair, repairConnection } = usePianoConnection();
  const { config, pianoId } = usePianoKioskConfig();
  const turnOffPianoScreen = usePianoScreenOff();
  const logger = useMemo(() => getLogger().child({ component: 'piano-maintenance', pianoId }), [pianoId]);
  const [diagnostics, setDiagnostics] = useState(false);
  const [action, setAction] = useState({ state: 'idle', message: null, name: null });
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const report = useCallback((name, state, message, detail = {}) => {
    setAction({ name, state, message });
    const data = { action: name, state, ...detail };
    if (state === 'failed') logger.warn('piano.maintenance.action', data);
    else logger.info('piano.maintenance.action', data);
  }, [logger]);
  const messageFor = (name) => (action.name === name ? action.message : null);
  const toneFor = (name) => (action.name === name ? action.state : 'idle');

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

  const ready = health.state === 'ready';
  const inputUp = health.input.state !== 'down';
  const outputUp = health.output.state === 'up';
  const bridge = bridgeRow(health.bridge || {});
  const repairing = repair.state === 'working';

  return <TransportSheet open={open} title="Piano maintenance" onClose={onClose} size="canvas" className="piano-maintenance-sheet">
    <div className="piano-settings__maint">
      <div className="piano-settings__status" role="group" aria-label="Connection">
        <strong>{health.copy ? `Piano ${health.copy}` : 'Piano'}</strong>
        <StatusRow label="Keys" tone={inputUp ? 'on' : 'off'} text={inputUp ? (health.input.name || 'connected') : 'not connected'} />
        <StatusRow label="Sound" tone={outputUp ? 'on' : 'off'} text={outputUp ? (health.output.name || 'connected') : 'not connected'} />
        <StatusRow label="Bridge" tone={bridge.tone} text={bridge.text} />
      </div>

      <div className="piano-settings__big">
        {config?.bluetooth && <SettingsTile icon="bluetooth-active" label="Bluetooth pairing" emphasis={ready ? 'default' : 'primary'} onPress={() => { logger.info('piano.maintenance.bluetooth', {}); launchAndroidTarget(config.bluetooth); }} />}
        <SettingsTile icon="connection" label={repairing ? 'Repairing connection…' : 'Repair connection'} emphasis={ready ? 'default' : 'primary'} disabled={repairing} onPress={repairConnection} message={repair.message} tone={repair.state === 'failed' ? 'failed' : repair.state === 'success' ? 'success' : 'idle'} />
      </div>

      {diagnostics ? <div className="piano-settings__diag">
        <SettingsTile icon="back" label="Back" onPress={() => setDiagnostics(false)} />
        <PianoMidiMonitor />
      </div> : <>
        <div className="piano-settings__everyday">
          <SettingsTile icon="music" label="Play test note" disabled={!outputUp} onPress={playTestNote} message={messageFor('test-note')} tone={toneFor('test-note')} />
          <SettingsTile icon="stop" label="Stop stuck notes" onPress={stopStuckNotes} message={messageFor('stop-stuck-notes')} tone={toneFor('stop-stuck-notes')} />
          <SettingsTile icon="system-shutdown" label={screenArmed ? 'Tap again to confirm' : 'Turn off display'} emphasis="danger" on={screenArmed} onPress={screenOff} message={messageFor('screen-off')} tone={toneFor('screen-off')} />
          <SettingsTile icon="settings" label="Diagnostics" onPress={() => setDiagnostics(true)} />
          <SettingsTile icon="record" label="Record feedback" onPress={() => setFeedbackOpen(true)} />
        </div>
        <div className="piano-settings__danger" role="group" aria-label="Recovery">
          <p>Recovery — these interrupt whatever is playing.</p>
          <SettingsTile icon="system-reboot" label={reloadArmed ? 'Tap again to restart piano app' : 'Restart piano app'} emphasis="danger" on={reloadArmed} onPress={reload} message={messageFor('restart-app')} tone={toneFor('restart-app')} />
          {deviceId && <SettingsTile icon="system-shutdown" label={rebootArmed ? 'Tap again to reboot tablet' : 'Reboot tablet'} emphasis="danger" on={rebootArmed} onPress={reboot} message={messageFor('reboot-tablet')} tone={toneFor('reboot-tablet')} />}
        </div>
      </>}
    </div>
    <FeedbackOverlay open={feedbackOpen} app="piano" context={{ pianoId, surface: 'piano-maintenance' }} onClose={() => setFeedbackOpen(false)} />
  </TransportSheet>;
}
