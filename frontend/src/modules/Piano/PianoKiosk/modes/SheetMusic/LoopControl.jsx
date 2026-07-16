import React, { useState, memo } from 'react';
import { ChevronDownIcon, CloseIcon } from './icons.jsx';

/**
 * LoopControl — the loop is a first-class transport control (audit L1). The
 * trigger reads "Loop" + chevron (inactive) or "Loop m9–m16" (active) with a
 * one-tap clear beside it (audit L2). The popover offers rehearsal-mark sections,
 * "Select measures…" (the guided two-tap custom range), and (when active) Clear
 * plus ±1-measure Start/End nudge rows — nudges keep the menu open so endpoints
 * can be walked without redoing the two-tap selection (audit L2).
 * Presentational; the parent owns focus/selection state. Memoized on its props.
 *
 * @param {object} p
 * @param {boolean} [p.active]
 * @param {string} [p.scopeLabel]
 * @param {Array<{label:string}>} [p.sections]
 * @param {(s:object) => void} [p.onPickSection]
 * @param {() => void} [p.onStartSelect]
 * @param {() => void} [p.onClearFocus]
 * @param {(edge:'in'|'out', delta:number) => void} [p.onNudge]
 */
const LoopControl = memo(function LoopControl({ active = false, scopeLabel = '', sections = [], onPickSection, onStartSelect, onClearFocus, onNudge }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pick = (fn, arg) => { fn?.(arg); close(); };

  return (
    <div className="piano-score-loop-wrap">
      <button
        type="button"
        className={`piano-score-btn piano-score-loop-trigger${active ? ' is-on' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? `Loop ${scopeLabel}` : 'Loop'}
        {!active && <ChevronDownIcon />}
      </button>
      {active && (
        <button type="button" className="piano-score-btn piano-score-loop-clear" aria-label="Clear loop" onClick={() => onClearFocus?.()}>
          <CloseIcon />
        </button>
      )}
      {open && (
        <>
          <button type="button" className="piano-score-popover-backdrop" aria-label="Close" onClick={close} />
          <div className="piano-score-loop-menu" role="dialog" aria-label="Loop range">
            {sections.map((s) => (
              <button key={s.label} type="button" className="piano-score-btn piano-score-loop-opt" onClick={() => pick(onPickSection, s)}>
                {s.label}
              </button>
            ))}
            {active && (
              <div className="piano-score-loop-nudge" role="group" aria-label="Adjust loop">
                <span className="piano-score-loop-nudge__label">Start</span>
                <button type="button" className="piano-score-btn" aria-label="Loop start earlier" onClick={() => onNudge?.('in', -1)}>−</button>
                <button type="button" className="piano-score-btn" aria-label="Loop start later" onClick={() => onNudge?.('in', +1)}>+</button>
                <span className="piano-score-loop-nudge__label">End</span>
                <button type="button" className="piano-score-btn" aria-label="Loop end earlier" onClick={() => onNudge?.('out', -1)}>−</button>
                <button type="button" className="piano-score-btn" aria-label="Loop end later" onClick={() => onNudge?.('out', +1)}>+</button>
              </div>
            )}
            <button type="button" className="piano-score-btn piano-score-loop-opt" onClick={() => pick(onStartSelect)}>
              Select measures…
            </button>
            {active && (
              <button type="button" className="piano-score-btn piano-score-loop-opt" onClick={() => pick(onClearFocus)}>
                Clear loop
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default LoopControl;
