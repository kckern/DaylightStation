/**
 * Renders one metric of the closed set (`2_domains/school/reporting.mjs`).
 *
 * One branch per kind, and the kinds are fixed in code — which is the whole
 * point of the contract. This component never knows which program produced the
 * metric, so adding a program adds no branch here.
 *
 * A kind with no branch cannot arrive: the server drops unknown kinds before
 * they reach the wire. The default below is a backstop for a version skew
 * (newer backend, cached frontend), and it shows the raw label rather than
 * nothing so the gap is visible instead of silent.
 */

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function humanDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * A sparkline as inline SVG — no chart library, and no animation, which the
 * kiosk WebView cannot afford anyway.
 */
function Sparkline({ points }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 120;
  const h = 28;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.value - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="school-metric__spark" viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Trend from ${pct(values[0])} to ${pct(values[values.length - 1])}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default function MetricTile({ metric }) {
  const body = (() => {
    switch (metric.kind) {
      case 'progress': {
        const ratio = Math.min(1, metric.value / metric.total);
        return (
          <>
            <div className="school-metric__bar" role="progressbar"
              aria-valuenow={metric.value} aria-valuemin={0} aria-valuemax={metric.total}>
              <div className="school-metric__bar-fill" style={{ width: `${ratio * 100}%` }} />
            </div>
            <span className="school-metric__value">
              {metric.value.toLocaleString()} / {metric.total.toLocaleString()}
            </span>
          </>
        );
      }
      case 'count':
        return (
          <span className="school-metric__value school-metric__value--figure">
            {metric.value.toLocaleString()}
            {metric.unit && <span className="school-metric__unit"> {metric.unit}</span>}
          </span>
        );
      case 'score':
        return <span className="school-metric__value school-metric__value--figure">{pct(metric.value)}</span>;
      case 'streak':
        return (
          <span className="school-metric__value school-metric__value--figure">
            {metric.value.toLocaleString()}
            <span className="school-metric__unit"> {metric.unit}</span>
          </span>
        );
      case 'trend':
        return <Sparkline points={metric.points} />;
      case 'duration':
        return <span className="school-metric__value school-metric__value--figure">{humanDuration(metric.ms)}</span>;
      default:
        return <span className="school-metric__value school-metric__unknown">—</span>;
    }
  })();

  return (
    <div className={`school-metric school-metric--${metric.kind}`}>
      <span className="school-metric__label">{metric.label}</span>
      {body}
    </div>
  );
}
