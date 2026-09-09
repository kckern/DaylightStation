import PropTypes from 'prop-types';
import './streak.scss';

/**
 * Four weeks of reading, as a wall of days.
 *
 * TWO CHANNELS, ONE JOB. The taxonomy gives this element J7 — "am I on a
 * streak?" — and it answers with a colour and a number that are not two facts
 * competing for the square, but one fact at two distances:
 *
 *   COLOUR  did I do my job that day.   Read from the sofa, without counting.
 *   NUMBER  how many books.             Read up close, by a child who is proud.
 *
 * The colour is the streak, deliberately. A three-book day and a one-book day
 * on a one-book target are both GREEN, because the obligation was met on both
 * and a wall that rewarded volume would teach a child that meeting the target
 * is not enough. The number is where the extra is acknowledged.
 *
 * OLDEST FIRST, ending on today. Seven columns, so a row is a week and the
 * columns line up as weekdays — which is what makes a gap read as "I missed
 * Tuesday" rather than as an anonymous hole. The last cell is always today, so
 * a child's eye lands on the square they just filled.
 *
 * The server does the judging (`ReadingApiService#summary`): this draws states,
 * it never compares a count to a target itself. A day nobody can judge — no
 * readable target — is drawn as unknown rather than as a failure.
 */

/** The states the server emits, and what each one means on the wall. */
const STATE_LABEL = Object.freeze({
  met: 'met the goal',
  partial: 'read, but under the goal',
  none: 'no reading',
  unknown: 'no goal recorded',
  'unknown-met': 'read',
});

/** `2026-09-09` -> `Sep 9`, for the accessible label only. */
function dayLabel(studyDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(studyDay ?? ''));
  if (!m) return String(studyDay ?? '');
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime())
    ? studyDay
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

export default function StreakWall({ days, studyDay = null, className = '', testId = 'reading-streak' }) {
  const cells = Array.isArray(days) ? days.filter(Boolean) : [];
  if (cells.length === 0) return null;

  const met = cells.filter((d) => d.state === 'met').length;

  return (
    <section
      className={`reading-streak ${className}`.trim()}
      data-testid={testId}
      aria-label={`${met} ${met === 1 ? 'day' : 'days'} met in the last ${cells.length} days`}
    >
      <ol className="reading-streak__grid">
        {cells.map((day) => {
          const today = studyDay != null && day.studyDay === studyDay;
          return (
            <li
              key={day.studyDay}
              className={`reading-streak__day${today ? ' reading-streak__day--today' : ''}`}
              data-state={day.state ?? 'none'}
              data-testid={today ? 'reading-streak-today' : undefined}
              // Spoken per square, because the colour is the whole message and
              // a screen reader gets none of it.
              title={`${dayLabel(day.studyDay)}: ${STATE_LABEL[day.state] ?? day.state}`}
            >
              {/* Zero is drawn as an empty square, not as a `0`. A nought in
                  every gap turns a quiet week into a wall of noughts. */}
              <span className="reading-streak__count">{day.books > 0 ? day.books : ''}</span>
            </li>
          );
        })}
      </ol>
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
