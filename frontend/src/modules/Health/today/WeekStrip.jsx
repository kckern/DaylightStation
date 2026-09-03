import { useEffect, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { localTodayISO } from './mealBuckets.js';

const logger = createAppLogger('health').child('week-strip');

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`); // noon anchor avoids DST edge shifts
  d.setDate(d.getDate() + n);
  return localTodayISO(d);
};

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const fmtKcal = (n) => {
  if (n == null) return '—';
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n)}`;
};

/**
 * A 7-cell day navigator rendered directly under EquationStrip: the 6 days
 * before the viewed date plus the viewed date itself, capped at `today` (so
 * the strip never reaches past today even if `date` somehow did). Each cell
 * shows a weekday letter, day number, compact food-kcal total, and an
 * under/over/no-data status dot; tapping a cell jumps the viewed date.
 *
 * Fetch shape mirrors ProgressView's 14-day adherence effect: one
 * `api/v1/health/budget?date=` request per day via Promise.all, 409 (no
 * weight data that day) tolerated as a gap rather than an error, and the
 * in-flight batch discarded if the component unmounts before it resolves.
 */
export function WeekStrip({ date, today, onDateChange }) {
  const end = date < today ? date : today;
  const [days, setDays] = useState(() => Array.from({ length: 7 }, (_, i) => ({ date: addDays(end, -6 + i), budget: null })));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(end, -6 + i));
    Promise.all(dates.map((d) => DaylightAPI(`api/v1/health/budget?date=${d}`)
      .then((budget) => ({ date: d, budget }))
      .catch((err) => {
        logger.debug('week.day.gap', { date: d, status: err?.status });
        return { date: d, budget: null };
      })))
      .then((results) => { if (live) { setDays(results); setLoading(false); } });
    return () => { live = false; };
  }, [end]);

  return (
    <div className="health-weekstrip" role="group" aria-label="Week navigator" aria-busy={loading}>
      {days.map(({ date: d, budget }) => {
        const dt = new Date(`${d}T12:00:00`);
        const isActive = d === date;
        const status = budget ? budget.status : 'gap';
        return (
          <UnstyledButton key={d}
            className={`health-weekstrip__cell${isActive ? ' health-weekstrip__cell--active' : ''}`}
            aria-current={isActive ? 'date' : undefined}
            aria-label={dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            onClick={() => onDateChange(d)}>
            <span className="health-weekstrip__dow">{WEEKDAY_LETTERS[dt.getDay()]}</span>
            <span className="health-weekstrip__num">{dt.getDate()}</span>
            <span className="health-weekstrip__kcal">{budget ? fmtKcal(budget.food) : '—'}</span>
            <span className={`health-weekstrip__dot health-weekstrip__dot--${status}`} />
          </UnstyledButton>
        );
      })}
    </div>
  );
}
export default WeekStrip;
