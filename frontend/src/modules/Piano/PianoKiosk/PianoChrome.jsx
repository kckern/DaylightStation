import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';
import { resolveInstrumentSpec } from './instrumentSpec.js';

/** Sentinel source value: the piano's own onboard voice (Program-Change timbres). */
export const ONBOARD = '__onboard__';

/**
 * PianoChrome — always-on bar across every mode: home, piano label (tap to switch
 * pianos), the sound-source selector (onboard vs rendered instrument), the onboard
 * timbre/voice picker (Program Change out), and connection status.
 *
 * @param {Array<{label:string, program:number}>} [voices] - onboard timbre options
 * @param {Array<{id:string, name:string, engine:string, asset:string}>} [instruments] - rendered-voice definitions
 * @param {string} [label] - this piano's display name
 * @param {string} [pianoId] - active piano id (home routes to its menu)
 */
export function PianoChrome({ voices = [], instruments = [], label, pianoId }) {
  const navigate = useNavigate();
  const { connected, inputName, status, sendProgramChange, sendLocalControl, connect } = usePianoMidi();
  const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });
  const [source, setSource] = useState(ONBOARD);
  const logger = useMemo(() => getLogger().child({ component: 'piano-chrome' }), []);

  const onVoice = (program) => {
    const ok = sendProgramChange(program);
    logger.info('piano.voice-change', { program, sent: ok, pianoId });
  };

  const onSource = (value) => {
    if (value === ONBOARD) {
      const stopped = bridge.stop();
      const restored = sendLocalControl(true);
      setSource(ONBOARD);
      logger.info('piano.source.onboard', { pianoId, stopped, restored, link: bridge.status?.link });
      return;
    }
    const inst = instruments.find((i) => i.id === value);
    if (!inst) return;
    const loaded = bridge.loadPreset(resolveInstrumentSpec(inst));
    const muted = sendLocalControl(false);
    setSource(value);
    logger.info('piano.source.instrument', { pianoId, id: inst.id, engine: inst.engine, loaded, muted, link: bridge.status?.link });
  };

  return (
    <header className="piano-chrome">
      <button
        type="button"
        className="piano-chrome__home"
        onClick={() => navigate(`/piano/${pianoId}`)}
        aria-label="Home"
      >
        ⌂
      </button>

      {label && (
        <button
          type="button"
          className="piano-chrome__label"
          onClick={() => navigate('/piano')}
          title="Switch piano"
        >
          {label}
        </button>
      )}

      {instruments.length > 0 && (
        <select
          className="piano-chrome__source"
          value={source}
          onChange={(e) => onSource(e.target.value)}
          aria-label="Sound source"
        >
          <option value={ONBOARD}>Onboard</option>
          {instruments.map((inst) => (
            <option key={inst.id} value={inst.id}>{inst.name}</option>
          ))}
        </select>
      )}

      {source === ONBOARD && voices.length > 0 && (
        <select
          className="piano-chrome__voice"
          defaultValue=""
          onChange={(e) => e.target.value !== '' && onVoice(Number(e.target.value))}
          aria-label="Instrument voice"
        >
          <option value="" disabled>Voice…</option>
          {voices.map((v) => (
            <option key={v.program} value={v.program}>{v.label}</option>
          ))}
        </select>
      )}

      <button
        type="button"
        className={`piano-chrome__status piano-chrome__status--${connected ? 'on' : 'off'}`}
        onClick={connect}
        title={connected ? `Connected: ${inputName}` : `Tap to connect (${status})`}
      >
        <span className="piano-chrome__dot" />
        {connected ? (inputName || 'Piano') : 'Connect piano'}
      </button>
    </header>
  );
}

export default PianoChrome;
