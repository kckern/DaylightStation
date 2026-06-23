import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';

/**
 * PianoChrome — always-on bar across every mode: home, piano label (tap to switch
 * pianos), the timbre/voice picker (Program Change out), and connection status.
 *
 * @param {Array<{label:string, program:number}>} [voices] - timbre options
 * @param {string} [label] - this piano's display name
 * @param {string} [pianoId] - active piano id (home routes to its menu)
 */
export function PianoChrome({ voices = [], label, pianoId }) {
  const navigate = useNavigate();
  const { connected, inputName, status, sendProgramChange, connect } = usePianoMidi();
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
