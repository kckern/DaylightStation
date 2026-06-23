import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';
import { usePianoBreadcrumbBar } from './PianoBreadcrumbContext.jsx';
import { resolveInstrumentSpec } from './instrumentSpec.js';
import Icon from './icons/Icon.jsx';

/** Sentinel source value: the piano's own onboard voice (Program-Change timbres). */
export const ONBOARD = '__onboard__';

/**
 * PianoChrome — always-on breadcrumb header across every mode. The trail is
 * `home › mode › …deeper crumbs`: the home icon returns to this piano's menu, the
 * mode crumb returns to the mode's index, and deeper routes publish their own
 * segments (course, lecture, album, game) via the breadcrumb bus. The deepest
 * crumb is the current location; ancestors are tappable. Right-aligned: the
 * sound-source selector (onboard vs a rendered voice-bridge instrument), the
 * onboard timbre/voice cycle (Program Change out), and connection status.
 *
 * @param {Array<{label:string, program:number}>} [voices] - onboard timbre options
 * @param {Array<{id:string, name:string, engine:string, asset:string}>} [instruments] - rendered-voice definitions
 * @param {string} [modeLabel] - current mode name (empty on home)
 * @param {string} [modeKey] - current mode route segment, for the mode crumb link
 * @param {boolean} [showVoice=true] - whether to show the voice/source controls (hide on passive-media modes)
 */
export function PianoChrome({ voices = [], instruments = [], modeLabel, modeKey, showVoice = true }) {
  const navigate = useNavigate();
  const { connected, inputName, status, sendProgramChange, sendLocalControl, connect } = usePianoMidi();
  const { pianoId, basePath } = usePianoKioskConfig();
  const { crumbs: extraCrumbs } = usePianoBreadcrumbBar();
  const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });
  const logger = useMemo(() => getLogger().child({ component: 'piano-chrome' }), []);

  // Assemble the trail: mode crumb (links to the mode index) + any deeper crumbs
  // published by the active route. The last crumb renders as the current page.
  const trail = [];
  if (modeLabel) trail.push({ label: modeLabel, onClick: () => navigate(`${basePath}/${modeKey}`) });
  (extraCrumbs || []).forEach((c) => trail.push({ label: c.label, onClick: c.onClick }));

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
      <nav className="piano-chrome__crumbs" aria-label="Breadcrumb">
        <button
          type="button"
          className="piano-chrome__home"
          onClick={() => navigate(basePath)}
          aria-label="Home"
        >
          <Icon name="home" />
        </button>

        {trail.map((c, i) => {
          const isLast = i === trail.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              <span className="piano-chrome__sep" aria-hidden>›</span>
              {!isLast && c.onClick ? (
                <button type="button" className="piano-chrome__crumb" onClick={c.onClick}>
                  {c.label}
                </button>
              ) : (
                <span className={`piano-chrome__crumb${isLast ? ' piano-chrome__crumb--current' : ''}`}>
                  {c.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="piano-chrome__right">
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
      </div>
    </header>
  );
}

export default PianoChrome;
