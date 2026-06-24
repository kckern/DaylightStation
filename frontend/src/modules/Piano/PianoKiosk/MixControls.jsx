import Icon from './icons/Icon.jsx';

/**
 * Presentational balance control: a piano −/+ cluster and a media −/+ cluster.
 * Pure — handlers (which clamp/persist via PianoMix) are wired by the host.
 * `onPiano`/`onMedia` receive a signed delta. `btnClass` lets each host reuse
 * its existing button style so the control inherits the surrounding chrome.
 */
const STEP = 0.1;
const pct = (v) => `${Math.round((v ?? 0) * 100)}`;

export default function MixControls({ pianoLevel, mediaLevel, onPiano, onMedia, btnClass = 'piano-mix__btn' }) {
  return (
    <div className="piano-mix">
      <div className="piano-mix__cluster">
        <Icon name="piano" className="piano-mix__lead" label="Piano" />
        <button type="button" className={btnClass} onClick={() => onPiano(-STEP)} aria-label="Piano volume down"><Icon name="volume-down" /></button>
        <span className="piano-mix__val">{pct(pianoLevel)}</span>
        <button type="button" className={btnClass} onClick={() => onPiano(STEP)} aria-label="Piano volume up"><Icon name="volume-up" /></button>
      </div>
      <div className="piano-mix__cluster">
        <Icon name="music" className="piano-mix__lead" label="Media" />
        <button type="button" className={btnClass} onClick={() => onMedia(-STEP)} aria-label="Media volume down"><Icon name="volume-down" /></button>
        <span className="piano-mix__val">{pct(mediaLevel)}</span>
        <button type="button" className={btnClass} onClick={() => onMedia(STEP)} aria-label="Media volume up"><Icon name="volume-up" /></button>
      </div>
    </div>
  );
}
