import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoVoiceBridge } from '../../usePianoVoiceBridge.js';
import { resolveInstrumentSpec } from '../../instrumentSpec.js';
import { entriesFor } from './instrumentsKeyMap.js';
import { isWhiteKey } from '../../../noteUtils.js';
import './Instruments.scss';

const ONBOARD = '__onboard__';

// Live-ribbon range: C2–C6, the practical playing register for a kiosk strip.
const KB_LOW = 36;
const KB_HIGH = 84;

/** Short engine tag for a voice card. */
function engineTag(engine) {
  if (engine === 'sfizz') return 'SFZ';
  if (engine === 'dexed') return 'FM';
  return 'Built-in';
}

/** One-line description of what a voice is. */
function voiceDesc(entry) {
  if (entry.id === ONBOARD) return "The piano's built-in sound";
  if (entry.engine === 'sfizz') return 'Sampled instrument';
  if (entry.engine === 'dexed') return 'FM synthesizer';
  return 'Rendered voice';
}

/** Map a bridge link state to { dot-class, label }. */
function linkState(link) {
  if (link === 'connected') return { cls: 'is-on', label: 'Ready' };
  if (link === 'reconnecting') return { cls: 'is-warn', label: 'Reconnecting' };
  return { cls: 'is-off', label: 'Offline' };
}

/**
 * Instruments — pick the voice the piano plays, and tune it. Onboard (the piano's
 * own sound) is always first; rendered voices come from config + the piano-bridge
 * APK. Tapping a card activates it; the active rendered voice exposes gain/reverb.
 * The bottom ribbon mirrors the live keyboard so you can see the active voice
 * respond as you play.
 */
export function Instruments() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-instruments' }), []);
  const { config, pianoId } = usePianoKioskConfig();
  const { activeNotes, sendLocalControl } = usePianoMidi();

  const instruments = useMemo(() => config.instruments || [], [config.instruments]);
  const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });
  const entries = useMemo(() => entriesFor(instruments), [instruments]);

  const [activeId, setActiveId] = useState(ONBOARD);
  const [gainDb, setGainDb] = useState(0);
  const [reverbMix, setReverbMix] = useState(0);

  const activeInstrument = instruments.find((i) => i.id === activeId) || null;

  useEffect(() => {
    logger.info('piano.instruments.mounted', { voices: entries.length });
    return () => logger.info('piano.instruments.unmounted', {});
  }, [logger, entries.length]);

  const activate = (entry) => {
    if (entry.id === ONBOARD) {
      const stopped = bridge.stop();
      const restored = sendLocalControl(true);
      logger.info('piano.instruments.activate', { pianoId, id: entry.id, engine: null, stopped, restored });
    } else {
      const loaded = bridge.loadPreset(resolveInstrumentSpec(entry));
      const muted = sendLocalControl(false);
      setGainDb(entry.gain_db ?? 0);
      setReverbMix(entry.reverb?.mix ?? 0);
      logger.info('piano.instruments.activate', { pianoId, id: entry.id, engine: entry.engine, loaded, muted, link: bridge.status?.link });
    }
    setActiveId(entry.id);
  };

  const onGain = (value) => {
    setGainDb(value);
    bridge.setParam('gain_db', value);
    logger.debug('piano.instruments.param', { path: 'gain_db', value });
  };
  const onReverb = (value) => {
    setReverbMix(value);
    bridge.setParam('reverb.mix', value);
    logger.debug('piano.instruments.param', { path: 'reverb.mix', value });
  };

  const playing = activeNotes.size > 0;
  const status = linkState(bridge.status?.link);

  return (
    <section className="piano-instruments">
      <header className="piano-instruments__head">
        <span className="piano-instruments__eyebrow">Voice</span>
        {instruments.length > 0 && (
          <span className={`piano-instruments__status ${status.cls}`}>
            <span className="piano-instruments__status-dot" aria-hidden />
            {status.label}
          </span>
        )}
      </header>

      <ul className="piano-instruments__rack">
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={`piano-voice${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => activate(entry)}
              >
                <span className="piano-voice__tag">{engineTag(entry.engine)}</span>
                <span className="piano-voice__name">{entry.name}</span>
                <span className="piano-voice__desc">{voiceDesc(entry)}</span>
                <span className="piano-voice__state">
                  {active ? (
                    <span className={`piano-voice__playing${playing ? ' is-live' : ''}`}>
                      <span className="piano-voice__pulse" aria-hidden />
                      {playing ? 'Playing' : 'Active'}
                    </span>
                  ) : (
                    <span className="piano-voice__hint">Tap to play</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {instruments.length === 0 && (
        <p className="piano-instruments__empty">
          Only the onboard voice is here for now. Rendered instruments appear once
          they're configured and their samples are on the device.
        </p>
      )}

      {activeInstrument && (
        <div className="piano-instruments__controls">
          <span className="piano-instruments__controls-label">{activeInstrument.name}</span>
          <label className="piano-knob">
            <span className="piano-knob__name">Gain</span>
            <input type="range" min={-24} max={6} step={1} value={gainDb}
              onChange={(e) => onGain(Number(e.target.value))} />
            <span className="piano-knob__val">{gainDb > 0 ? `+${gainDb}` : gainDb} dB</span>
          </label>
          {activeInstrument.reverb && (
            <label className="piano-knob">
              <span className="piano-knob__name">Reverb</span>
              <input type="range" min={0} max={1} step={0.05} value={reverbMix}
                onChange={(e) => onReverb(Number(e.target.value))} />
              <span className="piano-knob__val">{Math.round(reverbMix * 100)}%</span>
            </label>
          )}
        </div>
      )}

      <div className="piano-instruments__spacer" />

      <LiveKeyboard activeNotes={activeNotes} />
    </section>
  );
}

/** Bottom ribbon: a compact keyboard that glows on the notes currently held. */
function LiveKeyboard({ activeNotes }) {
  const { whites, blacks } = useMemo(() => {
    const w = [];
    const b = [];
    for (let n = KB_LOW; n <= KB_HIGH; n++) (isWhiteKey(n) ? w : b).push(n);
    return { whites: w, blacks: b };
  }, []);
  const unit = 100 / whites.length;
  const whitesBefore = (note) => whites.filter((w) => w < note).length;

  return (
    <div className="piano-ribbon" aria-hidden>
      {whites.map((n, i) => (
        <span
          key={n}
          className={`piano-ribbon__white${activeNotes.has(n) ? ' is-on' : ''}`}
          style={{ left: `${i * unit}%`, width: `${unit}%` }}
        />
      ))}
      {blacks.map((n) => (
        <span
          key={n}
          className={`piano-ribbon__black${activeNotes.has(n) ? ' is-on' : ''}`}
          style={{ left: `${whitesBefore(n) * unit - unit * 0.3}%`, width: `${unit * 0.6}%` }}
        />
      ))}
    </div>
  );
}

export default Instruments;
