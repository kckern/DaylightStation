import './Transport.scss';

/**
 * StepGrid — the kiosk's canonical discrete picker: one row of ≥48px tap
 * targets, current value lit (the VolumeModal Off/Low/Med/High/Max language,
 * generalized). Replaces the per-surface `nearestStep` hand-rolls; hosts map
 * values→index and compose rows for larger grids (KeySheet).
 *
 * @param {Array<{label: string, sub?: import('react').ReactNode}>} steps
 * @param {number} activeIndex
 * @param {(i: number) => void} onPick
 * @param {string} ariaLabel
 * @param {boolean} [disabled]
 * @param {'buttons'|'meter'} [variant] - `meter` draws the steps as a rising
 *   level ladder: each step carries a bar sized by its position, and every bar up
 *   to the active step is lit, so "how much" reads at a glance. Step 0 is the
 *   none step (Off / Mute) and draws a flat dash. Use it for ordered amounts only.
 */
export default function StepGrid({ steps, activeIndex, onPick, ariaLabel, disabled = false, variant = 'buttons' }) {
  const meter = variant === 'meter';
  const last = Math.max(1, steps.length - 1);
  return (
    <div className={`piano-stepgrid${meter ? ' piano-stepgrid--meter' : ''}`} role="group" aria-label={ariaLabel}>
      {steps.map((s, i) => (
        <button
          key={s.label}
          type="button"
          className={`piano-stepgrid__step${i === activeIndex ? ' is-on' : ''}${meter && activeIndex >= 0 && i <= activeIndex ? ' is-lit' : ''}`}
          aria-pressed={i === activeIndex}
          disabled={disabled}
          onClick={() => onPick(i)}
        >
          {meter && <span className="piano-stepgrid__bar" aria-hidden style={{ '--level': i / last }} />}
          {meter ? <span className="piano-stepgrid__label">{s.label}</span> : s.label}
          {s.sub != null && <span className="piano-stepgrid__sub">{s.sub}</span>}
        </button>
      ))}
    </div>
  );
}
