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
 */
export default function StepGrid({ steps, activeIndex, onPick, ariaLabel, disabled = false }) {
  return (
    <div className="piano-stepgrid" role="group" aria-label={ariaLabel}>
      {steps.map((s, i) => (
        <button
          key={s.label}
          type="button"
          className={`piano-stepgrid__step${i === activeIndex ? ' is-on' : ''}`}
          aria-pressed={i === activeIndex}
          disabled={disabled}
          onClick={() => onPick(i)}
        >
          {s.label}
          {s.sub != null && <span className="piano-stepgrid__sub">{s.sub}</span>}
        </button>
      ))}
    </div>
  );
}
