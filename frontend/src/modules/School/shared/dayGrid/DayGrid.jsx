import PropTypes from 'prop-types';
import { layoutDayGrid, shortDayLabel } from './dayGridModel.js';
import './dayGrid.scss';

/**
 * Days as squares. The reading streak wall and the status board's term grid
 * are this one component in two orientations; judging stays with whoever
 * hands it the days.
 *
 * TWO CHANNELS, ONE JOB. A cell says one fact at two distances:
 *
 *   COLOUR  did I do my job that day.   Read from across the room.
 *   NUMBER  how much (optional).        Read up close, by a child who is proud.
 *
 * The colour is the streak, deliberately: a three-book day and a one-book day
 * on a one-book target are the same green, because the obligation was met on
 * both. The number is where the extra is acknowledged. Zero is drawn blank,
 * not as a `0` — a nought in every gap turns a quiet week into a wall of
 * noughts.
 *
 * HOST-SIZED AND HOST-COLOURED through custom properties (`--grid-cell`,
 * `--grid-gap`, the `--grid-*` palette): the sofa-distance wall and the
 * 11-pixel board grid are the same stylesheet.
 *
 * The 8th row (`extraRow`) is the term grid's space for WEEK-level work: one
 * cell per week column, coloured by the week's own verdict. Only meaningful
 * with `weeks-as-columns`, and drawn only when given.
 */

const STATE_LABEL = Object.freeze({
  met: 'met the goal',
  partial: 'partly done',
  none: 'nothing done',
  exempt: 'a day off',
  rest: 'a day off',
  unknown: 'not known',
  future: 'not yet',
  'unknown-met': 'done, no goal recorded',
});

export default function DayGrid({
  days, orientation = 'weeks-as-rows', from = null, to = null, studyDay = null,
  showCount = false, extraRow = null, className = '', cellClassName = '',
  testId = 'day-grid', todayTestId = 'day-grid-today', ariaLabel = null,
  highlightCurrentWeek = false,
}) {
  const { cells, rows, cols, weekIds } = layoutDayGrid(days, { orientation, from, to, todayKey: studyDay });
  if (!cells.length) return null;
  // THE CURRENT WEEK, as a whole column (or row): so the eye can jump from
  // the week partition's seven squares to the same seven standing on end.
  const currentWeekId = studyDay && highlightCurrentWeek ? cells.find((c) => c?.today)?.weekId ?? null : null;

  const present = cells.filter(Boolean);
  const met = present.filter((c) => c.state === 'met').length;
  const withExtra = orientation === 'weeks-as-columns' && Array.isArray(extraRow) && extraRow.length > 0;
  const extraByWeek = withExtra ? new Map(extraRow.map((w) => [w.weekId, w])) : null;
  // The current week's column index, for the one band painted behind it.
  const currentCol = currentWeekId != null ? weekIds.indexOf(currentWeekId) : -1;
  const style = {
    '--grid-rows': rows + (withExtra ? 1 : 0), '--grid-cols': cols,
    ...(currentCol >= 0 ? { '--current-col': currentCol } : {}),
  };

  return (
    <ol
      className={`school-daygrid school-daygrid--${orientation}${currentCol >= 0 ? ' school-daygrid--has-current' : ''} ${className}`.trim()}
      style={style}
      data-testid={testId}
      role="img"
      aria-label={ariaLabel ?? `${met} of ${present.length} days met`}
    >
      {cells.map((cell, index) => {
        if (!cell) return <li key={`blank-${index}`} className="school-daygrid__blank" aria-hidden="true" />;
        const count = showCount && cell.count > 0 ? cell.count : '';
        // A day after today has not happened: drawn as an outline, never as a
        // verdict nobody could reach.
        const state = studyDay && cell.studyDay > studyDay ? 'future' : cell.state;
        return (
          <li
            key={cell.studyDay}
            className={`school-daygrid__cell${cell.today ? ' school-daygrid__cell--today' : ''} ${cellClassName}`.trim()}
            data-state={state}
            data-day={cell.studyDay}
            data-testid={cell.today ? todayTestId : undefined}
            // Spoken per square, because the colour is the whole message and a
            // screen reader gets none of it.
            title={`${shortDayLabel(cell.studyDay)}: ${STATE_LABEL[cell.state] ?? cell.state}`}
          >
            <span className="school-daygrid__count">{count}</span>
          </li>
        );
      })}
      {withExtra ? weekIds.map((weekId) => {
        const week = extraByWeek.get(weekId);
        if (!week) return <li key={`week-${weekId}`} className="school-daygrid__blank" aria-hidden="true" />;
        return (
          <li
            key={`week-${weekId}`}
            className="school-daygrid__cell school-daygrid__cell--week"
            data-state={week.state}
            data-week={weekId}
            title={`Week of ${shortDayLabel(weekId)}: ${STATE_LABEL[week.state] ?? week.state}`}
          />
        );
      }) : null}
    </ol>
  );
}

DayGrid.propTypes = {
  /** One per day, any order: `{studyDay, state, count?}`. */
  days: PropTypes.arrayOf(PropTypes.shape({
    studyDay: PropTypes.string,
    state: PropTypes.string,
    count: PropTypes.number,
  })),
  orientation: PropTypes.oneOf(['weeks-as-rows', 'weeks-as-columns']),
  /** Span override; defaults to the days given. */
  from: PropTypes.string,
  to: PropTypes.string,
  /** Today's study day, so its square can be marked as theirs. */
  studyDay: PropTypes.string,
  showCount: PropTypes.bool,
  /** Week-level verdicts, one per week column: `{weekId, state}`. */
  extraRow: PropTypes.arrayOf(PropTypes.shape({ weekId: PropTypes.string, state: PropTypes.string })),
  /** Mark every cell of the week containing `studyDay`. */
  highlightCurrentWeek: PropTypes.bool,
  className: PropTypes.string,
  cellClassName: PropTypes.string,
  testId: PropTypes.string,
  todayTestId: PropTypes.string,
  ariaLabel: PropTypes.string,
};
