import { useCallback, useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoConnection } from './usePianoConnection.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoScreenOff } from './usePianoScreenOff.js';
import { screenOffFailureMessage } from './useScreenControl.js';
import { useArmedAction } from '../../../../../frontend/src/lib/identity/useArmedAction.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import BluetoothPanel from './BluetoothPanel.jsx';
import PianoMidiMonitor from './PianoMidiMonitor.jsx';
import ClickCalibration from './ClickCalibration.jsx';
import TransportSheet from './transport/TransportSheet.jsx';
import TransportButton from './transport/TransportButton.jsx';
import SettingsTile from './SettingsTile.jsx';
import FeedbackOverlay from '../../../../../frontend/src/modules/Feedback/FeedbackOverlay.jsx';
import './SettingsSheets.scss';

// Bridge link → dot tone + words. One place, so the card and the chip agree.
// `state` is usePianoBridgeNotes' link: idle | connecting | connected | reconnecting | closed.
const bridgeRow = (bridge) => {
  if (bridge.unavailable) return { tone: 'off', text: 'not running' };
  if (bridge.state === 'connected') return { tone: 'on', text: 'connected' };
  if (bridge.state === 'reconnecting') return { tone: 'warn', text: 'reconnecting…' };
  if (bridge.state === 'idle' || bridge.state === 'connecting') return { tone: 'warn', text: 'connecting…' };
  return { tone: 'off', text: 'not connected' };
};

// The colon is kept for screen readers and copy-paste ("Keys: connected") but
// the card shows label and value as two columns.
function StatusRow({ label, tone, text }) {
  return <div className="piano-settings__statusrow">
    <span className={`piano-settings__dot is-${tone}`} aria-hidden />
    <span className="piano-settings__statuslabel">{label}<span className="piano-settings__vh">:</span></span>{' '}
    <span className="piano-settings__statusvalue">{text}</span>
  </div>;
}

// Diagnostics has no chrome of its own, so the drawer frames it.
function DiagnosticsTool({ onBack }) {
  return <div className="piano-settings__diag">
    <div className="piano-settings__toolhead">
      <TransportButton icon="back" label="Back" onPress={onBack} />
      <strong>Diagnostics</strong>
      <span className="piano-settings__note">Live messages from the keys, newest first.</span>
    </div>
    <PianoMidiMonitor />
  </div>;
}

/**
 * Maintenance tools: each opens a full-body view in place of the drawer's
 * front page, and each view gets `onBack`. Adding a tool is one entry here.
 * `event` is the log line written when the tool opens. `primaryWhenDown`
 * promotes the tile while the piano is not ready (pairing is often the fix).
 */
const TOOLS = Object.freeze([
  { id: 'bluetooth', icon: 'bluetooth-active', label: 'Bluetooth pairing', hint: 'Pair the piano, speakers, headphones', event: 'piano.maintenance.bluetooth', primaryWhenDown: true, render: ({ onBack }) => <BluetoothPanel onBack={onBack} /> },
  { id: 'diagnostics', icon: 'diagnostics', label: 'Diagnostics', hint: 'See what the keys are sending', event: 'piano.maintenance.diagnostics', render: ({ onBack }) => <DiagnosticsTool onBack={onBack} /> },
  { id: 'click-timing', icon: 'metronome', label: 'Click timing', hint: 'Line the metronome up with your ears', event: 'piano.maintenance.click-timing', render: ({ onBack }) => <ClickCalibration onBack={onBack} /> },
  // Patch finder lands from feature/piano-patch-finder as one entry:
  // { id: 'patch-finder', icon: 'patch-finder', label: 'Patch finder', hint: 'Find the MIDI address for each instrument', event: 'piano.maintenance.patch-finder', render: ({ onBack }) => <PatchFinder onBack={onBack} /> },
]);

export default function OperatorDrawer({ open, onClose }) {
  const midi = usePianoMidi();
  const { health, repair, repairConnection } = usePianoConnection();
  const { config, pianoId } = usePianoKioskConfig();
  const turnOffPianoScreen = usePianoScreenOff();
  const logger = useMemo(() => getLogger().child({ component: 'piano-maintenance', pianoId }), [pianoId]);
  // The open tool's id, or null for the front page.
  const [tool, setTool] = useState(null);
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

  const openTool = useCallback((entry) => {
    logger.info(entry.event, {});
    setTool(entry.id);
  }, [logger]);
  const closeTool = useCallback(() => setTool(null), []);

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

  const { armed: screenArmed, trigger: screenOff, reset: disarmScreen } = useArmedAction(async () => {
    report('screen-off', 'working', 'Turning off display…');
    const result = await turnOffPianoScreen();
    report('screen-off', result?.ok ? 'success' : 'failed', result?.ok ? 'Display turned off.' : screenOffFailureMessage(result), result);
  }, { armMs: 3000 });

  const { armed: reloadArmed, trigger: reload, reset: disarmReload } = useArmedAction(() => {
    report('restart-app', 'working', 'Restarting piano app…');
    window.location.reload();
  }, { armMs: 3000 });

  const deviceId = config?.screensaver?.deviceId || null;
  const { armed: rebootArmed, trigger: reboot, reset: disarmReboot } = useArmedAction(async () => {
    report('reboot-tablet', 'working', 'Requesting tablet reboot…');
    try {
      const result = await DaylightAPI(`api/v1/device/${deviceId}/reboot`, {}, 'POST');
      if (result?.ok === false) throw new Error(result.error || 'request rejected');
      report('reboot-tablet', 'success', 'Tablet reboot requested.');
    } catch (error) {
      report('reboot-tablet', 'failed', `Couldn’t reboot tablet: ${error?.message || 'request failed'}`);
    }
  }, { armMs: 3000 });

  // PianoChrome keeps the drawer mounted and TransportSheet only hides it, so
  // an armed tile, an open tool or a stale result line would otherwise greet
  // the next open. Closing forgets all of it.
  useEffect(() => {
    if (open) return;
    disarmScreen(); disarmReload(); disarmReboot();
    setTool(null);
    setFeedbackOpen(false);
    setAction({ state: 'idle', message: null, name: null });
  }, [open, disarmScreen, disarmReload, disarmReboot]);

  const ready = health.state === 'ready';
  const inputUp = health.input.state !== 'down';
  const outputUp = health.output.state === 'up';
  const bridge = bridgeRow(health.bridge || {});
  const repairing = repair.state === 'working';
  const activeTool = open ? TOOLS.find((entry) => entry.id === tool) : null;

  return <TransportSheet open={open} title="Piano maintenance" onClose={onClose} size="canvas" className="piano-maintenance-sheet">
    {activeTool ? <div className="piano-settings__tool">{activeTool.render({ onBack: closeTool })}</div> : <div className="piano-settings__maint">
      {/* Left: is the piano working, and the two ways to say it is not. */}
      <div className="piano-settings__health">
        <section className={`piano-settings__healthcard is-${ready ? 'ready' : 'down'}`}>
          <div className="piano-settings__status" role="group" aria-label="Connection">
            <strong className="piano-settings__headline"><span className={`piano-settings__lamp piano-settings__lamp--${ready ? 'ready' : 'down'}`} aria-hidden />{health.copy ? `Piano ${health.copy}` : 'Piano'}</strong>
            <StatusRow label="Keys" tone={inputUp ? 'on' : 'off'} text={inputUp ? (health.input.name || 'connected') : 'not connected'} />
            <StatusRow label="Sound" tone={outputUp ? 'on' : 'off'} text={outputUp ? (health.output.name || 'connected') : 'not connected'} />
            <StatusRow label="Bridge" tone={bridge.tone} text={bridge.text} />
          </div>
          <p className="piano-settings__advice">{ready ? 'Keys, sound and bridge are all connected.' : 'Try Repair connection first. Still nothing? Open Bluetooth pairing.'}</p>
          <SettingsTile layout="row" icon="repair" label="Repair connection" hint="Reconnect keys, sound and bridge" className="piano-settings__repair" emphasis={ready ? 'default' : 'primary'} disabled={repairing} onPress={repairConnection} message={repairing ? 'Repairing…' : repair.message} tone={repairing ? 'working' : repair.state === 'failed' ? 'failed' : repair.state === 'success' ? 'success' : 'idle'} />
        </section>
        <SettingsTile layout="row" icon="feedback" label="Record feedback" hint="Tell us what went wrong" className="piano-settings__feedback" onPress={() => setFeedbackOpen(true)} />
      </div>

      {/* Right: things to try now, then tools that open their own view. */}
      <div className="piano-settings__work">
        <section className="piano-settings__group" aria-labelledby="piano-maint-checks">
          <p id="piano-maint-checks" className="piano-settings__grouptitle">Check the sound</p>
          <div className="piano-settings__checks">
            <SettingsTile icon="music" label="Play test note" disabled={!outputUp} onPress={playTestNote} message={messageFor('test-note')} tone={toneFor('test-note')} />
            <SettingsTile icon="notes-off" label="Stop stuck notes" onPress={stopStuckNotes} message={messageFor('stop-stuck-notes')} tone={toneFor('stop-stuck-notes')} />
          </div>
        </section>
        <section className="piano-settings__group piano-settings__group--tools" aria-labelledby="piano-maint-tools">
          <p id="piano-maint-tools" className="piano-settings__grouptitle">Tools</p>
          <div className="piano-settings__tools" style={{ '--tool-cols': TOOLS.length > 3 ? 2 : 1 }}>
            {TOOLS.map((entry) => <SettingsTile key={entry.id} layout="row" icon={entry.icon} label={entry.label} hint={entry.hint} trailing="chevron-right" emphasis={entry.primaryWhenDown && !ready ? 'primary' : 'default'} onPress={() => openTool(entry)} />)}
          </div>
        </section>
      </div>

      {/* Bottom: everything that blanks the screen or stops the music. Two taps each. */}
      <div className="piano-settings__power">
        <SettingsTile layout="row" icon="display-off" label={screenArmed ? 'Tap again to confirm' : 'Turn off display'} emphasis="danger" on={screenArmed} onPress={screenOff} message={messageFor('screen-off')} tone={toneFor('screen-off')} />
        <div className="piano-settings__danger" role="group" aria-label="Recovery">
          <p>Stops whatever is playing</p>
          <SettingsTile layout="row" icon="restart" label={reloadArmed ? 'Tap again to restart piano app' : 'Restart piano app'} emphasis="danger" on={reloadArmed} onPress={reload} message={messageFor('restart-app')} tone={toneFor('restart-app')} />
          {deviceId && <SettingsTile layout="row" icon="system-reboot" label={rebootArmed ? 'Tap again to reboot tablet' : 'Reboot tablet'} emphasis="danger" on={rebootArmed} onPress={reboot} message={messageFor('reboot-tablet')} tone={toneFor('reboot-tablet')} />}
        </div>
      </div>
    </div>}
    <FeedbackOverlay open={feedbackOpen} app="piano" context={{ pianoId, surface: 'piano-maintenance' }} onClose={() => setFeedbackOpen(false)} />
  </TransportSheet>;
}
