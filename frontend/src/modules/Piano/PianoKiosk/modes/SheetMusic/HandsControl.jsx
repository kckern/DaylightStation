import React, { memo } from 'react';

/**
 * HandsControl — the grand-staff fast path for "who plays which staff", asked as a
 * single segmented control instead of per-staff chips (audit J4). Two variants:
 *
 *  variant="hands"  (Learn/Polish): Both · RH · LH  — which hands YOU practice.
 *  variant="mypart" (Listen):  None · RH · LH · Both — which hand YOU play along
 *                              with; the kiosk performs the rest.
 *
 * Presentational: the parent maps the value to/from its activeParts / myStaves
 * state. Memoized (value/onChange only) so it doesn't reconcile on step advances.
 *
 * @param {object} p
 * @param {'hands'|'mypart'} p.variant
 * @param {'both'|'rh'|'lh'|'none'} p.value
 * @param {(v:string) => void} p.onChange
 */
const OPTIONS = {
  hands: [
    { v: 'both', label: 'Both' },
    { v: 'rh', label: 'RH' },
    { v: 'lh', label: 'LH' },
  ],
  mypart: [
    { v: 'none', label: 'None' },
    { v: 'rh', label: 'RH' },
    { v: 'lh', label: 'LH' },
    { v: 'both', label: 'Both' },
  ],
};

const HandsControl = memo(function HandsControl({ variant = 'hands', value, onChange }) {
  const label = variant === 'mypart' ? 'My part' : 'Hands';
  return (
    <div className="piano-score-hands" role="group" aria-label={label}>
      <span className="piano-score-hands__label">{label}</span>
      {OPTIONS[variant].map(({ v, label: l }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={`piano-score-btn piano-score-hands__opt${value === v ? ' is-on' : ''}`}
          onClick={() => onChange?.(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
});

export default HandsControl;
