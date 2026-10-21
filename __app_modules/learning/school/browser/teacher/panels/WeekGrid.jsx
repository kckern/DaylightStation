/**
 * The week at a glance, above the Day record (plan Task 17). Columns are days
 * (choose one to open it below), rows are subjects; a cell is the subject's
 * state that day, with its percent when one was recorded.
 *
 * Reads are the Day record's own two non-recording GETs (`agendaPreview` +
 * `teacherDay`), once per day, joined by the same `joinLearnerDay` — so a cell
 * cannot disagree with the day it opens. A day that will not load is marked
 * as unknown in its column; it never takes the other six down with it.
 *
 * On a phone the table scrolls sideways inside the panel; the page does not.
 */
import { schoolApi } from "../../schoolApi.js";
import { usePanelFetch } from "../usePanelFetch.js";
import { weekDays, buildWeek } from "../learnerWeek.js";
import { DAY_STATUS_LABEL } from "../learnerDay.js";
import { humanDate } from "../teacherDates.js";
import { SubjectIdentity, subjectTitle } from "../CurriculumIdentity.jsx";
import { teacherLog } from "../teacherLog.js";
import PanelFrame from "./PanelFrame.jsx";

// The cell's mark, so its state never rides on colour alone. A percent, when
// there is one, says more than any of these.
const STATUS_MARK = { done: '✓', 'in-progress': '…', blocked: '!', deferred: '–', planned: '' };

async function readDay(learnerId, studyDay) {
  try {
    const [agenda, digest] = await Promise.all([schoolApi.agendaPreview(learnerId, studyDay), schoolApi.teacherDay(studyDay)]);
    const rows = Array.isArray(digest?.data) ? digest.data : (digest?.data?.learners ?? []);
    const mine = rows.find((row) => row.learnerId === learnerId) ?? null;
    return {
      studyDay,
      sections: agenda?.data?.sections ?? [],
      sessions: mine?.sessions ?? [],
      // The Day record's carry-over lane: sheets from an earlier day marked on
      // this one. Without it a scanned-late sheet's subject read "Done" with
      // no percent here and "Done · 80%" one tap below.
      carriedOver: (mine?.processedToday ?? []).filter((session) => session.studyDay !== studyDay),
      known: Boolean(agenda?.ok && digest?.ok),
      status: agenda?.ok ? (digest?.status ?? 0) : (agenda?.status ?? 0),
    };
  } catch {
    return { studyDay, sections: [], sessions: [], carriedOver: [], known: false, status: 0 };
  }
}

function dayName(total) {
  const day = humanDate(total.studyDay) ?? total.studyDay;
  if (!total.known) return `${day}, couldn’t load`;
  if (!total.planned) return `${day}, nothing planned`;
  return `${day}, ${total.done} of ${total.planned} done`;
}

export default function WeekGrid({ learnerId, endDay, selectedDay, onSelectDay }) {
  const week = usePanelFetch(async () => {
    const days = await Promise.all(weekDays(endDay).map((studyDay) => readDay(learnerId, studyDay)));
    // Every day failed: that is the panel failing, not seven unknown days.
    // All-404 is the lifecycle routes missing on this install.
    if (days.every((day) => !day.known)) {
      return { ok: false, status: days.every((day) => day.status === 404) ? 404 : (days[0]?.status ?? 0), data: null };
    }
    return { ok: true, status: 200, data: buildWeek(days) };
  }, { deps: [learnerId, endDay], panel: 'learner-week', notFoundAs: 'unavailable', isEmpty: () => false });

  const choose = (studyDay) => {
    teacherLog.nav('week-day', { learnerId, studyDay });
    onSelectDay?.(studyDay);
  };

  const data = week.data;
  return (
    <PanelFrame title="This week" state={week.state} retry={week.retry} unavailableCopy="The week view is unavailable.">
      {data && (
        <div className="teacher-week__scroll">
          <table className="teacher-week">
            <thead>
              <tr>
                <th scope="col"><span className="teacher-visually-hidden">Subject</span></th>
                {data.totals.map((total) => (
                  <th key={total.studyDay} scope="col">
                    <button type="button" aria-pressed={total.studyDay === selectedDay}
                      aria-label={dayName(total)} onClick={() => choose(total.studyDay)}>
                      <span aria-hidden="true">{humanDate(total.studyDay, { short: true })}</span>
                      <small aria-hidden="true">{total.known ? (total.planned ? `${total.done}/${total.planned}` : '—') : '?'}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data.subjects.length && (
                <tr><td colSpan={data.totals.length + 1} className="teacher-week__empty">Nothing was planned or done this week.</td></tr>
              )}
              {data.subjects.map((row) => (
                <tr key={row.subject ?? 'none'}>
                  <th scope="row"><SubjectIdentity subject={row.subject} /></th>
                  {data.totals.map((total) => {
                    const cell = row.cells[total.studyDay];
                    if (!cell) return <td key={total.studyDay} className="teacher-week__cell" />;
                    const percent = cell.percent != null ? `${Math.round(cell.percent)}%` : null;
                    const words = [DAY_STATUS_LABEL[cell.status] ?? 'Recorded', percent].filter(Boolean).join(' · ');
                    return (
                      <td key={total.studyDay} className={`teacher-week__cell teacher-week__cell--${cell.status}`}>
                        {/* Out of the tab order: the day's column button is
                            the keyboard way in, and seven stops per subject
                            would bury it. Still a button, and still named,
                            for a pointer or a screen reader. */}
                        <button type="button" tabIndex={-1} title={words}
                          aria-label={`${subjectTitle(row.subject)}, ${humanDate(total.studyDay)}: ${words}`}
                          onClick={() => choose(total.studyDay)}>
                          {percent ?? STATUS_MARK[cell.status] ?? ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelFrame>
  );
}
