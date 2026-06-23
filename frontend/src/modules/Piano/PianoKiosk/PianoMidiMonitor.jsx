import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { decodeMidi } from './midiDecode.js';

const MAX_ROWS = 60; // rolling window of recent messages

/**
 * Live raw-MIDI monitor + fireable outputs — the debug surface of the Settings
 * sheet. Subscribes to the shared MIDI input's raw-message tap and shows a capped
 * rolling list (note/CC/PC/…); the buttons send test output back to the piano.
 */
export default function PianoMidiMonitor() {
  const { connected, subscribeRaw, sendProgramChange, sendLocalControl, sendPanic } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-midi-monitor' }), []);
  const [rows, setRows] = useState([]);
  const [program, setProgram] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    logger.info('piano.midi-monitor.mounted', { connected });
    const off = subscribeRaw(({ data, time }) => {
      const decoded = decodeMidi(data);
      setRows((prev) => {
        const next = [{ id: seq.current++, time, ...decoded }, ...prev];
        return next.length > MAX_ROWS ? next.slice(0, MAX_ROWS) : next;
      });
    });
    return () => { off(); logger.info('piano.midi-monitor.unmounted', {}); };
  }, [subscribeRaw, logger, connected]);

  const fire = (label, fn) => {
    const ok = fn();
    logger.info('piano.midi-monitor.fire', { action: label, sent: ok });
  };

  return (
    <div className="piano-midimon">
      <div className="piano-midimon__outs">
        <div className="piano-midimon__pc">
          <button type="button" className="piano-midimon__btn" onClick={() => setProgram((p) => Math.max(0, p - 1))} aria-label="Program down">−</button>
          <span className="piano-midimon__pcval">PC {program}</span>
          <button type="button" className="piano-midimon__btn" onClick={() => setProgram((p) => Math.min(127, p + 1))} aria-label="Program up">+</button>
          <button type="button" className="piano-midimon__btn piano-midimon__btn--go" onClick={() => fire('program', () => sendProgramChange(program))}>Send</button>
        </div>
        <button type="button" className="piano-midimon__btn" onClick={() => fire('local-on', () => sendLocalControl(true))}>Local On</button>
        <button type="button" className="piano-midimon__btn" onClick={() => fire('local-off', () => sendLocalControl(false))}>Local Off</button>
        <button type="button" className="piano-midimon__btn piano-midimon__btn--warn" onClick={() => fire('panic', () => sendPanic())}>Panic</button>
      </div>

      <div className="piano-midimon__log" role="log" aria-label="MIDI input">
        {rows.length === 0 && (
          <p className="piano-midimon__empty">
            {connected ? 'Waiting for MIDI… play a key.' : 'No piano connected.'}
          </p>
        )}
        {rows.map((r) => (
          <div key={r.id} className={`piano-midimon__row piano-midimon__row--${r.kind}`}>
            {r.channel != null && <span className="piano-midimon__ch">ch{r.channel}</span>}
            <span className="piano-midimon__label">{r.label}</span>
            <span className="piano-midimon__detail">{r.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
