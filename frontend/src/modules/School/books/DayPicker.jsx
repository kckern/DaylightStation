/**
 * DayPicker — the reading shelf's "when did you finish it?" control.
 *
 * Not a calendar. A calendar grid is laid out for an adult finding a date; a
 * child remembers "it was Saturday" and works forward. So the weekday is the
 * headline (one header row, Mon … Sun), the date of the month is the small
 * print in each cell, and rows never break at a month boundary — the 31st
 * and the 1st sit in one row, with the month as a footnote on the cell where
 * it changes. Weeks start Monday (ISO, like schoolCalendar), the grid is the
 * last three weeks rolling with the most recent row at the bottom, today is
 * pre-selected and marked, and future days are absent, not greyed.
 *
 * Collapsed, it shows one answer (`Today · Wed 2`) with `pick a day ›` to
 * open the grid; opened, the same `That's the day` confirms. Every tappable
 * fires on touch-down through `useTapFire`, like the rest of the shelf — a
 * wall panel a child jabs at. Nothing here reads the clock: `today` is the
 * caller's key, always. No `<h1>`, no timers, no logging — the parent owns
 * the story.
 *
 * Mount it as `<DayPicker key={today} … />`: the selection is seeded from
 * `today` once, so a midnight rollover under an open overlay remounts with a
 * fresh default instead of leaving yesterday pre-selected and marked.
 *
 * TODO(a11y): read the weekday aloud once the panel has speech. Until then
 * each cell carries an `aria-label` like `Saturday 30 August`.
 */
import { useCallback, useMemo, useState } from 'react';
import useTapFire from '../selfService/useTapFire.js';
import { buildDayGrid, dayLabel, isoWeekday, monthLabel, parseKey, WEEKDAY_LABELS } from './dayGrid.js';

/** `Wed 2` — the short form the collapsed line and the confirm speak. */
function shortLabel(key) {
  const ms = parseKey(key);
  return `${WEEKDAY_LABELS[isoWeekday(ms) - 1]} ${new Date(ms).getUTCDate()}`;
}

/**
 * @param {object} props
 * @param {string} props.today - `YYYY-MM-DD`, the caller's clock. Required;
 *   a bad key throws rather than guessing a grid.
 * @param {string} [props.value] - initial selection; defaults to `today`.
 *   Clamped to `today`: a backdated finish is never a future date.
 * @param {(key: string) => void} props.onConfirm - required; a missing
 *   handler throws on confirm rather than swallowing the child's answer.
 * @param {(key: string) => void} [props.onChange] - fires on every tap.
 */
export default function DayPicker({ today, value, onConfirm, onChange = null }) {
  // Throws on a bad `today` — from render, so the parent hears about it now.
  const rows = useMemo(() => buildDayGrid(today), [today]);
  const tap = useTapFire();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => {
    if (typeof value !== 'string') return today;
    parseKey(value);
    // Keys are `YYYY-MM-DD`, so string order is day order.
    return value > today ? today : value;
  });

  const pick = useCallback((key) => {
    setSelected(key);
    onChange?.(key);
  }, [onChange]);

  const confirm = useCallback(() => {
    onConfirm(selected);
  }, [onConfirm, selected]);

  const summary = selected === today
    ? `Today · ${shortLabel(today)}`
    : shortLabel(selected);

  return (
    <section className="school-books-days" data-testid="daypicker">
      <p className="school-books-days__summary" aria-live="polite">{summary}</p>

      <button
        type="button"
        className="school-books-days__toggle"
        aria-expanded={open}
        {...tap(() => setOpen((o) => !o))}
      >
        {open ? 'close' : 'pick a day ›'}
      </button>

      {open && (
        <div className="school-books-days__grid" role="grid" aria-label="Pick the day you finished">
          <div className="school-books-days__row" role="row">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="school-books-days__head" role="columnheader">{label}</span>
            ))}
          </div>
          {rows.map((row, r) => (
            <div key={row.find(Boolean).key} className="school-books-days__row" role="row">
              {row.map((cell, i) => {
                if (!cell) {
                  // The future is absent: a spacer keeps the column, not a cell.
                  return <span key={`spacer-${i}`} className="school-books-days__spacer" aria-hidden="true" />;
                }
                const isSelected = cell.key === selected;
                // The month is a footnote: only where it changes, plus once at
                // the very start so the first row is not orphaned from its name.
                const showMonth = cell.monthStart || (r === 0 && i === 0);
                const className = [
                  'school-books-days__cell',
                  cell.isToday ? 'is-today' : '',
                  isSelected ? 'is-selected' : '',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={cell.key}
                    type="button"
                    role="gridcell"
                    className={className}
                    aria-label={dayLabel(cell.key)}
                    aria-selected={isSelected}
                    {...tap(() => pick(cell.key))}
                  >
                    {showMonth && <span className="school-books-days__month">{monthLabel(cell.key)}</span>}
                    <span className="school-books-days__day">{cell.day}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <button type="button" className="school-books-days__confirm" {...tap(confirm)}>
        That's the day
      </button>
    </section>
  );
}
