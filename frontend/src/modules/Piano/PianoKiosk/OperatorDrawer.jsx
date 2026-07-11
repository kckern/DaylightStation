import { useCallback, useEffect, useMemo, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { useScreenControl, screenOffFailureMessage } from './useScreenControl.js';
import { useArmedAction } from './useArmedAction.js';
import { launchAndroidTarget } from '../../../lib/fkb.js';
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
  const { connected, inputName, status, connect } = usePianoMidi();
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
