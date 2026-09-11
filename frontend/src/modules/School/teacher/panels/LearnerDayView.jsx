/**
 * One child, one study day: what was planned, what was done, what was skipped
 * and why — plus anything graded today that belongs to an earlier day.
 *
 * This is the workspace's organizing unit (UX audit IA2/IA3). It replaces the
 * old split where the plan lived on Overview framed as a "planning preview",
 * the record lived on a dateless History tab, and the dashboard rendered a
 * third copy of both. The two reads it joins are unchanged and side-effect
 * free — previewing a day never creates a session, print, or code.
 */
import { useMemo, useState } from 'react';
import { DateStepper, Sheet } from '../../../../lib/ui/index.js';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { joinLearnerDay, DAY_STATUS_LABEL } from '../learnerDay.js';
import { humanDate, teacherDate, teacherTime, localDay } from '../teacherDates.js';
import { LessonIdentity } from '../CurriculumIdentity.jsx';
import { teacherLog } from '../teacherLog.js';
import PanelFrame from './PanelFrame.jsx';
import { DigestArtifactButtons } from './RosterStrip.jsx';
import { agendaPreviewSrc } from './agendaPreviewSrc.js';
import LaunchPreviewAction from './LaunchPreviewAction.jsx';
import { AgendaDispatch } from './AgendaDispatch.jsx';

// `reviewStatus` is 'pending' | 'complete' | null — null until the session has
// something reviewable, so an untouched lesson no longer carries a verdict.
// The historical 'pending_review' spelling is accepted too, so a backend
// rename cannot silence the label.
const AWAITING = new Set(['pending', 'pending_review']);
const scoreLine = (session) => {
  const score = session?.effectiveScore ?? session?.machineScore;
  if (!score || score.correctCount == null || score.totalCount == null) {
    if (AWAITING.has(session?.reviewStatus)) return 'Awaiting review';
    return typeof session?.gradedPercent === 'number' ? `${Math.round(session.gradedPercent)}%` : null;
  }
  return `${score.correctCount} of ${score.totalCount} correct`;
};

function DayNav({ studyDay, onChangeStudyDay }) {
  return (
    <div className="teacher-day-nav">
      <h3>{humanDate(studyDay) ?? 'Pick a day'}</h3>
      <DateStepper date={studyDay} today={localDay()} label="Today" onChange={onChangeStudyDay} />
      <label className="teacher-day-nav__pick">
        <span>Jump to</span>
        <input type="date" value={studyDay} onChange={(event) => event.target.value && onChangeStudyDay(event.target.value)} />
      </label>
    </div>
  );
}

export function PrintedAgenda({ learnerId, studyDay }) {
  const [open, setOpen] = useState(false);
  const src = agendaPreviewSrc(learnerId, studyDay);
  return (
    <>
      <button type="button" className="teacher-btn" onClick={() => setOpen(true)}>
        Preview printable agenda
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Printable agenda preview">
        <p className="teacher-printed-agenda__promise">
          This is the paper as it would print — but the codes on this copy don’t work. Nothing here starts a lesson.
        </p>
        <img className="teacher-printed-agenda__image" src={src} alt={`Printed agenda for ${humanDate(studyDay) ?? 'the selected day'}`} />
        <a className="teacher-btn teacher-btn--quiet" href={src} target="_blank" rel="noreferrer">Open full size ↗</a>
      </Sheet>
    </>
  );
}

function DayRow({ row, learnerId, onOpenSession }) {
  const session = row.session;
  // The SESSION's subject wins over the section's. The planner buckets
  // non-canonical subjects into 'other', so a unit-matched piano lesson
  // arrives on an 'other' section and would otherwise be filed under a
  // heading reading "Other".
  const subject = session?.subject ?? row.subject;
  const title = session?.lessonTitle ?? session?.title ?? row.planned;
  // A carried-over row is credited to THIS day because it was marked today,
  // but the teacher still needs to know which day assigned it.
  const detail = row.detail ?? (row.carriedOver && session?.studyDay
    ? `Study day ${teacherDate(session.studyDay)}${teacherTime(session.processedAt) ? ` · marked ${teacherTime(session.processedAt)}` : ''}`
    : null);
  // EVERY ROW HAS THE SAME ANATOMY, started or not. An unstarted row used to
  // render a bare subject chip and a title, which is why a day of planned work
  // showed no covers at all: the offer was carrying the resolved taxonomy and
  // the lesson's poster the whole time (see `offer` in learnerDay.js) and this
  // dropped every one of them on the floor.
  //
  // THE TWO SIDES SPELL IT DIFFERENTLY, and that is the trap. A session carries
  // flat `courseTitle`/`moduleTitle`; an offer carries `taxonomy.course` /
  // `taxonomy.unit`. Reading the session's names off an offer yields undefined,
  // which `LessonIdentity` renders as the alarming "Course unavailable" on a
  // row that is perfectly healthy.
  const offerTaxonomy = row.offer?.taxonomy ?? null;
  const courseTitle = session?.courseTitle ?? offerTaxonomy?.course ?? null;
  const moduleTitle = session?.moduleTitle ?? offerTaxonomy?.unit ?? null;
  const posterUrl = session?.posterUrl ?? row.offer?.posterUrl ?? null;
  // Drawn even with nothing to show — a served subject whose program owns its
  // own completion (the reading shelf) has no session AND no offer, and it
  // still deserves the same shape as its neighbours rather than a ragged row.
  const body = (
    <LessonIdentity compact subject={subject}
      courseTitle={courseTitle} moduleTitle={moduleTitle}
      lessonTitle={title ?? row.planned ?? 'No assignment today'} posterUrl={posterUrl} />
  );
  return (
    <li className={`teacher-day-row teacher-day-row--${row.status}`}>
      {/* One vocabulary with the dashboard's lesson cards: the chip is
          progress, the tag is provenance. They must not drift — a reader who
          sees "In progress" here and "Done" there has no way to tell which
          surface is lying. */}
      <span className="teacher-day-row__chips">
        <span className={`teacher-day-chip teacher-day-chip--${row.status}`}>{DAY_STATUS_LABEL[row.status]}</span>
        {row.unplanned && <span className="teacher-day-chip__tag">not on the plan</span>}
      </span>
      <div className="teacher-day-row__body">
        {body}
        {detail && <small className="teacher-day-row__detail">{detail}</small>}
      </div>
      <div className="teacher-day-row__right">
        {scoreLine(session) && <span className="teacher-day-row__score">{scoreLine(session)}</span>}
        <div className="teacher-day-row__actions">
          {session?.sessionId && <button type="button" className="teacher-btn" onClick={() => onOpenSession(session.sessionId)}>Open details</button>}
          <LaunchPreviewAction learnerId={learnerId} subject={subject} label="Preview" />
          {session && <DigestArtifactButtons session={session} onOpen={(kind, openedSession) => {
            teacherLog.nav('artifact-open', { learnerId, sessionId: openedSession.sessionId, kind });
          }} />}
        </div>
      </div>
    </li>
  );
}

export default function LearnerDayView({ learnerId, learnerName, studyDay, onChangeStudyDay, onOpenSession }) {
  const agenda = usePanelFetch(() => schoolApi.agendaPreview(learnerId, studyDay), {
    deps: [learnerId, studyDay], panel: 'learner-day-agenda', notFoundAs: 'unavailable',
  });
  const day = usePanelFetch(() => schoolApi.teacherDay(studyDay), {
    deps: [learnerId, studyDay], panel: 'learner-day-record', notFoundAs: 'unavailable',
  });

  const learnerRow = useMemo(
    () => (day.data?.learners ?? (Array.isArray(day.data) ? day.data : [])).find((row) => row.learnerId === learnerId) ?? null,
    [day.data, learnerId],
  );
  const processed = useMemo(
    () => (learnerRow?.processedToday ?? []).filter((session) => session.studyDay !== studyDay),
    [learnerRow, studyDay],
  );
  const joined = useMemo(() => joinLearnerDay({
    sections: agenda.data?.sections ?? [],
    sessions: learnerRow?.sessions ?? [],
    carriedOver: processed,
    studyDay,
  }), [agenda.data, learnerRow, processed, studyDay]);

  // A carry-over the day's own list already credits must not be listed twice —
  // saying it once is the whole point of this view (IA1).
  const carried = useMemo(
    () => new Set(joined.rows.filter((row) => row.carriedOver).map((row) => row.session?.sessionId)),
    [joined.rows],
  );
  const alsoMarked = processed.filter((session) => !carried.has(session.sessionId));
  // `counts` is keyed by STATUS, which no longer has an `extra` bucket —
  // unplanned work counts under whatever progress it actually made, and is
  // tallied separately from the flag.
  const unplanned = joined.rows.filter((row) => row.unplanned).length;
  const summary = [
    joined.counts.done ? `${joined.counts.done} done` : null,
    joined.counts['in-progress'] ? `${joined.counts['in-progress']} in progress` : null,
    joined.counts.planned ? `${joined.counts.planned} not started` : null,
    joined.counts.deferred ? `${joined.counts.deferred} deferred` : null,
    joined.counts.blocked ? `${joined.counts.blocked} blocked` : null,
    joined.counts.unassigned ? `${joined.counts.unassigned} no assignment` : null,
    unplanned ? `${unplanned} not on the plan` : null,
  ].filter(Boolean).join(' · ');

  // Both reads failing at once is the install-lacks-lifecycle case; one panel
  // notice, not two stacked ones.
  const state = agenda.state === 'unavailable' && day.state === 'unavailable' ? 'unavailable'
    : agenda.state === 'loading' || day.state === 'loading' ? 'loading'
      : agenda.state === 'error' && day.state === 'error' ? 'error'
        : joined.rows.length || alsoMarked.length ? 'ok' : 'empty';

  return (
    <section className="teacher-day" aria-label={`${learnerName ?? learnerId}'s day`}>
      <DayNav studyDay={studyDay} onChangeStudyDay={onChangeStudyDay} />
      <PanelFrame
        title={`${learnerName ?? learnerId}’s work`}
        state={state}
        retry={() => { agenda.retry(); day.retry(); }}
        emptyCopy="Nothing was planned or recorded for this day."
        unavailableCopy="The day record needs the school lifecycle, which isn’t enabled on this install."
      >
        <p className="teacher-day__summary" data-testid="day-summary">{summary || 'Nothing recorded yet.'}</p>
        {(agenda.data?.errors ?? []).length > 0 && (
          <ul className="teacher-workspace__alerts">
            {agenda.data.errors.map((error, index) => (
               
              <li key={index}>{typeof error === 'string' ? error : error?.message ?? 'The planner refused an item.'}</li>
            ))}
          </ul>
        )}
        <ul className="teacher-day-rows">
          {joined.rows.map((row) => <DayRow key={row.key} row={row} learnerId={learnerId} onOpenSession={onOpenSession} />)}
        </ul>
      </PanelFrame>
      {/* Outside the PanelFrame deliberately: PanelFrame renders children
          only in the `ok` state, and "what would today's paper look like?"
          is a fair question on a day with nothing planned or recorded. */}
      <section className="teacher-day-print-tools" aria-labelledby="teacher-day-print-title">
        <div>
          <h2 id="teacher-day-print-title">Printed agenda</h2>
          <p>Preview is inert. Printing sends today&rsquo;s agenda to the physical printer.</p>
        </div>
        <div className="teacher-action-row">
          <PrintedAgenda learnerId={learnerId} studyDay={studyDay} />
          {/* Keyed on learner+day: a plain re-render (switching Students-rail rows
          reuses this element type at the same position) would otherwise carry
          a stale `preview`/`idempotencyKey` across children — User_5's ready
          count and Idempotency-Key sitting under User_4's name. The key forces
          a remount, which is the only thing that resets that state. */}
          <AgendaDispatch key={`${learnerId}:${studyDay}`} learnerId={learnerId} learnerName={learnerName} studyDay={studyDay} />
        </div>
      </section>
      {/* The heading deliberately avoids repeating the row chip's exact words:
          "Graded today" is the per-row label, and the section should not say
          the same phrase twice over one list. */}
      {alsoMarked.length > 0 && (
        <PanelFrame title="Also marked on this date" state="ok">
          <p className="teacher-muted">Work from an earlier study day that was marked on this date.</p>
          <ul className="teacher-day-rows">
            {alsoMarked.map((session) => (
              <li className="teacher-day-row teacher-day-row--processed" key={session.sessionId}>
                <span className="teacher-day-chip teacher-day-chip--processed">Graded today</span>
                <div className="teacher-day-row__body">
                  <LessonIdentity compact subject={session.subject} courseTitle={session.courseTitle}
                    moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? 'Lesson'} posterUrl={session.posterUrl} />
                  <small className="teacher-day-row__detail">
                    Study day {teacherDate(session.studyDay)}
                    {teacherTime(session.processedAt) ? ` · marked ${teacherTime(session.processedAt)}` : ''}
                  </small>
                </div>
                <div className="teacher-day-row__right">
                  {scoreLine(session) && <span className="teacher-day-row__score">{scoreLine(session)}</span>}
                  <div className="teacher-day-row__actions">
                    <button type="button" className="teacher-btn" onClick={() => onOpenSession(session.sessionId)}>Open details</button>
                    <DigestArtifactButtons session={session} onOpen={(kind, openedSession) => {
                      teacherLog.nav('artifact-open', { learnerId, sessionId: openedSession.sessionId, kind });
                    }} />
                    {session.remediation?.activeSessionId && (
                      <button type="button" className="teacher-btn teacher-btn--quiet"
                        onClick={() => onOpenSession(session.remediation.activeSessionId)}>Open active retry →</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </PanelFrame>
      )}
    </section>
  );
}
