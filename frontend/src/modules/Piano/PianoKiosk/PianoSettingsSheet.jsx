import { useCallback, useEffect, useMemo, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoSound } from './PianoSoundContext.jsx';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { useScreenControl, screenOffFailureMessage } from './useScreenControl.js';
import { useArmedAction } from './useArmedAction.js';
import { launchAndroidTarget } from '../../../lib/fkb.js';
import { instrumentEmoji } from './instrumentIcon.js';
import PianoMidiMonitor from './PianoMidiMonitor.jsx';
import PianoKeyboardPanel from './PianoKeyboardPanel.jsx';
import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';
import Icon from './icons/Icon.jsx';

const ENGINE_TAG = { sfizz: 'SFZ', dexed: 'FM' };
const engineTag = (e) => ENGINE_TAG[e] || 'Built-in';

const HW_STATE = {
  connected: { cls: 'is-on', label: 'Connected' },
  requesting: { cls: 'is-warn', label: 'Connecting…' },
  idle: { cls: 'is-warn', label: 'Connecting…' },
  'no-input': { cls: 'is-off', label: 'No piano found' },
  denied: { cls: 'is-off', label: 'Access blocked' },
  unsupported: { cls: 'is-off', label: 'Not supported' },
};

/**
 * Settings sheet — slide-over consolidating Sound (voice/instrument picker, the old
 * Instruments mode), MIDI hardware (connection), and a raw MIDI monitor + outputs.
 * Controlled by the chrome status chip.
 */
export default function PianoSettingsSheet({ open, onClose }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-settings' }), []);
  const { connected, inputName, status, connect } = usePianoMidi();
  const { sources, activeId, active, select, gainDb, reverbMix, setGain, setReverb, hasInstruments, bridgeLink, device, resync } = usePianoSound();
  const { config, pianoId } = usePianoKioskConfig();
  const { turnOffScreen } = useScreenControl();
  const bluetooth = config?.bluetooth || null;
  const [tab, setTab] = useState('sound');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Transient failure note surfaced when turnOffScreen() reports no-path/reject,
  // so a dead-looking button isn't silent to the operator.
  const [screenError, setScreenError] = useState(null);

  // 2-tap confirm for screen-off — avoids an accidental mid-play blackout on a
  // touch kiosk. First tap arms; a second tap within 3s fires; else it disarms.
  const { armed: screenArmed, trigger: triggerScreenOff } = useArmedAction(async () => {
    logger.info('piano.settings.screen-off', {});
    const res = await turnOffScreen();
    setScreenError(res?.ok === false ? screenOffFailureMessage(res) : null);
  }, { armMs: 3000 });

  // Auto-clear the failure note after a few seconds.
  useEffect(() => {
    if (!screenError) return undefined;
    const t = setTimeout(() => setScreenError(null), 4000);
    return () => clearTimeout(t);
  }, [screenError]);

  // Restart the audio subsystem in one action: reconnect MIDI, then re-assert the
  // current voice + effects onto the hardware/voice-bridge. Recovers a wedged
  // piano (silent notes, dropped BLE) without the heavier full-app reload below.
  const restartAudio = useCallback(async () => {
    logger.info('piano.settings.restart-audio', {});
    try { await connect(); } catch (err) { logger.warn('piano.settings.restart-audio.midi-failed', { error: err?.message }); }
    resync();
  }, [connect, resync, logger]);

  useEffect(() => { if (open) logger.info('piano.settings.open', {}); }, [open, logger]);

  if (!open) return null;
  const hw = HW_STATE[status] || HW_STATE.idle;

  return (
    <div className="piano-settings" role="dialog" aria-label="Settings" aria-modal="true">
      <div className="piano-settings__scrim" onClick={onClose} />
      <aside className="piano-settings__sheet">
        <header className="piano-settings__head">
          <h2>Settings</h2>
          <button type="button" className="piano-settings__close" onClick={onClose} aria-label="Close settings"><Icon name="close" /></button>
        </header>

        <nav className="piano-settings__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'sound'} className={`piano-settings__tab${tab === 'sound' ? ' is-active' : ''}`} onClick={() => setTab('sound')}>Sound</button>
          <button type="button" role="tab" aria-selected={tab === 'midi'} className={`piano-settings__tab${tab === 'midi' ? ' is-active' : ''}`} onClick={() => setTab('midi')}>MIDI</button>
          <button type="button" role="tab" aria-selected={tab === 'feedback'} className={`piano-settings__tab${tab === 'feedback' ? ' is-active' : ''}`} onClick={() => setTab('feedback')}>Feedback</button>
        </nav>

        {/* ── Sound tab: onboard keyboard voices + rendered voices ── */}
        {tab === 'sound' && (
        <>
        {/* ── Keyboard (onboard hardware voices + effects, over MIDI) ── */}
        {device && (
          <section className="piano-settings__section">
            <h3 className="piano-settings__eyebrow">Keyboard — {device.name}</h3>
            <PianoKeyboardPanel />
          </section>
        )}

        {/* ── Sound (rendered voice-bridge instruments / simple onboard timbres) ── */}
        {sources.length > 0 && (
        <section className="piano-settings__section">
          <h3 className="piano-settings__eyebrow">{device ? 'Rendered voices' : 'Sound'}{hasInstruments && bridgeLink && <span className={`piano-settings__link piano-settings__link--${bridgeLink}`}>{bridgeLink}</span>}</h3>
          <ul className="piano-settings__voices">
            {sources.map((s) => {
              const on = s.id === activeId;
              return (
                <li key={s.id}>
                  <button type="button" className={`piano-voicecard${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => select(s.id)}>
                    <span className="piano-voicecard__icon" aria-hidden="true">{instrumentEmoji(s.name)}</span>
                    <span className="piano-voicecard__tag">{s.kind === 'onboard' ? 'Onboard' : engineTag(s.inst?.engine)}</span>
                    <span className="piano-voicecard__name">{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {active?.kind === 'instrument' && (
            <div className="piano-settings__knobs">
              <label className="piano-knob">
                <span className="piano-knob__name">Gain</span>
                <input type="range" min={-24} max={6} step={1} value={gainDb} onChange={(e) => setGain(Number(e.target.value))} />
                <span className="piano-knob__val">{gainDb > 0 ? `+${gainDb}` : gainDb} dB</span>
              </label>
              {active.inst?.reverb && (
                <label className="piano-knob">
                  <span className="piano-knob__name">Reverb</span>
                  <input type="range" min={0} max={1} step={0.05} value={reverbMix} onChange={(e) => setReverb(Number(e.target.value))} />
                  <span className="piano-knob__val">{Math.round(reverbMix * 100)}%</span>
                </label>
              )}
            </div>
          )}
        </section>
        )}
        </>
        )}

        {/* ── MIDI tab: hardware + monitor ── */}
        {tab === 'midi' && (
        <>
        {/* ── MIDI hardware ── */}
        <section className="piano-settings__section">
          <h3 className="piano-settings__eyebrow">MIDI hardware</h3>
          <div className="piano-settings__hw">
            <span className={`piano-settings__hwdot ${hw.cls}`} aria-hidden />
            <span className="piano-settings__hwlabel">{hw.label}</span>
            <span className="piano-settings__hwname">{connected ? (inputName || 'Piano') : ''}</span>
            {!connected && status !== 'unsupported' && (
              <button type="button" className="piano-settings__connect" onClick={connect}>Connect</button>
            )}
            {bluetooth && (
              <button
                type="button"
                className="piano-settings__connect piano-settings__connect--ghost"
                onClick={() => { logger.info('piano.settings.bluetooth', {}); launchAndroidTarget(bluetooth); }}
              >
                Bluetooth settings
              </button>
            )}
          </div>
        </section>

        {/* ── Display (manual screen-off — burn-in kill switch) ── */}
        <section className="piano-settings__section">
          <h3 className="piano-settings__eyebrow">Display</h3>
          <button
            type="button"
            className={`piano-settings__screen-off${screenArmed ? ' is-armed' : ''}`}
            aria-live="polite"
            onClick={triggerScreenOff}
          >
            {screenArmed ? 'Tap again to confirm' : 'Turn off screen'}
          </button>
          {screenError && (
            <p className="piano-settings__screen-error" role="status" aria-live="polite">{screenError}</p>
          )}
        </section>

        {/* ── MIDI monitor ── */}
        <section className="piano-settings__section piano-settings__section--grow">
          <h3 className="piano-settings__eyebrow">MIDI monitor</h3>
          <PianoMidiMonitor />
        </section>
        </>
        )}

        {/* ── Feedback tab: voice-record a bug / quirk / idea ── */}
        {tab === 'feedback' && (
          <section className="piano-settings__section piano-settings__section--grow">
            <h3 className="piano-settings__eyebrow">Feedback</h3>
            <button type="button" className="piano-settings__feedback-open" onClick={() => setFeedbackOpen(true)}>
              Record feedback
            </button>
            <FeedbackOverlay
              open={feedbackOpen}
              app="piano"
              context={{ pianoId, surface: 'settings' }}
              onClose={() => setFeedbackOpen(false)}
            />
          </section>
        )}

        {/* ── App ── */}
        <footer className="piano-settings__foot">
          <button
            type="button"
            className="piano-settings__restart"
            onClick={restartAudio}
          >
            <Icon name="repeat" /> Restart audio &amp; MIDI
          </button>
          <button
            type="button"
            className="piano-settings__reload"
            onClick={() => { logger.info('piano.settings.reload', {}); window.location.reload(); }}
          >
            <Icon name="repeat" /> Reload app
          </button>
        </footer>
      </aside>
    </div>
  );
}
