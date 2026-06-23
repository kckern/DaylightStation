import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig, usePianoRoster } from './PianoConfig.jsx';

/**
 * PianoChrome — always-on bar across every mode: home, piano label (tap to switch
 * pianos, only when 2+ pianos), the timbre/voice picker (Program Change out), and
 * connection status. Home + switch navigation come from `basePath` in context.
 *
 * @param {Array<{label:string, program:number}>} [voices] - timbre options
 * @param {string} [label] - this piano's display name
 */
export function PianoChrome({ voices = [], label }) {
  const navigate = useNavigate();
  const { connected, inputName, status, sendProgramChange, connect } = usePianoMidi();
  const { pianoId, basePath } = usePianoKioskConfig();
  const { pianos } = usePianoRoster();
  const multiPiano = pianos.length > 1;
  const logger = useMemo(() => getLogger().child({ component: 'piano-chrome' }), []);

  const onVoice = (program) => {
    const ok = sendProgramChange(program);
    logger.info('piano.voice-change', { program, sent: ok, pianoId });
  };

  return (
    <header className="piano-chrome">
      <button
        type="button"
        className="piano-chrome__home"
        onClick={() => navigate(basePath)}
        aria-label="Home"
      >
        ⌂
      </button>

      {label && (multiPiano ? (
        <button
          type="button"
          className="piano-chrome__label"
          onClick={() => navigate('/piano')}
          title="Switch piano"
        >
          {label}
        </button>
      ) : (
        <span className="piano-chrome__label piano-chrome__label--static">{label}</span>
      ))}

      {voices.length > 0 && (
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
