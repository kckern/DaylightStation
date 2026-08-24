import Popover from './Popover.jsx';

/**
 * The one pacing knob: new sentences admitted per day (design §1).
 *
 * The whole scheduler has exactly this parameter — no ease factors, no
 * intervals. The steps mirror the 2016 dropdown, which ran 2 to 100; anything
 * finer is false precision for a number the learner tunes by feel.
 */
const STEPS = [2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

export default function PacingControl({ value, onChange }) {
  return (
    <Popover label={`${value ?? '—'} / day`} ariaLabel="New sentences per day">
      {(close) => (
        <ul className="lang-menu" role="none">
          {STEPS.map((step) => (
            <li key={step} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={step === value}
                className={`lang-menu__item${step === value ? ' is-selected' : ''}`}
                onClick={() => { close(); if (step !== value) onChange(step); }}
              >
                {step}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
