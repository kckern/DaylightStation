import { UnstyledButton } from '@mantine/core';
import { localTodayISO } from './mealBuckets.js';
import { useBudgetRange } from './useBudgetRange.js';
import { barModel, barCellLabel, fmtKcal } from './dayBars.js';

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`); // noon anchor avoids DST edge shifts
  d.setDate(d.getDate() + n);
  return localTodayISO(d);
};

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A 7-cell day navigator under the macro bars: the 6 days before the viewed
 * date plus the viewed date itself, capped at `today` (so the strip never
 * reaches past today even if `date` somehow did).
 *
 * Each cell is a per-day BUDGET BAR — height is the day's food as a fraction of
 * that day's budget, hue is under/over. That is the whole encoding, on purpose:
 * NO macro segments here (PRD F7.1). A stacked bar in a 40px cell invites
 * reading composition off four pixels of colour, and macros already have an
 * honest home in the tapped day.
 *
 * A day the server could not compute renders HOLLOW — a dashed outline with no
 * track and no fill — never a zero-height bar. "No data" and "ate nothing" are
 * different statements and must not look the same (see dayBars.js).
 *
 * ONE request for the whole strip, not seven: the old implementation fired
 * seven parallel `GET /budget?date=` calls from an effect.
 */
export function WeekStrip({ date, today, onDateChange }) {
  const end = date < today ? date : today;
  const from = addDays(end, -6);
  const { byDate, loading } = useBudgetRange(from, end);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(end, -6 + i));

  return (
    <div className="health-weekstrip" role="group" aria-label="Week navigator" aria-busy={loading}>
      {dates.map((d) => {
        const dt = new Date(`${d}T12:00:00`);
        const day = byDate.get(d) || null;
        const bar = barModel(day);
        const isActive = d === date;
        const isToday = d === today;
        const dayName = dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        // The accessible name announces the TRUE percentage, never the clamped
        // paint — a spoken "100%" for a 140% day would be a false statement —
        // and it names exercise, because the height's denominator (food/budget)
        // and the hue's (budget − food + exercise) are different and a sentence
        // asserting both without the reconciling term contradicts itself.
        const label = barCellLabel(day, bar, dayName);

        return (
          <UnstyledButton key={d}
            className={[
              'health-weekstrip__cell',
              isActive ? 'health-weekstrip__cell--active' : '',
              isToday ? 'health-weekstrip__cell--today' : '',
            ].filter(Boolean).join(' ')}
            aria-current={isActive ? 'date' : undefined}
            aria-label={label}
            onClick={() => onDateChange(d)}>
            <span className="health-weekstrip__dow">{WEEKDAY_LETTERS[dt.getDay()]}</span>
            <span className="health-weekstrip__num">{dt.getDate()}</span>
            <span className="health-weekstrip__barbox" aria-hidden="true">
              <span className="health-weekstrip__goalline" />
              {bar.kind === 'gap' ? (
                <span className="health-weekstrip__bar health-weekstrip__bar--gap" data-testid={`weekbar-gap-${d}`} />
              ) : (
                <span className="health-weekstrip__bar">
                  <span
                    className={`health-weekstrip__fill health-weekstrip__fill--${bar.status}${bar.offsetByExercise ? ' health-weekstrip__fill--offset' : ''}`}
                    data-testid={`weekbar-fill-${d}`}
                    data-height-pct={bar.heightPct}
                    style={{ height: `${bar.heightPct}%` }} />
                </span>
              )}
            </span>
            <span className="health-weekstrip__kcal">{bar.kind === 'gap' ? '—' : fmtKcal(day.food)}</span>
          </UnstyledButton>
        );
      })}
    </div>
  );
}
export default WeekStrip;
