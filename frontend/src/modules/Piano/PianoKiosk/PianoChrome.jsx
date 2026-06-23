import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig, usePianoRoster } from './PianoConfig.jsx';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';
import { resolveInstrumentSpec } from './instrumentSpec.js';
import Icon from './icons/Icon.jsx';

/** Sentinel source value: the piano's own onboard voice (Program-Change timbres). */
export const ONBOARD = '__onboard__';

/**
 * PianoChrome — always-on bar across every mode: home, piano label (tap to switch
 * pianos, only when 2+ pianos), the current mode name, the sound-source selector
 * (onboard vs a rendered instrument from the voice bridge), the onboard timbre/
 * voice cycle button (Program Change out), and connection status. Home + switch
 * navigation come from `basePath` in context.
 *
 * @param {Array<{label:string, program:number}>} [voices] - onboard timbre options
 * @param {Array<{id:string, name:string, engine:string, asset:string}>} [instruments] - rendered-voice definitions
 * @param {string} [label] - this piano's display name
 * @param {string} [modeLabel] - current mode name shown after the label (empty on home)
 * @param {boolean} [showVoice=true] - whether to show the voice/source controls (hide on passive-media modes)
 */
export function PianoChrome({ voices = [], instruments = [], label, modeLabel, showVoice = true }) {
  const navigate = useNavigate();
  const { connected, inputName, status, sendProgramChange, sendLocalControl, connect } = usePianoMidi();
  const { pianoId, basePath } = usePianoKioskConfig();
  const { pianos } = usePianoRoster();
  const multiPiano = pianos.length > 1;
  const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });
  const logger = useMemo(() => getLogger().child({ component: 'piano-chrome' }), []);

  const [voiceIdx, setVoiceIdx] = useState(0);
  const [source, setSource] = useState(ONBOARD);

  const cycleVoice = () => {
    if (!voices.length) return;
    const next = (voiceIdx + 1) % voices.length;
    setVoiceIdx(next);
    const ok = sendProgramChange(voices[next].program);
    logger.info('piano.voice-change', { program: voices[next].program, sent: ok, pianoId });
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

      {showVoice && instruments.length > 0 && (
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

      {showVoice && source === ONBOARD && voices.length > 0 && (
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
