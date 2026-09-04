import { barModel } from './dayBars.js';

/**
 * The week strip's month-long cousin, for the desktop sidebar: one thin bar per
 * day over the last 30 days, same encoding as the strip (height = food/budget
 * clamped at 1.25, hue = under/over, a hole renders hollow) so the two read as
 * the same picture at two zoom levels.
 *
 * Presentational on purpose. It takes `days` rather than fetching, because the
 * sidebar shows more than one 30-day surface and each one owning its own fetch
 * is how a page ends up making the same request twice. TodayView fetches the
 * range once and hands it to everything that needs it.
 *
 * Not interactive: 30 targets across 320px cannot be honest 44px tap targets
 * (A2), and the week strip below already owns day navigation.
 */
export function MonthBlock({ days = [], loading = false, title }) {
  // Positional key fallback: a gap entry can arrive without a `date`, and two
  // undefined keys collapse into one rendered slot.
  const models = days.map((d, i) => ({ day: d, bar: barModel(d), key: d?.date ?? `gap-${i}` }));
  const over = models.filter((m) => m.bar.kind === 'day' && m.bar.status === 'over').length;
  const gaps = models.filter((m) => m.bar.kind === 'gap').length;
  const known = models.length - gaps;

  return (
    <section className="health-monthblock" aria-busy={loading}>
      {/* `title={null}` suppresses the heading for a caller (a SectionCard)
          that already names the block; omitting the prop keeps the default. */}
      {title === null ? null : (
        <h3 className="health-monthblock__title">{title || `Last ${days.length || 30} days`}</h3>
      )}
      <div className="health-monthblock__bars" role="img"
        aria-label={known
          ? `${known} days with data, ${over} over budget, ${gaps} without data`
          : 'No budget data for the last 30 days'}>
        {models.map(({ day, bar, key }) => (
          <span key={key} className="health-monthblock__slot">
            {bar.kind === 'gap' ? (
              <span className="health-monthblock__bar health-monthblock__bar--gap"
                data-testid={`monthbar-gap-${day?.date ?? 'unknown'}`} />
            ) : (
              <span className="health-monthblock__bar">
                <span className={`health-monthblock__fill health-monthblock__fill--${bar.status}${bar.offsetByExercise ? ' health-monthblock__fill--offset' : ''}`}
                  data-testid={`monthbar-fill-${day.date}`}
                  data-height-pct={bar.heightPct}
                  style={{ height: `${bar.heightPct}%` }} />
              </span>
            )}
          </span>
        ))}
      </div>
      {/* The gap count is stated, never implied. A month with nine holes and a
          month with none must not look like the same month. */}
      <p className="health-monthblock__caption">
        {known ? `${known}/${days.length} days logged · ${over} over current budget` : 'No logged days yet'}
        {gaps ? ` · ${gaps} without data` : ''}
      </p>
    </section>
  );
}
export default MonthBlock;
