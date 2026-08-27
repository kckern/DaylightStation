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
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { joinLearnerDay, DAY_STATUS_LABEL } from '../learnerDay.js';
import { humanDate, teacherDate, teacherTime, localDay, shiftDay } from '../teacherDates.js';
import { LessonIdentity, SubjectIdentity } from '../CurriculumIdentity.jsx';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherLog } from '../teacherLog.js';
import PanelFrame from './PanelFrame.jsx';
import SessionPaperRecord from './SessionPaperRecord.jsx';

// Client-minted, resource-scoped: the same shape ArtifactReprint uses so a
// double-tap on the print button can never mint two receipts. Not imported
// from WorkspaceViews.jsx, which imports THIS file — that would be a cycle.
const newIdempotencyKey = (prefix) => `${prefix}:${typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID() : `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;

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
  const isToday = studyDay === localDay();
  return (
    <div className="teacher-day-nav">
      <button type="button" className="teacher-btn teacher-btn--quiet" aria-label="Previous day"
        onClick={() => onChangeStudyDay(shiftDay(studyDay, -1))}>←</button>
      <div className="teacher-day-nav__label">
        <strong>{humanDate(studyDay) ?? 'Pick a day'}</strong>
        {isToday && <span className="teacher-day-nav__today">Today</span>}
      </div>
      <button type="button" className="teacher-btn teacher-btn--quiet" aria-label="Next day"
        onClick={() => onChangeStudyDay(shiftDay(studyDay, 1))}>→</button>
      <label className="teacher-day-nav__pick">
        <span>Jump to</span>
        <input type="date" value={studyDay} onChange={(event) => event.target.value && onChangeStudyDay(event.target.value)} />
      </label>
      {!isToday && <button type="button" className="teacher-btn teacher-btn--quiet"
        onClick={() => onChangeStudyDay(localDay())}>Back to today</button>}
    </div>
  );
}

/**
 * The exact image the thermal printer would produce for this day.
 *
 * This is a dry run of the child's own agenda, not a re-layout of it: the
 * teacher sees the physical artifact. `previewAgenda` (BuildAgenda with
 * `previewOnly: true`) renders it with `token: null, tokenClass: 'preview'`
 * and relabels every offer "Preview only — ask a grown-up to start this
 * lesson", so the QR and digit codes on it are inert BY CONSTRUCTION, not by
 * convention. The route is GET-only and sets `X-School-Preview:
 * agenda-non-recording`; no session, ticket, or print record is created,
 * for today or for any other day.
 *
 * Loaded on demand — a printer-resolution PNG is not worth fetching for a
 * teacher who only wanted to read the list.
 */
export function agendaPreviewSrc(learnerId, studyDay) {
  return `/api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda/preview?${new URLSearchParams({ studyDay })}`;
}

export function PrintedAgenda({ learnerId, studyDay }) {
  const [open, setOpen] = useState(false);
  const src = agendaPreviewSrc(learnerId, studyDay);
  return (
    <section className="teacher-printed-agenda">
      <div className="teacher-action-row">
        <button type="button" className="teacher-btn" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide the printed agenda' : 'Show the printed agenda'}
        </button>
        {open && <a className="teacher-btn teacher-btn--quiet" href={src} target="_blank" rel="noreferrer">Open full size ↗</a>}
      </div>
      {open && <>
        <p className="teacher-printed-agenda__promise">
          This is the paper as it would print — but the codes on this copy don’t work. Nothing here starts a lesson.
        </p>
        <img className="teacher-printed-agenda__image" src={src} alt={`Printed agenda for ${humanDate(studyDay) ?? 'the selected day'}`} />
      </>}
    </section>
  );
}

/**
 * The one console path that drives a physical printer — everything above
 * this is a read. `PrintedAgenda` is inert by construction; this is not, and
 * the two must never look like a matched pair. It gets its own box, its own
 * accent, and no shared row with the preview toggle, because that adjacency
 * is exactly where a teacher would stop reading the difference.
 *
 * Dispatch mints against the planner's OWN current day — it takes no
 * `studyDay` — so viewing a past or future day and pressing print would
 * either lie about which day it built, or silently redirect to today without
 * saying so. Neither is acceptable, so the affordance simply isn't here
 * unless the viewed day IS today (compared with `localDay()`, never a UTC
 * date, which flips to tomorrow every evening).
 *
 * Idempotency-Key identity is the whole point: `prepare` mints the key once
 * and shows the plan; `dispatch` reuses that exact key, so a double-tap on
 * "Print it now" cannot become two printed agendas. `cancel` discards the
 * key outright, so a cancelled dispatch can never be replayed later under a
 * key that already looks used — the next prepare mints a fresh one.
 */
function AgendaDispatch({ learnerId, learnerName, studyDay }) {
  const [preview, setPreview] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'agenda-dispatch' });
  const key = `agenda-dispatch:${learnerId}`;

  // Today only — see the block comment above. Hooks above this line still run
  // every render; only the render output is withheld.
  if (studyDay !== localDay()) return null;

  const cancel = () => { setPreview(null); setIdempotencyKey(null); };
  const prepare = () => {
    const requestKey = newIdempotencyKey(key);
    setIdempotencyKey(requestKey);
    run(key, () => teacherWorkspaceApi.agendaDispatchPreview(learnerId, learnerName), { onSuccess: setPreview });
  };
  const dispatch = () => run(key, ({ actorId, pin, stepUpToken }) => teacherWorkspaceApi.agendaDispatch(
    learnerId, { learnerName, dispatchedBy: actorId, pin }, idempotencyKey, stepUpToken,
  ), {
    // Already in STEP_UP_ACTIONS with its own teacherResource branch — this
    // is the pass-through, not a new grant.
    stepUp: { action: 'agenda.dispatch', resource: learnerId },
    onSuccess: () => { teacherLog.write('agenda-dispatched', { learnerId }); cancel(); },
  });

  // The planner already said it can't build this day — printing anyway would
  // hand a child paper the system itself flagged as broken.
  const blocked = preview && (!preview.ready || (preview.errors ?? []).length > 0);
  const subjectCount = preview?.sections?.length ?? 0;

  return (
    <section className="teacher-agenda-dispatch" aria-label="Dispatch today's agenda">
      {!preview && (
        <button type="button" className="teacher-btn teacher-btn--primary" disabled={busy === key} onClick={prepare}>
          Print the day&rsquo;s agenda&hellip;
        </button>
      )}
      {blocked && (
        <div className="teacher-agenda-dispatch__blocked">
          <p>The planner can&rsquo;t build this day yet</p>
          <ul>
            {preview.errors.map((error, index) => (
              // eslint-disable-next-line react/no-array-index-key -- order stable within one preview
              <li key={index}>{typeof error === 'string' ? error : error?.message ?? 'The planner refused an item.'}</li>
            ))}
          </ul>
          <button type="button" className="teacher-btn teacher-btn--quiet" onClick={cancel}>Cancel</button>
        </div>
      )}
      {preview && !blocked && (
        <div className="teacher-agenda-dispatch__ready">
          <p>{subjectCount} subject{subjectCount === 1 ? '' : 's'} will print for {learnerName ?? 'this learner'}.</p>
          <div className="teacher-action-row">
            <button type="button" className="teacher-btn teacher-btn--primary" disabled={busy === key} onClick={dispatch}>
              Print it now
            </button>
            <button type="button" className="teacher-btn" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
      {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
    </section>
  );
}

function DayRow({ row, onOpenSession }) {
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
  const body = session
    ? <LessonIdentity compact subject={subject} courseTitle={session.courseTitle}
        moduleTitle={session.moduleTitle} lessonTitle={title ?? 'Lesson'} posterUrl={session.posterUrl} />
    : <div className="teacher-day-row__unstarted"><SubjectIdentity subject={subject} />
        <strong>{row.planned ?? 'No work offered'}</strong></div>;
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
        {session
          ? <button type="button" className="teacher-day-row__open" onClick={() => onOpenSession(session.sessionId)}>{body}</button>
          : body}
        {detail && <small className="teacher-day-row__detail">{detail}</small>}
      </div>
      <div className="teacher-day-row__right">
        {scoreLine(session) && <span className="teacher-day-row__score">{scoreLine(session)}</span>}
        {session?.sessionId && <SessionPaperRecord sessionId={session.sessionId} lessonTitle={title ?? 'Lesson'} />}
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
              // eslint-disable-next-line react/no-array-index-key -- order stable within one fetch
              <li key={index}>{typeof error === 'string' ? error : error?.message ?? 'The planner refused an item.'}</li>
            ))}
          </ul>
        )}
        <ul className="teacher-day-rows">
          {joined.rows.map((row) => <DayRow key={row.key} row={row} onOpenSession={onOpenSession} />)}
        </ul>
      </PanelFrame>
      {/* Outside the PanelFrame deliberately: PanelFrame renders children
          only in the `ok` state, and "what would today's paper look like?"
          is a fair question on a day with nothing planned or recorded. */}
      <PrintedAgenda learnerId={learnerId} studyDay={studyDay} />
      {/* Keyed on learner+day: a plain re-render (switching Students-rail rows
          reuses this element type at the same position) would otherwise carry
          a stale `preview`/`idempotencyKey` across children — User_5's ready
          count and Idempotency-Key sitting under User_4's name. The key forces
          a remount, which is the only thing that resets that state. */}
      <AgendaDispatch key={`${learnerId}:${studyDay}`} learnerId={learnerId} learnerName={learnerName} studyDay={studyDay} />
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
                  <button type="button" className="teacher-day-row__open" onClick={() => onOpenSession(session.sessionId)}>
                    <LessonIdentity compact subject={session.subject} courseTitle={session.courseTitle}
                      moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? 'Lesson'} posterUrl={session.posterUrl} />
                  </button>
                  <small className="teacher-day-row__detail">
                    Study day {teacherDate(session.studyDay)}
                    {teacherTime(session.processedAt) ? ` · marked ${teacherTime(session.processedAt)}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </PanelFrame>
      )}
    </section>
  );
}
