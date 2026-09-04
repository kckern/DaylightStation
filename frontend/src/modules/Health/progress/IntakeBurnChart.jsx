import { buildIntakeBurn } from './intakeBurn.js';

/**
 * Intake vs burn over a range: one column per day, food hanging down from a
 * baseline and exercise standing up from it, on ONE shared kcal scale (see
 * intakeBurn.js — two scales would draw a 300 kcal walk as tall as a 2,400
 * kcal day).
 *
 * Presentational: it takes `days` rather than fetching, so the same 30-day
 * range already loaded for the sidebar's month block feeds this too instead of
 * a second identical request. Plain CSS blocks — no chart library, and nothing
 * animates `filter`.
 *
 * A day the server could not compute renders as a hollow marker on the
 * baseline, never as a pair of zero-height bars: "no data" is not "ate nothing
 * and burned nothing".
 */
export function IntakeBurnChart({ days = [], loading = false, title = 'Intake vs burn' }) {
  const { bars, foodAreaPct, exerciseAreaPct } = buildIntakeBurn(days);
  const known = bars.filter((b) => b.kind === 'day');
  const gaps = bars.length - known.length;
  const avgFood = known.length ? Math.round(known.reduce((s, b) => s + b.food, 0) / known.length) : null;
  const avgBurn = known.length ? Math.round(known.reduce((s, b) => s + b.exercise, 0) / known.length) : null;

  return (
    <section className="health-intakeburn" aria-busy={loading}>
      {/* `title={null}` suppresses the heading for a caller that already
          names the block (the Progress page's SectionCard). */}
      {title === null ? null : <h3 className="health-intakeburn__title">{title}</h3>}
      <div className="health-intakeburn__plot" role="img"
        aria-label={known.length
          ? `${known.length} days: average intake ${avgFood} kcal, average burn ${avgBurn} kcal${gaps ? `, ${gaps} days without data` : ''}`
          : 'No intake or burn data yet'}>
        <div className="health-intakeburn__burn" style={{ height: `${exerciseAreaPct}%` }}>
          {bars.map((b) => (
            <span key={`up-${b.date}`} className="health-intakeburn__col">
              {b.kind === 'day' ? (
                <span className="health-intakeburn__bar health-intakeburn__bar--burn"
                  data-testid={`burn-${b.date}`} data-height-pct={b.exercisePct}
                  style={{ height: `${b.exercisePct}%` }} />
              ) : null}
            </span>
          ))}
        </div>
        <div className="health-intakeburn__baseline" />
        <div className="health-intakeburn__intake" style={{ height: `${foodAreaPct}%` }}>
          {bars.map((b) => (
            <span key={`down-${b.date}`} className="health-intakeburn__col">
              {b.kind === 'day' ? (
                <span className="health-intakeburn__bar health-intakeburn__bar--intake"
                  data-testid={`intake-${b.date}`} data-height-pct={b.foodPct}
                  style={{ height: `${b.foodPct}%` }} />
              ) : (
                <span className="health-intakeburn__bar health-intakeburn__bar--gap"
                  data-testid={`intakeburn-gap-${b.date}`} />
              )}
            </span>
          ))}
        </div>
      </div>
      <p className="health-intakeburn__caption">
        {known.length ? `avg ${avgFood} in · ${avgBurn} out` : 'No data yet'}
        {gaps ? ` · ${gaps} without data` : ''}
      </p>
    </section>
  );
}
export default IntakeBurnChart;
