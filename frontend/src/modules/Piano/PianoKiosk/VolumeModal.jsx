import { useState } from 'react';
import Icon from './icons/Icon.jsx';
import { usePianoMix } from './PianoMixContext.jsx';
import { STEPS, stepToLevel, levelToStep } from './volumeCurve.js';

/**
 * One volume control: an icon + name header over a five-button
 * Off/Low/Med/High/Max stepper — mirrors SoundPanel's ToneStepper so the
 * touch/visual language matches the rest of the kiosk's stepper controls.
 * `activeIndex` lights the current step; `onPick` gets the tapped index.
 */
function VolumeStepper({ icon, name, activeIndex, onPick }) {
  return (
    <div className="piano-volume-modal__card">
      <div className="piano-volume-modal__cardhead">
        <Icon name={icon} className="piano-volume-modal__icon" />
        <span className="piano-volume-modal__name">{name}</span>
      </div>
      <div className="piano-volume-modal__steps" role="group" aria-label={name}>
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`piano-volume-modal__step${i === activeIndex ? ' is-on' : ''}${i === 0 ? ' is-off' : ''}`}
            aria-pressed={i === activeIndex}
            onClick={() => onPick(i)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Volume — the player-facing modal for the two software output levels that
 * share the BT speaker's one physical slider (see PianoMixContext): Media
 * (the video/music element's own volume) and MIDI (the piano voice's CC7
 * channel volume). Replaces the old small MixControls popup with a bigger,
 * touch-friendly Off/Low/Med/High/Max stepper per level, plus a Log/Linear
 * toggle that governs how the five steps map onto the underlying 0-1 level
 * (log spreads perceived loudness better; linear over-indexes at the top).
 */
export default function VolumeModal({ open, onClose }) {
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
  const [curve, setCurve] = useState('log');

  if (!open) return null;

  return (
    <div className="piano-volume-modal" role="dialog" aria-label="Volume" aria-modal="true">
      <div className="piano-volume-modal__scrim" onClick={onClose} />
      <div className="piano-volume-modal__sheet">
        <header className="piano-volume-modal__head">
          <h2>Volume</h2>
          <button type="button" className="piano-volume-modal__close" onClick={onClose} aria-label="Close volume">
            <Icon name="close" />
          </button>
        </header>

        <VolumeStepper
          icon="volume"
          name="Media Volume"
          activeIndex={levelToStep(mediaLevel, curve)}
          onPick={(i) => setMediaLevel(stepToLevel(i, curve))}
        />
        <VolumeStepper
          icon="piano"
          name="MIDI Volume"
          activeIndex={levelToStep(pianoLevel, curve)}
          onPick={(i) => setPianoLevel(stepToLevel(i, curve))}
        />

        <div className="piano-volume-modal__curve" role="group" aria-label="Volume curve">
          <button
            type="button"
            className={`piano-volume-modal__curve-btn${curve === 'linear' ? ' is-on' : ''}`}
            aria-pressed={curve === 'linear'}
            onClick={() => setCurve('linear')}
          >
            Linear
          </button>
          <button
            type="button"
            className={`piano-volume-modal__curve-btn${curve === 'log' ? ' is-on' : ''}`}
            aria-pressed={curve === 'log'}
            onClick={() => setCurve('log')}
          >
            Log
          </button>
        </div>
      </div>
    </div>
  );
}
