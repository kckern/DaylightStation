import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { decodeMidi } from './midiDecode.js';

const MAX_ROWS = 60; // rolling window of recent messages

/**
 * Read-only raw-MIDI monitor. Maintenance owns the small set of safe output
 * actions separately; raw Program Change and Local controls are intentionally absent.
 */
export default function PianoMidiMonitor() {
  const { connected, subscribeRaw } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-midi-monitor' }), []);
  const [rows, setRows] = useState([]);
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

  return (
    <div className="piano-midimon">
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
