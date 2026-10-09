import { useState } from 'react';
import { DRUM_ROWS, drumPatternToTake, drumPreset } from './drumSequencerModel.js';
import './DrumSequencer.scss';

const STEPS_PER_BAR = 16;
const MAX_BARS = 16;

export function DrumSequencer({
  lengthBars = 2,
  onCommit,
  onClose,
  onPreview,
  onStopPreview,
  isPreviewing = false,
}) {
  const bars = Math.max(1, Math.min(MAX_BARS, Math.trunc(lengthBars) || 2));
  const [active, setActive] = useState(() => new Set());
  const [currentBar, setCurrentBar] = useState(0);
  const [preset, setPreset] = useState(null);

  const stopPreview = () => { if (isPreviewing) onStopPreview?.(); };
  const replaceActive = (next) => { stopPreview(); setActive(next); };
  const toggle = (gm, localStep) => {
    stopPreview();
    const step = currentBar * STEPS_PER_BAR + localStep;
    const key = `${gm}:${step}`;
    setPreset(null);
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const applyPreset = (name) => { setPreset(name); replaceActive(drumPreset(name, bars)); };
  const makeTake = () => drumPatternToTake(active, bars, { preset });
  const close = () => { onStopPreview?.(); onClose(); };
  const commit = () => { onStopPreview?.(); onCommit(makeTake()); onClose(); };

  return (
    <div className="piano-sheet-scrim" role="presentation" onClick={close}>
      <div className="piano-sheet piano-drumseq" role="dialog" aria-label="build a drum loop" onClick={(e) => e.stopPropagation()}>
        <h2 className="piano-drumseq__title">Build a drum loop</h2>
        <div className="piano-drumseq__presets" role="group" aria-label="drum presets">
          {['rock', 'house', 'funk'].map((name) => (
            <button key={name} type="button" className={preset === name ? 'is-on' : ''} aria-pressed={preset === name} onClick={() => applyPreset(name)}>
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>

        <div className="piano-drumseq__bars" role="group" aria-label="edit bar">
          {Array.from({ length: bars }, (_, bar) => (
            <button key={bar} type="button" className={currentBar === bar ? 'is-on' : ''} aria-pressed={currentBar === bar} onClick={() => setCurrentBar(bar)}>
              {bar + 1}
            </button>
          ))}
        </div>

        <div className="piano-drumseq__grid">
          {DRUM_ROWS.map((row) => (
            <div key={row.gm} className="piano-drumseq__row">
              <span className="piano-drumseq__row-label">{row.label}</span>
              <div className="piano-drumseq__cells">
                {Array.from({ length: STEPS_PER_BAR }, (_, localStep) => {
                  const globalStep = currentBar * STEPS_PER_BAR + localStep;
                  const on = active.has(`${row.gm}:${globalStep}`);
                  return (
                    <button
                      key={localStep}
                      type="button"
                      className={`piano-drumseq__cell${on ? ' is-on' : ''}${localStep % 4 === 0 ? ' is-beat' : ''}`}
                      aria-label={`${row.label} bar ${currentBar + 1} step ${localStep + 1}`}
                      aria-pressed={on}
                      onClick={() => toggle(row.gm, localStep)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="piano-drumseq__actions">
          <button type="button" className="piano-sheet__done piano-drumseq__clear" disabled={active.size === 0} onClick={() => { setPreset(null); replaceActive(new Set()); }}>Clear</button>
          <button type="button" className="piano-sheet__done piano-drumseq__cancel" onClick={close}>Cancel</button>
          <button type="button" className="piano-sheet__done" disabled={active.size === 0 || !onPreview} onClick={() => (isPreviewing ? onStopPreview?.() : onPreview?.(makeTake()))}>
            {isPreviewing ? 'Stop preview' : 'Preview'}
          </button>
          <button type="button" className="piano-sheet__done" disabled={active.size === 0} onClick={commit}>Add drum loop</button>
        </div>
      </div>
    </div>
  );
}

export default DrumSequencer;
