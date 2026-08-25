import { useCallback, useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';
import { usePanelFetch } from './usePanelFetch.js';
import { useTeacherWrite } from './useTeacherWrite.js';
import { labelize } from './labelize.js';
import PanelFrame from './panels/PanelFrame.jsx';
import TodayTab from './tabs/TodayTab.jsx';
import RecordsTab from './tabs/RecordsTab.jsx';
import AssignmentsView from './panels/AssignmentsView.jsx';
import PianoProgramsPanel from './panels/PianoProgramsPanel.jsx';
import MilestonesPanel from './panels/MilestonesPanel.jsx';
import SchoolMatrix from './panels/SchoolMatrix.jsx';
import CurriculumBrowser from './panels/CurriculumBrowser.jsx';
import CurriculumCatalog from './panels/CurriculumCatalog.jsx';
import ActiveOverrides from './panels/ActiveOverrides.jsx';
import PeriodsTimeline from './panels/PeriodsTimeline.jsx';
import EnrichmentPanel from './panels/EnrichmentPanel.jsx';
import ReviewQueueView from './panels/ReviewQueueView.jsx';
import PrintPendingView from './panels/PrintPendingView.jsx';
import QuizRequestBacklog from './panels/QuizRequestBacklog.jsx';
import FeedbackNotes, { NoteComposer } from './panels/FeedbackNotes.jsx';
import AttestationPanel from './panels/AttestationPanel.jsx';
import ReassignPanel from './panels/ReassignPanel.jsx';
import StaleSessions from './panels/StaleSessions.jsx';
import IssuedArtifactCard from './panels/IssuedArtifactCard.jsx';
import { LessonIdentity, SubjectIdentity } from './CurriculumIdentity.jsx';
import { teacherBaseFor } from './teacherUrl.js';
import { curriculumTitles } from './curriculumTitles.js';
import { localDay, humanDate, humanDateTime } from './teacherDates.js';

const sessionIdOf = (session) => session?.sessionId ?? session?.id ?? null;
const dateOf = (session) => session?.updatedAt ?? session?.closedAt ?? session?.createdAt ?? session?.issuedAt ?? null;
const stateOf = (session) => session?.state ?? session?.status ?? session?.outcome?.result ?? session?.result ?? 'unknown';
const scoreLine = (session) => {
  const score = session?.effectiveScore ?? session?.machineScore;
  if (!score || score.correctCount == null || score.totalCount == null) return null;
  return `${score.correctCount} of ${score.totalCount} correct${score.percent == null ? '' : ` · ${score.percent}%`}`;
};
const outcomeLabel = (sessionState) => {
  const outcome = sessionState?.outcome?.result;
  if (outcome === 'passed' || ['closed', 'completed'].includes(sessionState?.state)) return 'Completed';
  if (outcome === 'needs_remediation') return 'Needs review';
  return labelize(sessionState?.state ?? outcome ?? 'Recorded');
};
const choiceLetter = (index) => String.fromCharCode(65 + index);
// The honest answer line: "Their answer: X · Correct answer: Y (C) · Incorrect".
// The letter is derived from the worksheet's own choice order; when the child
// was right, repeating the correct answer is redundant and is omitted.
const recordedAnswerLine = (item, question = null) => {
  const answer = item.given ?? 'No recorded answer';
  const verdict = item.verdict ? ` · ${labelize(item.verdict)}` : '';
  if (item.verdict === 'correct' || !item.expected?.length) return `Their answer: ${answer}${verdict}`;
  const letterOf = (text) => {
    const index = (question?.choices ?? []).findIndex((choice) => (choice.text ?? choice.label ?? choice) === text);
    return index >= 0 ? ` (${choiceLetter(index)})` : '';
  };
  return `Their answer: ${answer} · Correct answer: ${item.expected.map((expected) => `${expected}${letterOf(expected)}`).join(', ')}${verdict}`;
};

function CapabilityNotice({ children }) {
  return <p className="teacher-capability-notice">{children}</p>;
}

function useAuthorizedTeacherRead() {
  // Authentication will wrap the teacher route as a whole. Until then, the
  // presence of this surface is the read boundary; a record read must not
  // force a local profile claim or silently turn into a sign-in failure.
  return useCallback(async (read) => read(), []);
}

const newIdempotencyKey = (prefix) => `${prefix}:${typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;

function AgendaPreview({ learnerId, learnerName, studyDay, onStudyDayChange }) {
  const plan = usePanelFetch(() => schoolApi.agendaPreview(learnerId, studyDay), {
    deps: [learnerId, studyDay], panel: 'workspace-agenda', notFoundAs: 'unavailable',
    isEmpty: (data) => !(data?.sections ?? []).length,
  });
  const [imageOpen, setImageOpen] = useState(false);
  const day = usePanelFetch(() => (schoolApi.teacherDay
    ? schoolApi.teacherDay(studyDay)
    : Promise.resolve({ ok: true, status: 200, data: { learners: [] } })), {
    deps: [learnerId, studyDay], panel: 'workspace-agenda-day', notFoundAs: 'unavailable',
  });
  const completedBySubject = useMemo(() => {
    const learner = (day.data?.learners ?? []).find((row) => row.learnerId === learnerId);
    return new Map((learner?.sessions ?? [])
      .filter((session) => session.outcome?.result === 'passed')
      .map((session) => [session.subject, session]));
  }, [day.data, learnerId]);
  const pngUrl = `/api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda/preview?${new URLSearchParams({ studyDay })}`;

  return (
    <section className="teacher-agenda-preview-panel" aria-label="Agenda planning preview">
      <div className="teacher-action-row teacher-agenda-preview__day-picker">
        <label htmlFor={`agenda-study-day-${learnerId}`}>Study day</label>
        <input id={`agenda-study-day-${learnerId}`} type="date" value={studyDay} onChange={(event) => onStudyDayChange(event.target.value)} />
      </div>
      <p className="teacher-caption">Planning preview only — this never creates a session, agenda artifact, print record, working QR, or digit code.</p>
      <PanelFrame
        title={`Agenda preview for ${humanDate(studyDay) ?? 'selected day'}`}
        state={plan.state}
        retry={plan.retry}
        emptyCopy="Nothing is scheduled for this study day."
        unavailableCopy="Agenda planning is not enabled on this install."
      >
      {(plan.data?.errors ?? []).length > 0 && (
        <ul className="teacher-workspace__alerts">
          {plan.data.errors.map((error, index) => (
            <li key={index}>{typeof error === 'string' ? error : error?.message ?? 'The planner refused an item.'}</li>
          ))}
        </ul>
      )}
      <ol className="teacher-agenda-list">
        {(plan.data?.sections ?? []).map((section) => (
          <li key={section.subject ?? section.id}>
            <SubjectIdentity subject={section.subject} />
            <span>{section.servedToday
              ? (() => {
                const completed = completedBySubject.get(section.subject);
                return completed
                  ? `${completed.lessonTitle ?? 'Lesson'} completed on this study day${scoreLine(completed) ? ` · ${scoreLine(completed)}` : ''}`
                  : 'This study day is complete';
              })()
              : section.suppressed
                ? `Deferred for ${section.suppressed.bySubject} focus`
                : section.next?.title ?? section.next?.label ?? section.lockedRemedy ?? section.timingNotice ?? 'No work offered'}</span>
          </li>
        ))}
      </ol>
      <div className="teacher-action-row">
        <button type="button" onClick={() => setImageOpen((open) => !open)}>{imageOpen ? 'Hide print preview' : 'View print preview'}</button>
        <a href={pngUrl} target="_blank" rel="noreferrer">Open preview image</a>
      </div>
      {imageOpen && <img className="teacher-agenda-preview" src={pngUrl} alt="Rendered agenda preview" />}
      </PanelFrame>
    </section>
  );
}

function SessionList({ learnerId, onOpenSession, window = null, studyDay = null }) {
  const authorizedRead = useAuthorizedTeacherRead();
  const [additional, setAdditional] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sessions = usePanelFetch(async () => {
    if (window === 'today' || studyDay) {
      if (!schoolApi.teacherDay) return schoolApi.learnerSessions(learnerId, { window });
      const response = await schoolApi.teacherDay(studyDay);
      if (!response.ok) return response;
      const learner = (response.data?.learners ?? []).find((row) => row.learnerId === learnerId);
      return { ...response, data: { sessions: learner?.sessions ?? [] } };
    }
    const timeline = await authorizedRead(() => teacherWorkspaceApi.timeline(learnerId));
    if (timeline.status !== 404) return { ...timeline, data: timeline.data ? { sessions: timeline.data.items ?? [], nextCursor: timeline.data.nextCursor } : null };
    return schoolApi.learnerSessions(learnerId);
  }, {
    deps: [learnerId, window, studyDay], panel: 'workspace-sessions', notFoundAs: 'unavailable',
    isEmpty: (data) => !(data?.sessions ?? []).length,
  });
  useEffect(() => { setAdditional([]); setNextCursor(sessions.data?.nextCursor ?? null); }, [learnerId, sessions.data]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const response = await authorizedRead(() => teacherWorkspaceApi.timeline(learnerId, { before: nextCursor }));
    if (response.ok) {
      setAdditional((rows) => [...rows, ...(response.data?.items ?? [])]);
      setNextCursor(response.data?.nextCursor ?? null);
    }
    setLoadingMore(false);
  };
  const rows = [...(sessions.data?.sessions ?? []), ...additional];
  return (
    <PanelFrame title={studyDay ? `Sessions for ${humanDate(studyDay) ?? 'selected day'}` : window === 'today' ? 'Today’s sessions' : 'Session history'} state={sessions.state} retry={sessions.retry} emptyCopy="No sessions recorded." unavailableCopy="Session history is not enabled on this install.">
      <ul className="teacher-session-list">
        {rows.map((session, index) => {
          const id = sessionIdOf(session);
          return (
            <li key={id ?? index}>
              <button type="button" onClick={() => id && onOpenSession(id)} disabled={!id}>
                <span><LessonIdentity subject={session.subject} courseTitle={session.courseTitle} moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? session.title ?? 'Lesson title unavailable'} posterUrl={session.posterUrl} compact /><small>{humanDate(session.studyDay ?? dateOf(session)) ?? 'No date'}{scoreLine(session) ? ` · ${scoreLine(session)}` : ''}</small></span>
                <span className={`teacher-status teacher-status--${stateOf(session)}`}>{session.outcome?.result === 'passed' ? 'Completed' : labelize(stateOf(session))}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!window && nextCursor && <button type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load older sessions'}</button>}
    </PanelFrame>
  );
}

export function DashboardView({ kids, onSelectLearner, onOpenQueue }) {
  // The sidebar/students nav already navigates to workspaces; a duplicate
  // card grid promising "agenda … and repair" (names the tabs don't use)
  // was pure drift (UX audit F25/F26). The dashboard is the Today digest
  // plus a compact backlog summary — the queue owns the full lists.
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading">
        <div><p className="teacher-view__eyebrow">Household school</p><h2>Today at a glance</h2><p>Start with what needs a grown-up, then move into a learner’s day.</p></div>
        <button type="button" className="teacher-primary" onClick={onOpenQueue}>Open action queue</button>
      </div>
      <TodayTab kids={kids} onOpenQueue={onOpenQueue} />
    </div>
  );
}

export function QueueView({ kids }) {
  const review = usePanelFetch(() => schoolApi.lifecycleReview(), { panel: 'queue-review', notFoundAs: 'unavailable', isEmpty: (d) => !(d?.items ?? []).length });
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Action queue</p><h2>Needs a grown-up</h2><p>Review, print, and learner requests in one interruption-friendly list.</p></div></div>
      <PanelFrame title="Grading & review" state={review.state} retry={review.retry} emptyCopy="Nothing is waiting for a mark." unavailableCopy="The review queue is unavailable.">
        <ReviewQueueView items={review.data?.items ?? []} kids={kids} onResolved={review.retry} />
      </PanelFrame>
      <PrintPendingView kids={kids} />
      <QuizRequestBacklog kids={kids} />
    </div>
  );
}

export function LearnerOverview({ learnerId, learnerName, onOpenSession }) {
  const [studyDay, setStudyDay] = useState(() => localDay());
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Student workspace</p><h2>{learnerName}&rsquo;s workspace</h2><p>Preview a chosen day, then inspect its progress, blockers, and useful teacher actions.</p></div></div>
      <AgendaPreview learnerId={learnerId} learnerName={learnerName} studyDay={studyDay} onStudyDayChange={setStudyDay} />
      <SessionList learnerId={learnerId} studyDay={studyDay} onOpenSession={onOpenSession} />
      <MilestonesPanel learnerId={learnerId} />
    </div>
  );
}

function CourseContext({ courseId, lessonId = null, learnerId = null }) {
  const base = teacherBaseFor(globalThis.location?.pathname ?? '');
  const authorizedRead = useAuthorizedTeacherRead();
  const context = usePanelFetch(() => authorizedRead(() => (learnerId
    ? teacherWorkspaceApi.learnerCourse(learnerId, courseId)
    : lessonId ? teacherWorkspaceApi.lesson(courseId, lessonId) : teacherWorkspaceApi.course(courseId))), {
    deps: [courseId, lessonId, learnerId], panel: 'course-context', notFoundAs: 'unavailable',
  });
  const data = context.data;
  const course = data?.course ?? data;
  const units = (data?.units?.length ? data.units : (data?.lessonId ? [data] : []));
  return (
    <PanelFrame title={course?.courseTitle ?? course?.title ?? 'Course'} state={context.state} retry={context.retry} unavailableCopy="This course context is unavailable.">
      <div className="teacher-course-context">
        {(course?.posterUrl ?? data?.posterUrl) && <img src={course.posterUrl ?? data.posterUrl} alt={`${course?.courseTitle ?? course?.title ?? 'Course'} cover`} />}
        <div>
          <SubjectIdentity subject={course?.subject} />
          <p>{[course?.moduleTitle, course?.lessonTitle].filter(Boolean).join(' · ')}</p>
          {data?.total != null && <p><strong>{data.completed} of {data.total}</strong> lessons complete</p>}
          <ol>
            {units.map((unit) => (
              <li key={unit.unitId ?? unit.lessonId}>
                <a href={`${base}/curriculum/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(unit.unitId ?? unit.lessonId)}`}>
                  <LessonIdentity
                    compact
                    subject={unit.subject ?? course?.subject}
                    courseTitle={unit.courseTitle ?? course?.courseTitle ?? course?.title}
                    moduleTitle={unit.moduleTitle ?? null}
                    lessonTitle={unit.title ?? 'Lesson title unavailable'}
                    posterUrl={unit.posterUrl ?? course?.posterUrl ?? data?.posterUrl}
                  />
                </a>
                {unit.hasDocument && (
                  <a className="teacher-curriculum__preview" href={teacherWorkspaceApi.lessonPreviewUrl(courseId, unit.unitId ?? unit.lessonId)} target="_blank" rel="noreferrer">
                    Preview worksheet
                  </a>
                )}
                <span className={`teacher-status teacher-status--${unit.status ?? 'remaining'}`}>{labelize(unit.status ?? 'remaining')}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </PanelFrame>
  );
}

function CurriculumExceptionPanel({ kids = [], courseId = '', lessonId = '' }) {
  const authorizedRead = useAuthorizedTeacherRead();
  const [refresh, setRefresh] = useState(0);
  const exceptions = usePanelFetch(() => authorizedRead(() => teacherWorkspaceApi.curriculumExceptions()), {
    deps: [refresh], panel: 'curriculum-exceptions', notFoundAs: 'unavailable',
  });
  const catalog = usePanelFetch(() => schoolApi.curriculumUnits(), {
    panel: 'curriculum-exceptions-catalog', notFoundAs: 'unavailable',
  });
  const units = catalog.data?.units ?? [];
  const titles = curriculumTitles(units);
  const courseIds = [...new Set(units.map((unit) => unit.courseId).filter(Boolean))];
  const modules = [...new Set(units.map((unit) => unit.module).filter(Boolean))];
  // Neutral by default: the most drastic decision and a preselected reason
  // must never be the zero-interaction path.
  const [form, setForm] = useState({ kind: '', learnerId: '', targetType: 'lesson',
    targetId: lessonId, courseId, replacementLessonId: '', reason: '' });
  const [preview, setPreview] = useState(null);
  const [retracting, setRetracting] = useState(null);
  const [retractReason, setRetractReason] = useState('');
  const { run, busy, errors } = useTeacherWrite({ panel: 'curriculum-exceptions' });
  const change = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      const selectedUnit = field === 'targetId' && current.targetType === 'lesson'
        ? units.find((unit) => unit.unitId === value) : null;
      return { ...current, [field]: value,
        ...(selectedUnit ? { courseId: selectedUnit.courseId ?? '' } : {}),
        ...(field === 'kind' && value === 'paused' ? { learnerId: '', reason: '' } : {}) };
    });
    setPreview(null);
  };
  const valid = form.kind && form.targetId.trim() && form.reason.trim() && (form.kind === 'paused' || form.learnerId)
    && (form.kind !== 'replaced' || form.replacementLessonId.trim());
  const save = (apply) => run(`exception-${apply ? 'apply' : 'preview'}`, (auth) => teacherWorkspaceApi.changeCurriculumException({
    ...form, learnerId: form.kind === 'paused' ? null : form.learnerId, courseId: form.courseId || null,
    replacementLessonId: form.kind === 'replaced' ? form.replacementLessonId : null,
    decidedBy: auth.actorId, pin: auth.pin, apply,
  }, auth.stepUpToken), { onSuccess: (data) => { setPreview(data); if (apply) setRefresh((n) => n + 1); },
    stepUp: apply ? () => ({ action: 'curriculum-exception.apply', resource: form.targetId }) : null });
  const retract = (exception) => {
    run(`retract-${exception.exceptionId}`, (auth) => teacherWorkspaceApi.retractCurriculumException(exception.exceptionId,
      { reason: retractReason.trim(), retractedBy: auth.actorId, pin: auth.pin, apply: true }, auth.stepUpToken),
    { onSuccess: () => { setRetracting(null); setRetractReason(''); setRefresh((n) => n + 1); },
      stepUp: () => ({ action: 'curriculum-exception.retract', resource: exception.exceptionId }) });
  };
  return <PanelFrame title="Curriculum exceptions" state={exceptions.state} retry={exceptions.retry} unavailableCopy="Curriculum exceptions are not enabled."><div className="teacher-exception-panel"><div className="teacher-form-grid">
    <label>Decision<select value={form.kind} onChange={change('kind')}><option value="">Choose…</option><option value="excused">Excused</option><option value="deferred">Deferred</option><option value="replaced">Replaced</option><option value="paused">Paused globally</option></select></label>
    {form.kind !== 'paused' && <label>Student<select value={form.learnerId} onChange={change('learnerId')}><option value="">Choose…</option>{kids.map((kid) => <option key={kid.id} value={kid.id}>{kid.name ?? kid.id}</option>)}</select></label>}
    <label>Target<select value={form.targetType} onChange={change('targetType')}><option value="lesson">Lesson</option><option value="module">Unit / module</option></select></label>
    <label>{form.targetType === 'lesson' ? 'Lesson' : 'Unit / module'}<select value={form.targetId} onChange={change('targetId')}><option value="">Choose…</option>{form.targetType === 'lesson' ? units.map((unit) => <option key={unit.unitId} value={unit.unitId}>{titles.lesson(unit.unitId)}</option>) : modules.map((module) => <option key={module} value={module}>{labelize(module)}</option>)}</select></label>
    <label>Course<select value={form.courseId} onChange={change('courseId')}><option value="">Any course</option>{courseIds.map((id) => <option key={id} value={id}>{titles.course(id)}</option>)}</select></label>
    {form.kind === 'replaced' && <label>Replacement lesson<select value={form.replacementLessonId} onChange={change('replacementLessonId')}><option value="">Choose…</option>{units.map((unit) => <option key={unit.unitId} value={unit.unitId}>{titles.lesson(unit.unitId)}</option>)}</select></label>}
    <label>Reason{form.kind === 'paused' ? <select value={form.reason} onChange={change('reason')}><option value="">Choose…</option><option value="defective">Defective</option><option value="garbled">Garbled</option><option value="missing">Missing</option><option value="broken">Broken</option><option value="inappropriate">Inappropriate</option></select> : <input value={form.reason} onChange={change('reason')} />}</label>
  </div><div className="teacher-action-row"><button type="button" disabled={!valid || busy} onClick={() => save(false)}>Preview</button>{preview && !preview.applied && <button type="button" disabled={busy} onClick={() => save(true)}>Apply exception</button>}</div>
  {errors['exception-preview'] && <p role="alert">{errors['exception-preview']}</p>}{errors['exception-apply'] && <p role="alert">{errors['exception-apply']}</p>}
  {preview?.effects && <p>Gate: {preview.effects.advancesGate ? 'satisfied without mastery' : preview.effects.remainsOutstanding ? 'still outstanding' : preview.effects.blocksNewWork ? 'new work blocked' : 'unchanged'}.</p>}
  <ul>{(exceptions.data?.active ?? []).map((exception) => <li key={exception.exceptionId}><strong>{labelize(exception.kind)}</strong> · {exception.learnerId ?? 'Everyone'} · {exception.targetType === 'lesson' ? titles.lesson(exception.targetId) : labelize(exception.targetId)} · {exception.reason} {retracting === exception.exceptionId
    ? <span className="teacher-action-row">
      <input aria-label={`Retraction reason for ${exception.exceptionId}`} maxLength={240} placeholder="Why retract this?" value={retractReason} onChange={(event) => setRetractReason(event.target.value)} />
      <button type="button" disabled={busy || !retractReason.trim()} onClick={() => retract(exception)}>Confirm retraction</button>
      <button type="button" onClick={() => { setRetracting(null); setRetractReason(''); }}>Cancel</button>
    </span>
    : <button type="button" disabled={busy} onClick={() => { setRetracting(exception.exceptionId); setRetractReason(''); }}>Retract</button>}</li>)}</ul>
  </div></PanelFrame>;
}

export function CoursesView({ learnerId, learnerName, courseId, kids }) {
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Courses & enrollment</p><h2>{courseId ? 'Course details' : `${learnerName}’s program`}</h2><p>Operate published courses, enrollment, timing, pass bars, and milestones.</p></div></div>
      {courseId && <CourseContext courseId={courseId} learnerId={learnerId} />}
      <AssignmentsView learnerId={learnerId} learnerName={learnerName} />
      <PianoProgramsPanel learnerId={learnerId} />
      <MilestonesPanel learnerId={learnerId} />
    </div>
  );
}

export function HistoryView({ learnerId, learnerName, onOpenSession }) {
  const [feedbackRefresh, setFeedbackRefresh] = useState(0);
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Student history</p><h2>{learnerName} over time</h2><p>Sessions and feedback remain separate evidence lanes, joined here chronologically.</p></div></div>
      <SessionList learnerId={learnerId} onOpenSession={onOpenSession} />
      <FeedbackNotes key={feedbackRefresh} learnerId={learnerId} learnerName={learnerName} />
      <NoteComposer learnerId={learnerId} learnerName={learnerName} onSent={() => setFeedbackRefresh((n) => n + 1)} />
    </div>
  );
}

export function ReportsView({ learnerId, kids }) {
  return <div className="teacher-view"><div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Reports & diagnosis</p><h2>Progress, grades, and pacing</h2><p>Live evidence, frozen records, mastery signals, retries, and blockers—without comparing siblings.</p></div></div><RecordsTab learnerId={learnerId} kids={kids} /></div>;
}

export function LearnerOperationsView({ learnerId, learnerName, kids }) {
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Student operations</p><h2>Repair {learnerName}’s record</h2><p>Use the narrowest intervention that matches what actually happened. Every write is attributed and auditable.</p></div></div>
      <AttestationPanel learnerId={learnerId} learnerName={learnerName} />
      <ReassignPanel learnerId={learnerId} learnerName={learnerName} kids={kids} />
      <StaleSessions kids={kids} />
    </div>
  );
}

export function CurriculumView({ kids, courseId = null, lessonId = null }) {
  // Landing state = the course catalog (cards, one per course). Lessons and
  // per-lesson pass bars live on the drill-in page only (UX audit C10).
  return <div className="teacher-view"><div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Published curriculum</p><h2>{courseId ? 'Course curriculum' : 'Courses, units, and policy'}</h2><p>Inspect and operate published curriculum. Authoring remains in reviewed source files.</p></div></div>
    {courseId ? <>
      <CourseContext courseId={courseId} lessonId={lessonId} />
      <CurriculumBrowser courseId={courseId} />
      <CurriculumExceptionPanel kids={kids} courseId={courseId} lessonId={lessonId ?? ''} />
    </> : <>
      <CurriculumCatalog />
      <SchoolMatrix kids={kids} />
      <CurriculumExceptionPanel kids={kids} courseId="" lessonId="" />
      <PeriodsTimeline />
      <EnrichmentPanel kids={kids} />
    </>}
  </div>;
}

export function OperationsView({ kids }) {
  return <div className="teacher-view"><div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">School operations</p><h2>Health, gates, and exceptions</h2><p>Find systematic blockers before changing a student record.</p></div></div><CurriculumExceptionPanel kids={kids} /><StaleSessions kids={kids} /><ActiveOverrides kids={kids} /><PeriodsTimeline /><BulkRegradePanel /><CapabilityNotice>Device health and retained-artifact audit will appear here when their teacher read models are available.</CapabilityNotice></div>;
}

function BulkRegradePanel() {
  const today = localDay();
  const [form, setForm] = useState({ bankId: '', fromDay: today, toDay: today, reason: '' });
  const [preview, setPreview] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'bulk-regrade' });
  const key = 'bulk-regrade';
  const valid = form.bankId.trim() && form.reason.trim() && form.fromDay && form.toDay && form.fromDay <= form.toDay;
  const body = ({ actorId, pin }, apply) => ({
    ...form, bankId: form.bankId.trim(), reason: form.reason.trim(), regradedBy: actorId, pin, apply,
  });
  const change = (field) => (event) => {
    setForm((value) => ({ ...value, [field]: event.target.value }));
    setPreview(null);
  };
  const previewRegrade = () => run(key, (auth) => schoolApi.regradeAttempts(body(auth, false)), { onSuccess: setPreview });
  const applyRegrade = () => run(key, (auth) => schoolApi.regradeAttempts(body(auth, true), auth.stepUpToken), {
    stepUp: { action: 'attempts.regrade', resource: form.bankId.trim() },
    onSuccess: setPreview,
  });
  return (
    <section className="teacher-panel teacher-bulk-regrade">
      <h3 className="teacher-panel__title">Systematic regrade</h3>
      <p>Re-run the current bank grader over a bounded date range. Previewing changes nothing; applying appends corrective evidence.</p>
      <div className="teacher-form-grid">
        <label>Bank ID<input value={form.bankId} onChange={change('bankId')} placeholder="subject/course/bank" /></label>
        <label>From<input type="date" value={form.fromDay} onChange={change('fromDay')} /></label>
        <label>Through<input type="date" value={form.toDay} onChange={change('toDay')} /></label>
        <label>Reason<input value={form.reason} onChange={change('reason')} maxLength="240" placeholder="What systematic grading rule changed?" /></label>
      </div>
      {preview && <div className="teacher-action-preview"><strong>{preview.applied ? 'Regrade applied' : 'Impact preview'}</strong><p>{preview.checked} attempts checked; {preview.changed?.length ?? 0} corrections; {preview.sessionsAffected?.length ?? 0} sessions affected.</p></div>}
      <div className="teacher-action-row">
        <button type="button" disabled={!valid || busy === key} onClick={previewRegrade}>Preview regrade</button>
        {preview && !preview.applied && <button type="button" className="teacher-danger-btn" disabled={busy === key} onClick={applyRegrade}>Apply {preview.changed?.length ?? 0} corrections</button>}
      </div>
      {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
    </section>
  );
}

function GradeCorrection({ sessionId, revision, currentPercent, items = [], onApplied }) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(currentPercent == null ? '' : String(Math.round(currentPercent)));
  const [reason, setReason] = useState('');
  const [verdicts, setVerdicts] = useState(() => Object.fromEntries(items.map((item) => [item.itemId, 'unchanged'])));
  const [preview, setPreview] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'grade-adjustment' });
  const key = `grade:${sessionId}`;
  const itemLevel = items.length > 0;
  const valid = reason.trim() && (itemLevel || (Number.isFinite(Number(percent)) && Number(percent) >= 0 && Number(percent) <= 100));
  const body = ({ actorId, pin }, apply) => ({
    ...(itemLevel ? { itemVerdicts: items.map((item) => ({ itemId: item.itemId, verdict: verdicts[item.itemId] ?? 'unchanged' })) }
      : { percent: Number(percent) }),
    reason: reason.trim(), adjustedBy: actorId, pin,
    baseSeq: preview?.baseSeq ?? revision, adjustmentId: preview?.adjustmentId, apply,
  });
  const previewChange = () => run(key, (auth) => teacherWorkspaceApi.adjustGrade(sessionId, body(auth, false)), { onSuccess: setPreview });
  const applyChange = () => run(key, (auth) => teacherWorkspaceApi.adjustGrade(sessionId, body(auth, true), auth.stepUpToken), {
    onSuccess: () => { setPreview(null); setOpen(false); onApplied?.(); },
    stepUp: { action: 'sessions.grade-adjust', resource: sessionId },
  });
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Correct grade…</button>;
  return (
    <div className="teacher-grade-correction">
      {!itemLevel && <label>Effective percent <input aria-label="Effective percent" type="number" min="0" max="100" value={percent} onChange={(event) => { setPercent(event.target.value); setPreview(null); }} /></label>}
      <label>Reason <input aria-label="Grade correction reason" maxLength="240" placeholder="What did the machine get wrong?" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} /></label>
      {itemLevel && <fieldset className="teacher-item-verdicts"><legend>Printed questions</legend>{items.map((item, index) => <label key={item.itemId}><span>Question {item.questionNumber ?? index + 1}<small>Machine: {labelize(item.verdict ?? 'unresolved')}</small></span><select aria-label={`Verdict for ${item.itemId}`} value={verdicts[item.itemId] ?? 'unchanged'} onChange={(event) => { setVerdicts((current) => ({ ...current, [item.itemId]: event.target.value })); setPreview(null); }}><option value="unchanged">Unchanged</option><option value="correct">Correct</option><option value="incorrect">Incorrect</option></select></label>)}</fieldset>}
      {preview && <p className="teacher-action-preview"><strong>Impact preview:</strong> {preview.previousEffectiveGrade?.percent ?? 'ungraded'}% → {preview.effectiveGrade?.percent ?? Number(percent)}%; outcome {labelize(preview.outcome?.result ?? preview.outcome ?? 'unchanged')}. {preview.rewardChanged ? 'The reward reconciliation will change.' : 'Rewards remain unchanged.'}</p>}
      <div className="teacher-action-row">
        {!preview && <button type="button" disabled={!valid || busy === key} onClick={previewChange}>Preview correction</button>}
        {preview && <button type="button" disabled={busy === key} onClick={applyChange}>Apply correction</button>}
        <button type="button" onClick={() => { setOpen(false); setPreview(null); }}>Cancel</button>
      </div>
      {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
    </div>
  );
}

function GradeAdjustmentRetraction({ sessionId, adjustment, revision, onApplied }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'grade-adjustment-retraction' });
  const key = `retract-grade:${adjustment.adjustmentId}`;
  const body = ({ actorId, pin }, apply) => ({
    reason: reason.trim(), retractedBy: actorId, pin,
    baseSeq: preview?.baseSeq ?? revision, apply,
  });
  const previewRetraction = () => run(key, (auth) => teacherWorkspaceApi.retractGradeAdjustment(
    sessionId, adjustment.adjustmentId, body(auth, false),
  ), { onSuccess: setPreview });
  const applyRetraction = () => run(key, (auth) => teacherWorkspaceApi.retractGradeAdjustment(
    sessionId, adjustment.adjustmentId, body(auth, true), auth.stepUpToken,
  ), {
    stepUp: { action: 'sessions.grade-adjustment.retract', resource: `${sessionId}/${adjustment.adjustmentId}` },
    onSuccess: () => { setOpen(false); setPreview(null); onApplied?.(); },
  });
  if (adjustment.retracted) return <span className="teacher-muted">Retracted</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Retract…</button>;
  return (
    <div className="teacher-grade-correction">
      <label>Retraction reason<input aria-label={`Retraction reason for ${adjustment.adjustmentId}`} value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} maxLength="240" /></label>
      {preview && <p className="teacher-action-preview"><strong>Impact preview:</strong> effective grade becomes {preview.effectiveGrade?.percent ?? 'ungraded'}%. The original correction remains in history.</p>}
      <div className="teacher-action-row">
        {!preview && <button type="button" disabled={!reason.trim() || busy === key} onClick={previewRetraction}>Preview retraction</button>}
        {preview && <button type="button" className="teacher-danger-btn" disabled={busy === key} onClick={applyRetraction}>Apply retraction</button>}
        <button type="button" onClick={() => { setOpen(false); setPreview(null); }}>Cancel</button>
      </div>
      {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
    </div>
  );
}

function ArtifactReprint({ artifactId, kind = 'worksheet', onPrinted }) {
  const [preview, setPreview] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'artifact-reprint' });
  const key = `reprint:${artifactId}`;
  const prepare = () => {
    const requestKey = newIdempotencyKey(key); setIdempotencyKey(requestKey);
    run(key, ({ actorId, pin }) => teacherWorkspaceApi.reprintArtifact(artifactId,
      { reprintedBy: actorId, pin, apply: false }, requestKey), { onSuccess: setPreview });
  };
  const print = () => run(key, ({ actorId, pin, stepUpToken }) => teacherWorkspaceApi.reprintArtifact(artifactId,
    { reprintedBy: actorId, pin, apply: true }, idempotencyKey, stepUpToken), {
    stepUp: { action: 'artifact.reprint', resource: artifactId },
    onSuccess: () => { setPreview(null); setIdempotencyKey(null); onPrinted?.(); },
  });
  const label = kind === 'result-receipt' || kind === 'result-correction' ? 'Result receipt' : 'Worksheet';
  return <>{!preview ? <button type="button" disabled={busy === key} onClick={prepare}>Print another copy…</button> : <span className="teacher-reprint-confirm"><span>{label} ready to print</span><button type="button" disabled={busy === key} onClick={print}>Print now</button><button type="button" onClick={() => { setPreview(null); setIdempotencyKey(null); }}>Cancel</button></span>}{errors[key] && <span className="teacher-panel__error">{errors[key]}</span>}</>;
}

export function SessionInspector({ learnerId, sessionId, kids, onBack }) {
  const [result, setResult] = useState({ state: 'loading', session: null, ownerId: learnerId });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Reaching the teacher surface is the read boundary for now. History
      // must not be blocked by the future login wrapper or make a user claim
      // just to see an already-issued session.
      const dedicated = await teacherWorkspaceApi.session(sessionId);
      if (dedicated.ok) return { state: 'ok', session: dedicated.data, ownerId: dedicated.data?.state?.learnerId ?? dedicated.data?.learnerId ?? learnerId };
      if (dedicated.status !== 404) return { state: 'error', session: null, ownerId: learnerId };
      const candidates = learnerId ? kids.filter((kid) => kid.id === learnerId) : kids;
      const rows = await Promise.all(candidates.map(async (kid) => ({ kid, response: await schoolApi.learnerSessions(kid.id) })));
      for (const { kid, response } of rows) {
        const session = (response.data?.sessions ?? []).find((item) => sessionIdOf(item) === sessionId);
        if (session) return { state: 'ok', session, ownerId: kid.id };
      }
      const unavailable = rows.length && rows.every(({ response }) => response.status === 404);
      return { state: unavailable ? 'unavailable' : 'empty', session: null, ownerId: learnerId };
    };
    load().then((next) => {
      if (!alive) return;
      setResult(next);
    }).catch(() => alive && setResult({ state: 'error', session: null, ownerId: learnerId }));
    return () => { alive = false; };
  }, [learnerId, sessionId, kids, attempt]);

  const session = result.session;
  const sessionState = session?.schema?.startsWith('school.teacher-session/') ? session.state : session;
  const machineGrade = session?.scores?.machine?.percent ?? sessionState?.machineGrade?.percent ?? sessionState?.gradedPercent ?? sessionState?.percent ?? null;
  const effectiveGrade = session?.scores?.effective?.percent ?? sessionState?.effectiveGrade?.percent ?? sessionState?.gradedPercent ?? sessionState?.percent ?? null;
  const gradeAdjustments = sessionState?.gradeAdjustments ?? [];
  const canOfferRetake = sessionState?.outcome?.result === 'needs_remediation' && !sessionState?.remediation;
  const { run, busy, errors } = useTeacherWrite({ panel: 'session-retake' });
  const offerRetake = () => run(sessionId, ({ actorId, pin }) => schoolApi.offerRetake(sessionId, {
    openedBy: actorId, pin,
  }), { onSuccess: () => setAttempt((n) => n + 1) });
  const ownerName = kids.find((kid) => kid.id === result.ownerId)?.name ?? result.ownerId;
  const events = useMemo(() => session?.events ?? sessionState?.events ?? sessionState?.history ?? [], [session, sessionState]);
  const updatedAt = dateOf(session) ?? session?.updatedAt ?? events.at(-1)?.at ?? null;

  return (
    <div className="teacher-view teacher-session-inspector">
      <button type="button" className="teacher-back" onClick={onBack}>← Back to history</button>
      <div className="teacher-session-heading"><LessonIdentity subject={session?.taxonomy?.subject} courseTitle={session?.taxonomy?.courseTitle} moduleTitle={session?.taxonomy?.moduleTitle} lessonTitle={session?.taxonomy?.lessonTitle ?? sessionState?.title} posterUrl={session?.taxonomy?.posterUrl} heading /><p>{ownerName ? `${ownerName} completed this lesson${humanDateTime(updatedAt) ? ` · ${humanDateTime(updatedAt)}` : ''}` : ''}</p></div>
      {result.state === 'loading' && <div className="teacher-panel__skeleton" aria-label="Loading session" />}
      {result.state === 'error' && <p className="teacher-panel__error">Couldn’t load this session. <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {result.state === 'empty' && <CapabilityNotice>This session is not present in the available learner-history window. A dedicated session read endpoint is required to inspect older records.</CapabilityNotice>}
      {result.state === 'unavailable' && <CapabilityNotice>Session inspection is not enabled on this install.</CapabilityNotice>}
      {session && (
        <>
          <section className="teacher-panel teacher-session-summary">
            <h3 className="teacher-panel__title">Outcome</h3>
            <dl>
              <div><dt>Lesson status</dt><dd>{outcomeLabel(sessionState)}</dd></div>
              <div><dt>Marked score<small>As graded by the machine</small></dt><dd>{typeof machineGrade === 'number' ? `${Math.round(machineGrade)}%` : 'Not graded'}</dd></div>
              <div><dt>Current score<small>After teacher corrections</small></dt><dd>{typeof effectiveGrade === 'number' ? `${Math.round(effectiveGrade)}%` : 'Not graded'}</dd></div>
              <div><dt>Last recorded</dt><dd>{humanDateTime(updatedAt) ?? 'Unknown'}</dd></div>
            </dl>
            <div className="teacher-action-row">{canOfferRetake && <button type="button" disabled={busy === sessionId} onClick={offerRetake}>Offer retake</button>}<GradeCorrection sessionId={sessionId} revision={session?.revision} currentPercent={effectiveGrade} items={session?.reviewEvidence ?? []} onApplied={() => setAttempt((n) => n + 1)} /><button type="button" disabled title="Use completion credit from Student operations">Completion credit…</button></div>
            {errors[sessionId] && <p className="teacher-panel__error">{errors[sessionId]}</p>}
          </section>
          {session?.assignment && <section className="teacher-panel">
            <h3 className="teacher-panel__title">Worksheet and questions</h3>
            <p className="teacher-muted">Issued {humanDateTime(session.assignment.createdAt) ?? 'at session start'}.</p>
            <ol className="teacher-event-list teacher-question-list">
              {session.assignment.questions.map((question) => <li key={question.itemId ?? question.number}>
                <strong>{question.number}. {question.prompt ?? 'Question text unavailable'}</strong>
                {question.choices?.length > 0 && <span>{question.choices.map((choice, index) => `${choiceLetter(index)}. ${choice.text ?? choice.label ?? choice}`).join('  ·  ')}</span>}
              </li>)}
            </ol>
          </section>}
          {session?.assessment?.items?.length > 0 && <section className="teacher-panel">
            <h3 className="teacher-panel__title">Answers and result</h3>
            {/* Numbered by the worksheet the teacher just read above, never by
                the bank-global questionNumber — one page, one numbering. */}
            <ol className="teacher-event-list teacher-question-list">
              {session.assessment.items.map((item, index) => {
                const question = (session.assignment?.questions ?? []).find((candidate) => candidate.itemId != null && candidate.itemId === item.itemId) ?? null;
                return <li key={item.itemId ?? item.questionNumber}>
                  <strong>Question {question?.number ?? index + 1}</strong><span>{item.prompt ?? 'Recorded answer'}</span><small>{recordedAnswerLine(item, question)}</small>
                </li>;
              })}
            </ol>
          </section>}
          {session?.answerSheets?.length > 0 && <section className="teacher-panel"><h3 className="teacher-panel__title">Answer card</h3>{session.answerSheets.map((card) => <dl className="teacher-answer-sheet" key={card.cardId}><div><dt>Student No.</dt><dd>{card.studentNumber}</dd></div><div><dt>Mapped learner</dt><dd>{card.mappedLearnerId ?? 'Unmapped'}</dd></div><div><dt>Capacity</dt><dd>{card.usedRows} of {card.capacity} rows used</dd></div><div><dt>Remaining</dt><dd>{card.remainingContiguousSlots} contiguous slots · next row {card.nextRow ?? 'full'}</dd></div>{card.warnings?.map((warning) => <p role="alert" key={warning}>{warning}</p>)}</dl>)}</section>}
          <section className="teacher-panel teacher-session-materials">
            <h3 className="teacher-panel__title">Issued materials and results</h3>
            <p className="teacher-muted">These are the paper records from this lesson.</p>
            {session?.artifacts?.length ? <div className="teacher-session-materials__cards">{session.artifacts.map((artifact) => <div className="teacher-session-materials__card" key={artifact.artifactId}>
              <IssuedArtifactCard artifact={artifact} lessonTitle={session.taxonomy?.lessonTitle ?? session.assignment?.title ?? 'Lesson'} />
              {artifact.availability === 'exact' && <div className="teacher-session-materials__print"><ArtifactReprint artifactId={artifact.artifactId} kind={artifact.kind} onPrinted={() => setAttempt((n) => n + 1)} /></div>}
            </div>)}</div> : <CapabilityNotice>No issued worksheet or result receipt is linked to this session.</CapabilityNotice>}
          </section>
          {gradeAdjustments.length > 0 && <section className="teacher-panel"><h3 className="teacher-panel__title">Grade corrections</h3><ol className="teacher-event-list">{gradeAdjustments.map((adjustment) => <li key={adjustment.adjustmentId}><strong>{adjustment.percent == null ? 'Evidence correction' : `${adjustment.percent}% correction`}</strong><span>{adjustment.reason}</span><small>{adjustment.adjustedBy}{adjustment.at ? ` · ${humanDateTime(adjustment.at)}` : ''}</small><GradeAdjustmentRetraction sessionId={sessionId} adjustment={adjustment} revision={session.revision} onApplied={() => setAttempt((n) => n + 1)} /></li>)}</ol></section>}
          <section className="teacher-panel"><h3 className="teacher-panel__title">Event history</h3>{events.length ? <ol className="teacher-event-list">{events.map((event, index) => <li key={event.id ?? `${event.type}:${index}`}><strong>{labelize(event.type ?? event.kind)}</strong><span>{humanDateTime(event.at) ?? ''}</span><small>{event.by ?? event.actorId ?? event.gradedBy ?? ''}</small></li>)}</ol> : <p className="teacher-panel__empty">Detailed lifecycle events require the session-detail read model.</p>}</section>
        </>
      )}
    </div>
  );
}
