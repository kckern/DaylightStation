import React, { useState, memo } from 'react';
import { ChevronDownIcon, CloseIcon } from './icons.jsx';

/**
 * LoopControl — the loop is a first-class transport control (audit L1). The
 * trigger reads "Loop" + chevron (inactive) or "Loop m9–m16" (active) with a
 * one-tap clear beside it (audit L2). The popover offers rehearsal-mark sections,
 * "Select measures…" (the guided two-tap custom range), and (when active) Clear.
 * Presentational; the parent owns focus/selection state. Memoized on its props.
 *
 * @param {object} p
 * @param {boolean} [p.active]
 * @param {string} [p.scopeLabel]
 * @param {Array<{label:string}>} [p.sections]
 * @param {(s:object) => void} [p.onPickSection]
 * @param {() => void} [p.onStartSelect]
 * @param {() => void} [p.onClearFocus]
 */
const LoopControl = memo(function LoopControl({ active = false, scopeLabel = '', sections = [], onPickSection, onStartSelect, onClearFocus }) {
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
