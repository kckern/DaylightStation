import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoVoiceBridge } from '../../usePianoVoiceBridge.js';
import { resolveInstrumentSpec } from '../../instrumentSpec.js';
import { noteToAction, NAV_KEYS, entriesFor, moveSelection } from './instrumentsKeyMap.js';
import './Instruments.scss';

const ONBOARD = '__onboard__';
const NOTE_NAMES = { 36: 'C2', 38: 'D2', 40: 'E2', 41: 'F2' };

/** Map a bridge link state to a status-dot modifier class. */
function linkDotClass(link) {
  if (link === 'connected') return 'is-connected';
  if (link === 'reconnecting') return 'is-reconnecting';
  return 'is-idle'; // closed | idle
}

/**
 * Instruments mode — a control surface for switching & tuning rendered voices.
 * Selection and activation can be driven from the screen OR from the four lowest
 * piano keys (C2/D2/E2/F2 → prev/next/select/panic); all other keys play the
 * loaded instrument. Onboard is always the first entry (engine off, local MIDI on).
 */
export function Instruments() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-instruments' }), []);
  const { config, pianoId } = usePianoKioskConfig();
  const { subscribe, sendLocalControl } = usePianoMidi();

  const instruments = useMemo(() => config.instruments || [], [config.instruments]);
  const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });
  const entries = useMemo(() => entriesFor(instruments), [instruments]);

  const [selected, setSelected] = useState(0);
  const [activeId, setActiveId] = useState(ONBOARD);

  const activeInstrument = activeId === ONBOARD
    ? null
    : instruments.find((i) => i.id === activeId) || null;

  // Local slider state for the active instrument's params (seeded from config).
  const [gainDb, setGainDb] = useState(0);
  const [reverbMix, setReverbMix] = useState(0);

  // Refs keep the MIDI subscription handler free of stale closures: the effect
  // runs once but always reads current selection/entries/handlers via refs.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const activate = useCallback((index) => {
    const entry = entriesRef.current[index];
    if (!entry) return;
    if (entry.id === ONBOARD) {
      bridge.stop();
      sendLocalControl(true);
    } else {
      bridge.loadPreset(resolveInstrumentSpec(entry));
      sendLocalControl(false);
      setGainDb(entry.gain_db ?? 0);
      setReverbMix(entry.reverb?.mix ?? 0);
    }
    setActiveId(entry.id);
    logger.info('piano.instruments.activate', {
      pianoId,
      id: entry.id,
      engine: entry.engine ?? null,
      link: bridge.status?.link,
    });
  }, [bridge, sendLocalControl, logger, pianoId]);

  const doAction = useCallback((action) => {
    if (action === 'prev' || action === 'next') {
      const from = selectedRef.current;
      const to = moveSelection(from, action, entriesRef.current.length);
      setSelected(to);
      logger.info('piano.instruments.nav', { action, from, to });
    } else if (action === 'activate') {
      activate(selectedRef.current);
    } else if (action === 'panic') {
      bridge.panic();
      logger.info('piano.instruments.panic', {});
    }
  }, [activate, bridge, logger]);

  // Subscribe to the live MIDI stream once; nav notes drive the surface, others play.
  useEffect(() => {
    logger.info('piano.instruments.mounted', { instruments: entriesRef.current.length });
    const unsub = subscribe((evt) => {
      if (evt.type !== 'note_on') return;
      const action = noteToAction(evt.note);
      logger.debug('piano.instruments.keynav', { note: evt.note, action });
      if (action) doAction(action);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
      logger.info('piano.instruments.unmounted', {});
    };
  }, [subscribe, doAction, logger]);

  const onSelectEntry = (index) => {
    setSelected(index);
    activate(index);
  };

  const onGain = (value) => {
    setGainDb(value);
    bridge.setParam('gain_db', value);
    logger.info('piano.instruments.param', { path: 'gain_db', value });
  };
  const onReverb = (value) => {
    setReverbMix(value);
    bridge.setParam('reverb.mix', value);
    logger.info('piano.instruments.param', { path: 'reverb.mix', value });
  };

  const activeEntry = entries.find((e) => e.id === activeId) || entries[0];
  const link = bridge.status?.link ?? 'idle';

  return (
    <section className="piano-mode piano-mode--instruments">
      <h2>Instruments</h2>

      <div className="piano-instruments__transport">
        <span className={`piano-instruments__dot ${linkDotClass(link)}`} aria-hidden />
        <span className="piano-instruments__link">{link}</span>
        <span className="piano-instruments__engine">{bridge.status?.engine ?? 'stopped'}</span>
        <span className="piano-instruments__active">{activeEntry?.name}</span>
      </div>

      {instruments.length === 0 && (
        <p className="piano-mode__placeholder">
          No rendered instruments configured yet. Add them in piano config; pushing
          samples to the device is a separate step.
        </p>
      )}

      <ul className="piano-instruments__list">
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              className={
                'piano-instruments__entry'
                + (index === selected ? ' is-selected' : '')
                + (entry.id === activeId ? ' is-active' : '')
              }
              aria-pressed={entry.id === activeId}
              onClick={() => onSelectEntry(index)}
            >
              <span className="piano-instruments__name">{entry.name}</span>
              {entry.engine && (
                <span className="piano-instruments__badge">{entry.engine}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {activeInstrument && (
        <div className="piano-instruments__params">
          <label className="piano-instruments__param">
            <span>Gain (dB)</span>
            <input
              type="range"
              min={-24}
              max={6}
              step={1}
              value={gainDb}
              onChange={(e) => onGain(Number(e.target.value))}
            />
            <span className="piano-instruments__param-val">{gainDb}</span>
          </label>
          {activeInstrument.reverb && (
            <label className="piano-instruments__param">
              <span>Reverb</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={reverbMix}
                onChange={(e) => onReverb(Number(e.target.value))}
              />
              <span className="piano-instruments__param-val">{reverbMix}</span>
            </label>
          )}
        </div>
      )}

      <div className="piano-instruments__keys">
        {NAV_KEYS.map((k) => (
          <button
            key={k.note}
            type="button"
            className="piano-instruments__key"
            onClick={() => doAction(k.action)}
          >
            <span className="piano-instruments__key-label">{k.label}</span>
            <span className="piano-instruments__key-note">{NOTE_NAMES[k.note]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default Instruments;
