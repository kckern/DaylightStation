import PropTypes from 'prop-types';
import DayGrid from '../shared/dayGrid/DayGrid.jsx';
import './streak.scss';

/**
 * Four weeks of reading, as a wall of days.
 *
 * A THIN COAT OVER `DayGrid`. The wall and the status board's term grid are
 * one concept — a Monday-first week of squares, repeated — in two
 * orientations, and this wrapper only chooses the reading one (weeks as
 * rows, a month deep, counts shown) and the reading names. The colour is the
 * streak, the number is the volume; see `DayGrid` for why a three-book day
 * and a one-book day are the same green.
 *
 * OLDEST FIRST, ending on today, and Monday-aligned — so a gap reads as "I
 * missed Tuesday" rather than as an anonymous hole, and the last filled square
 * is the one a child just filled.
 *
 * The server does the judging (`ReadingApiService#summary`): this draws
 * states, it never compares a count to a target itself. A day nobody asked
 * about is not drawn as a miss — but there are TWO such days and they are not
 * the same square. A weekend arrives as `rest` and is near-transparent: it is
 * the ordinary rhythm, and the wall should read straight through it. A day the
 * household named off arrives as `exempt`, drawn blue and carrying its own
 * name, because Thanksgiving is a thing that happened and a child looking at a
 * blank week in late November is owed the reason.
 */
export default function StreakWall({ days, studyDay = null, className = '', testId = 'reading-streak' }) {
  const cells = Array.isArray(days) ? days.filter(Boolean) : [];
  if (cells.length === 0) return null;
  const met = cells.filter((d) => d.state === 'met').length;
  return (
    <section className={`reading-streak ${className}`.trim()} data-testid={testId}>
      <DayGrid
        days={cells.map((d) => ({ studyDay: d.studyDay, state: d.state ?? 'none', count: d.books,
          // The household calendar's own word for the day, so a blue square can
          // say "Thanksgiving" instead of the generic "a day off".
          label: d.holiday ?? null }))}
        orientation="weeks-as-rows"
        studyDay={studyDay}
        showCount
        className="reading-streak__grid"
        cellClassName="reading-streak__day"
        testId="reading-streak-grid"
        todayTestId="reading-streak-today"
        ariaLabel={`${met} ${met === 1 ? 'day' : 'days'} met in the last ${cells.length} days`}
      />
    </section>
  );
}

StreakWall.propTypes = {
  /** Oldest first, one per day: `{studyDay, books, target, state}`. */
  days: PropTypes.arrayOf(PropTypes.shape({
    studyDay: PropTypes.string,
    books: PropTypes.number,
    state: PropTypes.string,
  })),
  /** Today's study day, so the last square can be marked as theirs. */
  studyDay: PropTypes.string,
  className: PropTypes.string,
  testId: PropTypes.string,
};
