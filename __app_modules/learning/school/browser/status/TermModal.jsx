/**
 * TermModal — one learner's whole term, opened by tapping the two weeks on
 * their status-board card.
 *
 * The card shows only last week and this week; the term lives here. It is
 * read-only — it starts no work — which is why it may open on the Portal,
 * where everything else on the board stays inert. A tap anywhere (or the
 * close button) closes it, and it closes by itself after `AUTO_CLOSE_MS` so
 * the wall is never left showing one child's term.
 *
 * Weeks are columns (time runs left to right), with week numbers above and
 * months below on the same column template as the cells, so a label can only
 * ever sit over its own week. The eighth row appears only when a week carries
 * week-level work.
 */
import { useEffect } from 'react';
import ProfileAvatar from "../../../../../frontend/src/lib/identity/ProfileAvatar.jsx";
import DayGrid from "../shared/dayGrid/DayGrid.jsx";

export const AUTO_CLOSE_MS = 30_000;

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Week numbers (every fourth) and month labels (where a month begins), per week column. */
export function termAxes(weeks) {
  const weekNumbers = weeks.map((w, i) => (i % 4 === 0 ? String(i + 1) : ''));
  let lastMonth = null;
  const months = weeks.map((w) => {
    // The month a week belongs to is the month most of it is in: Thursday's.
    const thursday = new Date(Date.parse(`${w.weekId}T00:00:00Z`) + 3 * 86_400_000);
    const month = thursday.getUTCMonth();
    if (month === lastMonth) return '';
    lastMonth = month;
    return MONTH_SHORT[month];
  });
  return { weekNumbers, months };
}

function TermGrid({ term }) {
  const weeks = Array.isArray(term.weeks) ? term.weeks : [];
  const hasWeeklyWork = weeks.some((w) => (w.asked ?? 0) > 0);
  const { weekNumbers, months } = termAxes(weeks);
  const axisStyle = { '--grid-cols': weeks.length };
  return (
    <div className="school-term-modal__plot">
      <ol className="school-term-modal__axis" style={axisStyle} aria-hidden="true">
        {weekNumbers.map((n, i) => <li key={weeks[i].weekId}>{n}</li>)}
      </ol>
      <DayGrid
        days={(term.days ?? []).map((d) => ({ studyDay: d.studyDay, state: d.state }))}
        orientation="weeks-as-columns"
        from={term.from}
        to={term.to}
        studyDay={term.today ?? null}
        highlightCurrentWeek
        extraRow={hasWeeklyWork ? weeks.map((w) => ({ weekId: w.weekId, state: w.state })) : null}
        className="school-status-board__grid school-term-modal__grid"
        testId="term-modal-grid"
        todayTestId="term-modal-today"
        ariaLabel={`${term.label ?? 'This term'}: ${(term.days ?? []).filter((d) => d.state === 'met').length} days met`}
      />
      <ol className="school-term-modal__axis school-term-modal__axis--months" style={axisStyle} aria-hidden="true">
        {months.map((m, i) => <li key={weeks[i].weekId}>{m}</li>)}
      </ol>
    </div>
  );
}

/**
 * @param {object} props
 * @param {{id: string, name: string}} props.kid
 * @param {object} props.term  a loaded term (`from`, `to`, `days`, `weeks`, `today`)
 * @param {() => void} props.onClose
 */
export default function TermModal({ kid, term, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    // The whole surface closes it: a child should not have to find the ✕.
    <div
      className="school-term-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${kid.name}'s term`}
      onClick={onClose}
    >
      <div className="school-term-modal__sheet">
        <header className="school-term-modal__header">
          <ProfileAvatar id={kid.id} name={kid.name} size={96} />
          <h2 className="school-term-modal__title">{kid.name}</h2>
          <button type="button" className="school-term-modal__close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
          </button>
        </header>
        <TermGrid term={term} />
      </div>
    </div>
  );
}
