import React, { useState, memo } from 'react';

/**
 * PracticeScope — the single "what am I practicing" control (audit J5). Replaces
 * the old row of section chips + Loop + Clear + readout with one button that shows
 * the current scope ("Practice: Whole piece ▾" / a section label / "m9–16") and a
 * popover offering: each rehearsal-mark section, "Select measures…" (the guided
 * two-tap custom range), and "Whole piece" (clear).
 *
 * Presentational; the parent owns focus/selection state. Memoized on its props.
 *
 * @param {object} p
 * @param {string} p.scopeLabel
 * @param {Array<{label:string}>} [p.sections]
 * @param {(s:object) => void} [p.onPickSection]
 * @param {() => void} [p.onStartSelect]
 * @param {() => void} [p.onClearFocus]
 */
const PracticeScope = memo(function PracticeScope({ scopeLabel, sections = [], onPickSection, onStartSelect, onClearFocus }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pick = (fn, arg) => { fn?.(arg); close(); };

  return (
    <div className="piano-score-practice-wrap">
      <button
        type="button"
        className="piano-score-btn piano-score-practice"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {`Practice: ${scopeLabel} ▾`}
      </button>
      {open && (
        <>
          <button type="button" className="piano-score-popover-backdrop" aria-label="Close" onClick={close} />
          <div className="piano-score-practice-menu" role="dialog" aria-label="Practice range">
            {sections.map((s) => (
              <button key={s.label} type="button" className="piano-score-btn piano-score-practice-opt" onClick={() => pick(onPickSection, s)}>
                {s.label}
              </button>
            ))}
            <button type="button" className="piano-score-btn piano-score-practice-opt" onClick={() => pick(onStartSelect)}>
              Select measures…
            </button>
            <button type="button" className="piano-score-btn piano-score-practice-opt" onClick={() => pick(onClearFocus)}>
              Whole piece
            </button>
          </div>
        </>
      )}
    </div>
  );
});

export default PracticeScope;
