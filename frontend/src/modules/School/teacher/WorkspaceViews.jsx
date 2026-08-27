import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import SyllabiPanel from './panels/SyllabiPanel.jsx';
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
import InterventionsIndex from './panels/InterventionsIndex.jsx';
import IssuedArtifactCard from './panels/IssuedArtifactCard.jsx';
import GradedWorksheet from './panels/GradedWorksheet.jsx';
import LearnerDayView from './panels/LearnerDayView.jsx';
import { LessonIdentity, SubjectIdentity } from './CurriculumIdentity.jsx';
import { teacherBaseFor, teacherDayPath } from './teacherUrl.js';
import { curriculumTitles } from './curriculumTitles.js';
import { localDay, humanDate, humanDateTime } from './teacherDates.js';

const sessionIdOf = (session) => session?.sessionId ?? session?.id ?? null;
const dateOf = (session) => session?.updatedAt ?? session?.closedAt ?? session?.createdAt ?? session?.issuedAt ?? null;
const stateOf = (session) => session?.state ?? session?.status ?? session?.outcome?.result ?? session?.result ?? 'unknown';
const scoreLine = (session) => {
  const score = session?.effectiveScore ?? session?.machineScore;
  if (!score || score.correctCount == null || score.totalCount == null) {
    // Timeline rows carry only `gradedPercent`, so History showed no score at
    // all until this fallback existed.
    return typeof session?.gradedPercent === 'number' ? `${Math.round(session.gradedPercent)}%` : null;
  }
  return `${score.correctCount} of ${score.totalCount} correct${score.percent == null ? '' : ` · ${score.percent}%`}`;
};
const outcomeLabel = (sessionState) => {
  const outcome = sessionState?.outcome?.result;
  if (outcome === 'passed' || ['closed', 'completed'].includes(sessionState?.state)) return 'Completed';
  if (outcome === 'needs_remediation') return 'Needs review';
  return labelize(sessionState?.state ?? outcome ?? 'Recorded');
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

/**
 * Timeline rows name their study day `day`; day-projection rows name it
 * `studyDay`. Reading only `studyDay` silently fell through to `updatedAt`,
 * so a Monday lesson rescanned on Friday filed itself under Friday.
 */
function studyDayOf(session) {
  return session.studyDay ?? session.day ?? (dateOf(session) ?? '').slice(0, 10) ?? 'undated';
}

function groupSessionsByDay(rows) {
  const groups = new Map();
  for (const session of rows) {
    const day = studyDayOf(session) || 'undated';
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(session);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

/**
 * The learner's whole session history, grouped by study day. It was once
 * also the day-scoped list (a `window`/`studyDay` mode); the day record owns
 * that view now, so History is the only caller and the only mode.
 */
function SessionList({ learnerId, onOpenSession }) {
  const authorizedRead = useAuthorizedTeacherRead();
  const [additional, setAdditional] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sessions = usePanelFetch(async () => {
    const timeline = await authorizedRead(() => teacherWorkspaceApi.timeline(learnerId));
    if (timeline.status !== 404) return { ...timeline, data: timeline.data ? { sessions: timeline.data.items ?? [], nextCursor: timeline.data.nextCursor } : null };
    return schoolApi.learnerSessions(learnerId);
  }, {
    deps: [learnerId], panel: 'workspace-sessions', notFoundAs: 'unavailable',
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
    <PanelFrame title="Session history" state={sessions.state} retry={sessions.retry} emptyCopy="No sessions recorded." unavailableCopy="Session history is not enabled on this install.">
      {groupSessionsByDay(rows).map(([day, daySessions]) => (
        <section className="teacher-history-day" key={day}>
          <h3 className="teacher-history-day__heading">
            <a href={teacherDayPath(learnerId, day === 'undated' ? null : day)}>{humanDate(day) ?? 'Undated'}</a>
          </h3>
          <ul className="teacher-session-list">
            {daySessions.map((session, index) => {
              const id = sessionIdOf(session);
              return (
                <li key={id ?? index}>
                  <button type="button" onClick={() => id && onOpenSession(id)} disabled={!id}>
                    <span><LessonIdentity subject={session.subject} courseTitle={session.courseTitle}
                      moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? session.title ?? 'Lesson title unavailable'}
                      posterUrl={session.posterUrl} compact />
                      {/* No per-row date: the group heading owns the day (IA2). */}
                      {scoreLine(session) && <small>{scoreLine(session)}</small>}</span>
                    <span className={`teacher-status teacher-status--${stateOf(session)}`}>
                      {session.outcome?.result === 'passed' ? 'Completed' : labelize(stateOf(session))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {nextCursor && <button type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load older sessions'}</button>}
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

/**
 * `studyDay` defaults here rather than only in the shell so the screen is
 * correct when rendered directly — and so the default stays LOCAL, never the
 * UTC date, which flips to tomorrow every evening.
 */
export function LearnerDayScreen({ learnerId, learnerName, studyDay = localDay(), onChangeStudyDay, onOpenSession }) {
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div>
        <p className="teacher-view__eyebrow">Day record</p>
        <h2>{learnerName}&rsquo;s day</h2>
        <p>What was planned, what got done, and what is still open — for any school day.</p>
      </div></div>
      <LearnerDayView
        learnerId={learnerId}
        learnerName={learnerName}
        studyDay={studyDay}
        onChangeStudyDay={onChangeStudyDay}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}

export function LearnerOverview({ learnerId, learnerName, onOpenSession, studyDay, onChangeStudyDay }) {
  // Overview WAS a second, weaker day view — the plan under a "planning
  // preview" disclaimer plus a day-scoped session list (UX audit IA3). The
  // day record owns that now; this alias keeps old bookmarks working.
  return <LearnerDayScreen learnerId={learnerId} learnerName={learnerName} studyDay={studyDay}
    onChangeStudyDay={onChangeStudyDay} onOpenSession={onOpenSession} />;
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
      <InterventionsIndex learnerId={learnerId} />
      <AttestationPanel learnerId={learnerId} learnerName={learnerName} />
      <ReassignPanel learnerId={learnerId} learnerName={learnerName} kids={kids} />
    </div>
  );
}

export function CurriculumView({ kids, courseId = null, lessonId = null }) {
  // Landing state = the course catalog (cards, one per course). Lessons and
  // per-lesson pass bars live on the drill-in page only (UX audit C10).
  // Curriculum INSPECTS; the repair tools live once, on School Operations,
  // and this page links to them instead of re-rendering the form (IA4).
  return <div className="teacher-view"><div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Published curriculum</p><h2>{courseId ? 'Course curriculum' : 'Courses, units, and policy'}</h2><p>Inspect and operate published curriculum. Authoring remains in reviewed source files.</p></div></div>
    {courseId ? <>
      <CourseContext courseId={courseId} lessonId={lessonId} />
      <CurriculumBrowser courseId={courseId} />
      <InterventionsIndex scopes={['school']} />
    </> : <>
      <CurriculumCatalog />
      <SyllabiPanel />
      <SchoolMatrix kids={kids} />
      <EnrichmentPanel kids={kids} />
      <InterventionsIndex scopes={['school']} />
    </>}
  </div>;
}

export function OperationsView({ kids }) {
  return <div className="teacher-view"><div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">School operations</p><h2>Health, gates, and exceptions</h2><p>Find systematic blockers before changing a student record.</p></div></div><InterventionsIndex scopes={['school']} /><CurriculumExceptionPanel kids={kids} /><StaleSessions kids={kids} /><ActiveOverrides kids={kids} /><PeriodsTimeline /><BulkRegradePanel /><CapabilityNotice>Device health and retained-artifact audit will appear here when their teacher read models are available.</CapabilityNotice></div>;
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
  if (!open) return <button type="button" className="teacher-btn teacher-btn--primary" onClick={() => setOpen(true)}>Fix a marked answer</button>;
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

/**
 * The states a session can be settled by hand FROM: it came back, and marking
 * or closing never finished. Everything earlier belongs to the stuck-session
 * panel's Abandon, which is exactly the complement `MarkSessionAbandoned`
 * refuses — so the two surfaces never both offer a move, and never both
 * withhold one.
 */
const SETTLEABLE_STATES = new Set(['submitted', 'graded', 'outcome_recorded']);

/**
 * The use-case outcomes each half of a settle may report and still be finished.
 * Read as an ALLOW-list, not a deny-list: `awaiting_review` comes back 200 and
 * `ok`, but it means questions are still waiting on a person — closing after
 * one would report "that work has not been marked yet" and blame the wrong
 * half. Anything not named here stops the sequence.
 */
const MARKED_OUTCOMES = new Set(['graded', 'duplicate']);
const SETTLED_OUTCOMES = new Set(['settled', 'already_settled']);

/** What a use case said about itself, preferred over any generic HTTP text. */
const saidBy = (response, fallback) => {
  if (typeof response?.data?.message === 'string' && response.data.message) return response.data.message;
  if (typeof response?.data?.error === 'string' && response.data.error) return response.data.error;
  return fallback;
};

/**
 * Settle this by hand — the way out for a session that came back but never
 * finished marking: a scan that produced no attempts, a paper lesson somebody
 * marked off-screen, every question voided as unmarkable. `abandoned` is not
 * legal from any of those states, so the stuck-session panel links here rather
 * than offering a verb the server would refuse.
 *
 * THREE WRITES, ONE ACT:
 *
 *  1. `graded`, flagged `settle` so it costs a session-scoped step-up. A
 *     hand-settle carries no verdicts and would otherwise meet no gate at all.
 *  2. The reason, as a teacher note. It is the only half the CHILD ever reads
 *     — `RecordTeacherNote` puts it on the agenda's "Notes for you" and the
 *     student panel.
 *  3. `outcome_recorded`. Grading and stopping there would have moved the
 *     problem rather than solved it — the session would sit at `graded`, still
 *     open, still on the stuck list.
 *
 * WHY THE NOTE IS SECOND, not first. The instinct is to put the why on record
 * before anything moves. But the write that acts on this child is the GRADE,
 * and the grade can refuse — an all-voided sheet, a session still waiting on a
 * person. Note-first meant the child read a sentence about a settlement that
 * then did not happen, while the work stayed at `submitted`: a false sentence
 * to a child, which this house forbids more strongly than it demands
 * earliness. Second still puts it ahead of everything the principle protects —
 * ahead of `outcome_recorded`, ahead of the printed receipt, ahead of anything
 * that reaches their day.
 *
 * `duplicate` and `already_settled` are SUCCESS here: they say the half in
 * question was already on record, which is the state this form is trying to
 * reach. Anything else stops the sequence and is reported as what it is. A
 * settle that got partway is never announced as a settle.
 */
function SettleByHand({ sessionId, learnerId, learnerName, currentPercent, onSettled }) {
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(false);
  // Whether this SESSION's note is already on record — keyed to the session id,
  // never to the reason text. `useTeacherWrite` replays a 403'd call once after
  // re-authorizing, and a teacher stuck at a refusing grade half will reword
  // and try again; both must send the child one note, not two.
  const deliveredRef = useRef(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'session-settle' });
  const key = `settle:${sessionId}`;
  const alreadyMarked = typeof currentPercent === 'number';
  const valid = Boolean(reason.trim());

  const settle = () => run(key, async ({ actorId, pin, stepUpToken }) => {
    const graded = await schoolApi.gradeSession(sessionId, {
      gradedBy: actorId, pin, settle: true, settledBy: actorId,
    }, stepUpToken);
    if (!MARKED_OUTCOMES.has(graded.data?.status)) {
      // Nothing was written and nothing was said: a refused grade means no
      // decision was taken about this child, so there is nothing to tell them.
      // A 403 is the one refusal `useTeacherWrite` can act on (it re-prompts
      // and replays), so it travels unrewritten; everything else reports the
      // use case's own sentence about why.
      if (graded.status === 403) return graded;
      return { ok: false, status: graded.status, data: { error:
        `Nothing was changed — the marking didn’t go through: ${saidBy(graded, 'that work could not be marked')}` } };
    }
    if (deliveredRef.current !== sessionId) {
      const delivered = await schoolApi.postTeacherNote({
        learnerId, note: reason.trim(), from: actorId, pin,
      });
      if (!delivered.ok) return delivered;
      deliveredRef.current = sessionId;
    }
    const closed = await schoolApi.closeSession(sessionId, { pin });
    if (!SETTLED_OUTCOMES.has(closed.data?.status)) {
      return { ok: false, status: closed.status, data: { error:
        `It is marked, but closing it out didn’t go through: ${saidBy(closed, 'the close was refused')}. Settle it again to finish.` } };
    }
    return { ok: true, status: closed.status, data: closed.data };
  }, {
    stepUp: { action: 'sessions.settle', resource: sessionId },
    onSuccess: () => { setPreview(false); setReason(''); deliveredRef.current = null; onSettled?.(); },
  });

  return (
    <section className="teacher-panel teacher-session-settle">
      <h3 className="teacher-panel__title">Settle this by hand</h3>
      <p>This lesson came back but never finished marking. Record what it earned and close it out.</p>
      <label>Reason <input aria-label="Settlement reason" maxLength="240"
        placeholder={`What happened? ${learnerName} will see this.`}
        value={reason} onChange={(event) => { setReason(event.target.value); setPreview(false); }} /></label>
      {preview && (
        <div className="teacher-action-preview">
          <strong>Settling does three things</strong>
          <ol>
            <li>{alreadyMarked
              ? `The ${Math.round(currentPercent)}% already on record stands.`
              : 'The mark is finished from the answers already on record.'}</li>
            <li>{learnerName} gets your note: “{reason.trim()}”</li>
            <li>The result is recorded and a receipt goes to the printer.</li>
          </ol>
        </div>
      )}
      <div className="teacher-action-row">
        {!preview && <button type="button" disabled={!valid || busy === key}
          onClick={() => setPreview(true)}>Preview settlement</button>}
        {preview && <button type="button" disabled={!valid || busy === key} onClick={settle}>Settle it</button>}
        {preview && <button type="button" onClick={() => setPreview(false)}>Cancel</button>}
      </div>
      {errors[key] && <p className="teacher-panel__error">{errors[key]}</p>}
    </section>
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
  // No learner, no settle: the reason is delivered TO a child by name, and a
  // form that cannot name one would write a note nobody receives.
  const settleLearnerId = result.ownerId ?? learnerId ?? null;
  const canSettleByHand = Boolean(settleLearnerId)
    && SETTLEABLE_STATES.has(sessionState?.state) && sessionState?.terminal !== true;
  const { run, busy, errors } = useTeacherWrite({ panel: 'session-retake' });
  const offerRetake = () => run(sessionId, ({ actorId, pin }) => schoolApi.offerRetake(sessionId, {
    openedBy: actorId, pin,
  }), { onSuccess: () => setAttempt((n) => n + 1) });
  const ownerName = kids.find((kid) => kid.id === result.ownerId)?.name ?? result.ownerId;
  const events = useMemo(() => session?.events ?? sessionState?.events ?? sessionState?.history ?? [], [session, sessionState]);
  const updatedAt = dateOf(session) ?? session?.updatedAt ?? events.at(-1)?.at ?? null;

  return (
    <div className="teacher-view teacher-session-inspector">
      <button type="button" className="teacher-back" onClick={onBack}>← Back</button>
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
              {/* One score, stated once. "Marked" and "current" are the same
                  number unless a teacher corrected it — and when they differ,
                  the correction is provenance on the one score, not a rival
                  score beside it (UX audit IA1). */}
              <div><dt>Score</dt><dd>
                {typeof effectiveGrade === 'number' ? `${Math.round(effectiveGrade)}%` : 'Not graded'}
                {typeof machineGrade === 'number' && typeof effectiveGrade === 'number'
                  && Math.round(machineGrade) !== Math.round(effectiveGrade)
                  && <small className="teacher-score-provenance">corrected from {Math.round(machineGrade)}% as marked</small>}
              </dd></div>
              <div><dt>Last recorded</dt><dd>{humanDateTime(updatedAt) ?? 'Unknown'}</dd></div>
            </dl>
            {/* One button vocabulary (UX audit IA4/IA5): the repair you came
                here for is primary, the conditional retake is a peer, and the
                cross-page tool is navigation — not a back link, and not a
                noun-dash-noun label that reads as a form caption. */}
            <div className="teacher-action-row">
              <GradeCorrection sessionId={sessionId} revision={session?.revision} currentPercent={effectiveGrade}
                items={session?.reviewEvidence ?? []} onApplied={() => setAttempt((n) => n + 1)} />
              {canOfferRetake && <button type="button" className="teacher-btn" disabled={busy === sessionId}
                onClick={offerRetake}>Offer another try</button>}
              <a className="teacher-btn teacher-btn--quiet"
                 href={`${teacherBaseFor(globalThis.location?.pathname ?? '')}/students/${encodeURIComponent(result.ownerId ?? learnerId ?? '')}/operations`}>
                Give credit for work you saw →
              </a>
            </div>
            {errors[sessionId] && <p className="teacher-panel__error">{errors[sessionId]}</p>}
          </section>
          {/* Below the repair a teacher came for, never above it: settling
              stuck bookkeeping is the exception path. Shown only where it
              means anything — a session that came back and has not finished.
              Earlier states are abandoned, not settled, and the stuck-session
              panel routes those elsewhere; a terminal one is already done.
              Nothing at all rather than a disabled button (UX audit IA4). */}
          {canSettleByHand && (
            <SettleByHand sessionId={sessionId} learnerId={settleLearnerId}
              learnerName={ownerName} currentPercent={effectiveGrade}
              onSettled={() => setAttempt((n) => n + 1)} />
          )}
          {(session?.assignment || session?.assessment?.items?.length > 0) && (
            <section className="teacher-panel">
              <h3 className="teacher-panel__title">Questions and answers</h3>
              {session.assignment?.createdAt && (
                <p className="teacher-muted">Worksheet issued {humanDateTime(session.assignment.createdAt) ?? 'at session start'}.</p>
              )}
              <GradedWorksheet assignment={session.assignment} assessment={session.assessment} />
            </section>
          )}
          {session?.answerSheets?.length > 0 && (
            <details className="teacher-panel teacher-fold">
              <summary><h3 className="teacher-panel__title">Answer card</h3><span>Bubble-sheet capacity and mapping</span></summary>
              {session.answerSheets.map((card) => <dl className="teacher-answer-sheet" key={card.cardId}><div><dt>Student No.</dt><dd>{card.studentNumber}</dd></div><div><dt>Mapped learner</dt><dd>{card.mappedLearnerId ?? 'Unmapped'}</dd></div><div><dt>Capacity</dt><dd>{card.usedRows} of {card.capacity} rows used</dd></div><div><dt>Remaining</dt><dd>{card.remainingContiguousSlots} contiguous slots · next row {card.nextRow ?? 'full'}</dd></div>{card.warnings?.map((warning) => <p role="alert" key={warning}>{warning}</p>)}</dl>)}
            </details>
          )}
          <section className="teacher-panel teacher-session-materials">
            <h3 className="teacher-panel__title">Issued materials and results</h3>
            <p className="teacher-muted">These are the paper records from this lesson.</p>
            {session?.artifacts?.length ? <div className="teacher-session-materials__cards">{session.artifacts.map((artifact) => (
              <IssuedArtifactCard
                key={artifact.artifactId}
                artifact={artifact}
                lessonTitle={session.taxonomy?.lessonTitle ?? session.assignment?.title ?? 'Lesson'}
                action={artifact.availability === 'exact'
                  ? <ArtifactReprint artifactId={artifact.artifactId} kind={artifact.kind} onPrinted={() => setAttempt((n) => n + 1)} />
                  : null}
              />
            ))}</div> : <CapabilityNotice>No issued worksheet or result receipt is linked to this session.</CapabilityNotice>}
          </section>
          {gradeAdjustments.length > 0 && <section className="teacher-panel"><h3 className="teacher-panel__title">Grade corrections</h3><ol className="teacher-event-list">{gradeAdjustments.map((adjustment) => <li key={adjustment.adjustmentId}><strong>{adjustment.percent == null ? 'Evidence correction' : `${adjustment.percent}% correction`}</strong><span>{adjustment.reason}</span><small>{adjustment.adjustedBy}{adjustment.at ? ` · ${humanDateTime(adjustment.at)}` : ''}</small><GradeAdjustmentRetraction sessionId={sessionId} adjustment={adjustment} revision={session.revision} onApplied={() => setAttempt((n) => n + 1)} /></li>)}</ol></section>}
          <details className="teacher-panel teacher-fold">
            <summary><h3 className="teacher-panel__title">Event history</h3><span>{events.length} recorded step{events.length === 1 ? '' : 's'}</span></summary>
            {events.length ? <ol className="teacher-event-list">{events.map((event, index) => <li key={event.id ?? `${event.type}:${index}`}><strong>{labelize(event.type ?? event.kind)}</strong><span>{humanDateTime(event.at) ?? ''}</span><small>{event.by ?? event.actorId ?? event.gradedBy ?? ''}</small></li>)}</ol> : <p className="teacher-panel__empty">Detailed lifecycle events require the session-detail read model.</p>}
          </details>
        </>
      )}
    </div>
  );
}
