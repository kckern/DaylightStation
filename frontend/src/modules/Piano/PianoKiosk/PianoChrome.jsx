import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig, usePianoRoster } from './PianoConfig.jsx';
import Icon from './icons/Icon.jsx';

/**
 * PianoChrome — always-on bar across every mode: home, piano label (tap to switch
 * pianos, only when 2+ pianos), the timbre/voice picker (Program Change out), and
 * connection status. Home + switch navigation come from `basePath` in context.
 *
 * @param {Array<{label:string, program:number}>} [voices] - timbre options
 * @param {string} [label] - this piano's display name
 * @param {string} [modeLabel] - current mode name shown after the label (empty on home)
 * @param {boolean} [showVoice=true] - whether to show the voice cycle button (hide on passive-media modes)
 */
export function PianoChrome({ voices = [], label, modeLabel, showVoice = true }) {
  const navigate = useNavigate();
  const { connected, inputName, status, sendProgramChange, connect } = usePianoMidi();
  const { pianoId, basePath } = usePianoKioskConfig();
  const { pianos } = usePianoRoster();
  const multiPiano = pianos.length > 1;
  const logger = useMemo(() => getLogger().child({ component: 'piano-chrome' }), []);

  const [voiceIdx, setVoiceIdx] = useState(0);

  const cycleVoice = () => {
    if (!voices.length) return;
    const next = (voiceIdx + 1) % voices.length;
    setVoiceIdx(next);
    const ok = sendProgramChange(voices[next].program);
    logger.info('piano.voice-change', { program: voices[next].program, sent: ok, pianoId });
  };

  return (
    <header className="piano-chrome">
      <button
        type="button"
        className="piano-chrome__home"
        onClick={() => navigate(basePath)}
        aria-label="Home"
      >
        <Icon name="home" />
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

      {modeLabel && <span className="piano-chrome__mode">{modeLabel}</span>}

      {showVoice && voices.length > 0 && (
        <button
          type="button"
          className="piano-chrome__voice"
          onClick={cycleVoice}
          aria-label="Change instrument voice"
        >
          {voices[voiceIdx]?.label || 'Voice'}
        </button>
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
