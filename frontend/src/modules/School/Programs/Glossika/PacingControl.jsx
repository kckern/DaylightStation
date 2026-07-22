import { useState } from 'react';

/**
 * The one pacing knob: new sentences admitted per day (design §1).
 *
 * The whole scheduler has exactly this parameter — no ease factors, no
 * intervals. The steps mirror the 2016 dropdown, which ran 2 to 100; anything
 * finer is false precision for a number the learner tunes by feel.
 */
const STEPS = [2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

export default function PacingControl({ value, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lang-pacing">
      <button
        type="button"
        className="lang-pacing__button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {value ?? '—'} / day
      </button>
      {open && (
        <ul className="lang-pacing__menu" role="listbox" aria-label="New sentences per day">
          {STEPS.map((step) => (
            <li key={step}>
              <button
                type="button"
                role="option"
                aria-selected={step === value}
                className={`lang-pacing__option${step === value ? ' is-selected' : ''}`}
                onClick={() => { setOpen(false); if (step !== value) onChange(step); }}
              >
                {step}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
