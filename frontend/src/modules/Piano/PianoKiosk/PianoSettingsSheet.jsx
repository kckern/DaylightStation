import { useEffect, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoSound } from './PianoSoundContext.jsx';
import PianoMidiMonitor from './PianoMidiMonitor.jsx';
import PianoKeyboardPanel from './PianoKeyboardPanel.jsx';
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
  const { sources, activeId, active, select, gainDb, reverbMix, setGain, setReverb, hasInstruments, bridgeLink, device } = usePianoSound();

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
          </div>
        </section>

        {/* ── MIDI monitor ── */}
        <section className="piano-settings__section piano-settings__section--grow">
          <h3 className="piano-settings__eyebrow">MIDI monitor</h3>
          <PianoMidiMonitor />
        </section>

        {/* ── App ── */}
        <footer className="piano-settings__foot">
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
