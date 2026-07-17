import React from 'react';

/**
 * ViewMenu — the consolidated "how the score looks" panel behind the View button
 * (audit J5/M4). Gathers what used to be four separate bar buttons (layout/flow,
 * size, keyboard, info) into one labeled menu, so the bar's view controls stop
 * competing with the practice controls.
 *
 * Presentational: open/close is owned by the parent (single-open popover state).
 *
 * @param {object} p
 * @param {'wrapped'|'horizontal'} p.flow
 * @param {() => void} p.onToggleFlow  - binary toggle; the rows call it only on change
 * @param {number} p.scale
 * @param {(v:number) => void} p.onScale
 * @param {boolean} p.keyboardVisible
 * @param {() => void} p.onToggleKeyboard
 * @param {object} p.meta
 */
const SIZE_STEPS = [
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
];
const nearestStep = (steps, val) => {
  let best = 0, bestDist = Infinity;
  steps.forEach((s, i) => { const d = Math.abs(s.value - val); if (d < bestDist) { bestDist = d; best = i; } });
  return best;
};

export default function ViewMenu({ flow, onToggleFlow, scale, onScale, keyboardVisible, onToggleKeyboard, meta = {} }) {
  const sizeIdx = nearestStep(SIZE_STEPS, scale);
  return (
    <div className="piano-score-view-menu" role="dialog" aria-label="View">
      <div className="piano-score-view-row" role="group" aria-label="Layout">
        <span className="piano-score-view-row__label">Layout</span>
        <button
          type="button"
          className={`piano-score-btn${flow === 'wrapped' ? ' is-on' : ''}`}
          aria-pressed={flow === 'wrapped'}
          onClick={() => { if (flow !== 'wrapped') onToggleFlow?.(); }}
        >
          Down the page
        </button>
        <button
          type="button"
          className={`piano-score-btn${flow === 'horizontal' ? ' is-on' : ''}`}
          aria-pressed={flow === 'horizontal'}
          onClick={() => { if (flow !== 'horizontal') onToggleFlow?.(); }}
        >
          Across
        </button>
      </div>

      <div className="piano-score-view-row" role="group" aria-label="Size">
        <span className="piano-score-view-row__label">Size</span>
        {SIZE_STEPS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`piano-score-btn piano-score-step${i === sizeIdx ? ' is-on' : ''}`}
            aria-pressed={i === sizeIdx}
            onClick={() => onScale?.(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="piano-score-view-row">
        <button
          type="button"
          className={`piano-score-btn${keyboardVisible ? ' is-on' : ''}`}
          aria-pressed={keyboardVisible}
          onClick={onToggleKeyboard}
        >
          {`Keyboard: ${keyboardVisible ? 'Shown' : 'Hidden'}`}
        </button>
      </div>

      <dl className="piano-score-view-about">
        {meta.title != null && (<><dt>Title</dt><dd>{meta.title}</dd></>)}
        {meta.composer != null && (<><dt>Composer</dt><dd>{meta.composer}</dd></>)}
        {meta.key != null && (<><dt>Key</dt><dd>{meta.key}</dd></>)}
        {meta.time != null && (<><dt>Time</dt><dd>{meta.time}</dd></>)}
        {meta.tempo != null && (<><dt>Tempo</dt><dd>{meta.tempo}</dd></>)}
        {meta.measures != null && (<><dt>Measures</dt><dd>{meta.measures}</dd></>)}
      </dl>
    </div>
  );
}
