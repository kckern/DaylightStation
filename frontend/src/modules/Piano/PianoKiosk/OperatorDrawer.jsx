import { useCallback, useEffect, useMemo, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { useScreenControl, screenOffFailureMessage } from './useScreenControl.js';
import { useArmedAction } from '../../../lib/identity/useArmedAction.js';
import { launchAndroidTarget } from '../../../lib/fkb.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import PianoMidiMonitor from './PianoMidiMonitor.jsx';
import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';
import Icon from './icons/Icon.jsx';

const HW_STATE = {
  connected: { cls: 'is-on', label: 'Connected' },
  requesting: { cls: 'is-warn', label: 'Connecting…' },
  idle: { cls: 'is-warn', label: 'Connecting…' },
  'no-input': { cls: 'is-off', label: 'No piano found' },
  denied: { cls: 'is-off', label: 'Access blocked' },
  unsupported: { cls: 'is-off', label: 'Not supported' },
};

/**
 * Operator Drawer — the maintenance console, reached by long-pressing the
 * chrome sound chip (design §7/§8). Everything destructive or operator-only
 * that used to live in the three-tab Settings sheet lives here now, off the
 * player-facing Sound Panel entirely: Hardware (connect/Bluetooth),
 * Diagnostics (live MIDI monitor + PC/Local/Panic test outputs), Display
 * (maintenance screen-off), Recovery (explicitly RANKED — resolves audit
 * T8, which flagged the old sheet's unranked recovery hammers), and Feedback
 * (audit T6 — moved off the player surface).
 */
export default function OperatorDrawer({ open, onClose }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-operator-drawer' }), []);
  const { connected, inputName, status, connect, outputConnected, outputName, resetLink, sendNote, sendNoteOff } = usePianoMidi();
  const { currentBundle, applyBundle } = usePianoSoundBundle();
  const { config, pianoId } = usePianoKioskConfig();
  const { turnOffScreen } = useScreenControl();
  const bluetooth = config?.bluetooth || null;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Transient failure note surfaced when turnOffScreen() reports no-path/reject,
  // so a dead-looking button isn't silent to the operator.
  const [screenError, setScreenError] = useState(null);

  // 2-tap confirm for screen-off — avoids an accidental mid-play blackout on a
  // touch kiosk. First tap arms; a second tap within 3s fires; else it disarms.
  const { armed: screenArmed, trigger: triggerScreenOff } = useArmedAction(async () => {
    logger.info('piano.operator.screen-off', {});
    const res = await turnOffScreen();
    setScreenError(res?.ok === false ? screenOffFailureMessage(res) : null);
  }, { armMs: 3000 });

  // Auto-clear the failure note after a few seconds.
  useEffect(() => {
    if (!screenError) return undefined;
    const t = setTimeout(() => setScreenError(null), 4000);
    return () => clearTimeout(t);
  }, [screenError]);

  // Restart the audio subsystem in one action: reconnect MIDI, then re-assert
  // the FULL sound bundle (voice + reverb + chorus + volume) onto the
  // hardware/voice-bridge via applyBundle — recovers a wedged piano (silent
  // notes, dropped BLE, lost volume) without the heavier full-app reload below.
  const restartAudio = useCallback(async () => {
    logger.info('piano.operator.restart-audio', {});
    try { await connect(); } catch (err) { logger.warn('piano.operator.restart-audio.midi-failed', { error: err?.message }); }
    applyBundle(currentBundle);
  }, [connect, applyBundle, currentBundle, logger]);

  // Reboot the whole tablet (2-tap armed — the most disruptive recovery, ~2-3min
  // down). Backend does it over ADB. Only offered when we know the device id.
  const deviceId = config?.screensaver?.deviceId || null;
  const { armed: rebootArmed, trigger: triggerReboot } = useArmedAction(() => {
    if (!deviceId) return;
    logger.info('piano.operator.reboot', { deviceId });
    DaylightAPI(`api/v1/device/${deviceId}/reboot`, {}, 'POST').catch(() => {});
  }, { armMs: 3000 });

  // Validate the OUT link audibly: play middle C for ~0.5s. If the piano sounds,
  // the tablet→piano MIDI OUT is live; silence means the link is down.
  const testTone = useCallback(() => {
    logger.info('piano.operator.midi-test', { outputConnected });
    sendNote(60, 100);
    setTimeout(() => sendNoteOff(60), 500);
  }, [sendNote, sendNoteOff, outputConnected, logger]);

  const resetMidiLink = useCallback(() => {
    logger.info('piano.operator.reset-link', { outputConnected });
    resetLink();
  }, [resetLink, outputConnected, logger]);

  useEffect(() => { if (open) logger.info('piano.operator.open', {}); }, [open, logger]);

  if (!open) return null;
  const hw = HW_STATE[status] || HW_STATE.idle;

  return (
    <div className="piano-operator-drawer" role="dialog" aria-label="Operator" aria-modal="true">
      <div className="piano-operator-drawer__scrim" onClick={onClose} />
      <aside className="piano-operator-drawer__sheet">
        <header className="piano-operator-drawer__head">
          <h2>Operator</h2>
          <button type="button" className="piano-operator-drawer__close" onClick={onClose} aria-label="Close operator drawer"><Icon name="close" /></button>
        </header>

        {/* ── Hardware ── */}
        <section className="piano-operator-drawer__section">
          <h3 className="piano-operator-drawer__eyebrow">Hardware</h3>
          <div className="piano-operator-drawer__hw">
            <span className={`piano-operator-drawer__hwdot ${hw.cls}`} aria-hidden />
            <span className="piano-operator-drawer__hwlabel">{hw.label}</span>
            <span className="piano-operator-drawer__hwname">{connected ? (inputName || 'Piano') : ''}</span>
            {!connected && status !== 'unsupported' && (
              <button type="button" className="piano-operator-drawer__connect" onClick={connect}>Connect</button>
            )}
            {bluetooth && (
              <button
                type="button"
                className="piano-operator-drawer__connect piano-operator-drawer__connect--ghost"
                onClick={() => { logger.info('piano.operator.bluetooth', {}); launchAndroidTarget(bluetooth); }}
              >
                Bluetooth settings
              </button>
            )}
          </div>
          {/* MIDI OUT link — the tablet→piano direction. On BLE the output can
              enumerate late / drop while the input stays up, so it's shown and
              recoverable separately: red here = on-screen changes won't reach the
              piano. Reset re-scans the link; Test tone validates it audibly. */}
          <div className="piano-operator-drawer__hw piano-operator-drawer__midiout">
            <span className={`piano-operator-drawer__hwdot ${outputConnected ? 'is-on' : 'is-off'}`} aria-hidden />
            <span className="piano-operator-drawer__hwlabel">MIDI out</span>
            <span className="piano-operator-drawer__hwname">
              {outputConnected ? (outputName || 'linked') : 'not linked — changes won’t reach the piano'}
            </span>
            <button type="button" className="piano-operator-drawer__connect piano-operator-drawer__connect--ghost" onClick={resetMidiLink}>Reset link</button>
            <button type="button" className="piano-operator-drawer__connect piano-operator-drawer__connect--ghost" onClick={testTone}>Test tone</button>
          </div>
        </section>

        {/* ── Diagnostics: live MIDI monitor + test outputs (PC / Local / Panic) ── */}
        <section className="piano-operator-drawer__section piano-operator-drawer__section--grow">
          <h3 className="piano-operator-drawer__eyebrow">Diagnostics</h3>
          <PianoMidiMonitor />
        </section>

        {/* ── Display (manual screen-off — maintenance / burn-in kill switch) ── */}
        <section className="piano-operator-drawer__section">
          <h3 className="piano-operator-drawer__eyebrow">Display</h3>
          <button
            type="button"
            className={`piano-operator-drawer__screen-off${screenArmed ? ' is-armed' : ''}`}
            aria-live="polite"
            onClick={triggerScreenOff}
          >
            {screenArmed ? 'Tap again to confirm' : 'Turn off screen'}
          </button>
          {screenError && (
            <p className="piano-operator-drawer__screen-error" role="status" aria-live="polite">{screenError}</p>
          )}
        </section>

        {/* ── Recovery — RANKED (audit T8): restart-audio first ("try this
             first"), reload de-emphasized as the nuclear option. ── */}
        <section className="piano-operator-drawer__section piano-operator-drawer__recovery">
          <h3 className="piano-operator-drawer__eyebrow">Recovery</h3>
          <button type="button" className="piano-operator-drawer__restart" onClick={restartAudio}>
            <Icon name="repeat" />
            <span>Restart audio &amp; MIDI</span>
            <span className="piano-operator-drawer__hint">Try this first</span>
          </button>
          <button
            type="button"
            className="piano-operator-drawer__reload"
            onClick={() => { logger.info('piano.operator.reload', {}); window.location.reload(); }}
          >
            Reload app
          </button>
          {deviceId && (
            <button
              type="button"
              className={`piano-operator-drawer__reload${rebootArmed ? ' is-armed' : ''}`}
              aria-live="polite"
              onClick={triggerReboot}
            >
              <Icon name="system-reboot" /> {rebootArmed ? 'Tap again to reboot device' : 'Reboot device'}
            </button>
          )}
        </section>

        {/* ── Feedback (audit T6 — off the player surface) ── */}
        <section className="piano-operator-drawer__section">
          <h3 className="piano-operator-drawer__eyebrow">Feedback</h3>
          <button type="button" className="piano-operator-drawer__feedback-open" onClick={() => setFeedbackOpen(true)}>
            Record feedback
          </button>
          <FeedbackOverlay
            open={feedbackOpen}
            app="piano"
            context={{ pianoId, surface: 'operator-drawer' }}
            onClose={() => setFeedbackOpen(false)}
          />
        </section>
      </aside>
    </div>
  );
}
