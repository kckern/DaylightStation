import { useEffect, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { localTodayISO } from './mealBuckets.js';
import { useBudgetRange } from './useBudgetRange.js';
import { barModel, barCellLabel, fmtKcal } from './dayBars.js';

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`); // noon anchor avoids DST edge shifts
  d.setDate(d.getDate() + n);
  return localTodayISO(d);
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const earlier = (a, b) => (a < b ? a : b);
const monthKey = (iso) => iso.slice(0, 7);
const monthShort = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
const rangeLabel = (from, to) => {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  const left = a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString(undefined, {
    month: a.getMonth() === b.getMonth() ? undefined : 'short', day: 'numeric', year: 'numeric',
  });
  return `${left} – ${right}`;
};

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
  // Selection and viewport are separate state. The old strip used `date` as
  // its right edge, so selecting Tuesday made the entire week jump left and
  // looked like an accidental scroll. A click inside this window now changes
  // only the selection; the arrow controls are the only things that move it.
  const [end, setEnd] = useState(() => earlier(date, today));
  const from = addDays(end, -6);
  const { byDate, loading } = useBudgetRange(from, end);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(end, -6 + i));

  useEffect(() => {
    const capped = earlier(date, today);
    if (capped < from || capped > end) setEnd(capped);
  }, [date, today, from, end]);

  const moveWeek = (days) => {
    const target = earlier(addDays(date, days), today);
    setEnd(target);
    onDateChange(target);
  };

  return (
    <div className="health-weekstrip" role="group" aria-label="Week navigator" aria-busy={loading}>
      <div className="health-weekstrip__nav">
        <UnstyledButton className="health-weekstrip__week-btn" aria-label="Previous week"
          onClick={() => moveWeek(-7)}>‹</UnstyledButton>
        <span className="health-weekstrip__range">{rangeLabel(from, end)}</span>
        <UnstyledButton className="health-weekstrip__week-btn" aria-label="Next week"
          disabled={date >= today} onClick={() => moveWeek(7)}>›</UnstyledButton>
      </div>
      <div className="health-weekstrip__days">
      {dates.map((d, i) => {
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
        const startsMonth = i === 0 || monthKey(d) !== monthKey(dates[i - 1]);
        const crossesMonth = i > 0 && startsMonth;

        return (
          <UnstyledButton key={d}
            className={[
              'health-weekstrip__cell',
              isActive ? 'health-weekstrip__cell--active' : '',
              isToday ? 'health-weekstrip__cell--today' : '',
              crossesMonth ? 'health-weekstrip__cell--month-start' : '',
            ].filter(Boolean).join(' ')}
            aria-current={isActive ? 'date' : undefined}
            aria-label={label}
            onClick={() => onDateChange(d)}>
            <span className="health-weekstrip__month">{startsMonth ? monthShort(d) : ''}</span>
            <span className="health-weekstrip__dow">{WEEKDAY_SHORT[dt.getDay()]}</span>
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
    </div>
  );
}
export default WeekStrip;
