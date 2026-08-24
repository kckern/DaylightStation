import { useCallback, useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';
import { usePanelFetch } from './usePanelFetch.js';
import { useTeacherWrite } from './useTeacherWrite.js';
import { useTeacherProfile } from './TeacherProfileContext.jsx';
import { labelize } from './labelize.js';
import PanelFrame from './panels/PanelFrame.jsx';
import TodayTab from './tabs/TodayTab.jsx';
import RecordsTab from './tabs/RecordsTab.jsx';
import AssignmentsView from './panels/AssignmentsView.jsx';
import PianoProgramsPanel from './panels/PianoProgramsPanel.jsx';
import MilestonesPanel from './panels/MilestonesPanel.jsx';
import SchoolMatrix from './panels/SchoolMatrix.jsx';
import CurriculumBrowser from './panels/CurriculumBrowser.jsx';
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

const sessionIdOf = (session) => session?.sessionId ?? session?.id ?? null;
const dateOf = (session) => session?.updatedAt ?? session?.closedAt ?? session?.createdAt ?? session?.issuedAt ?? null;
const stateOf = (session) => session?.state ?? session?.status ?? session?.outcome?.result ?? session?.result ?? 'unknown';

function CapabilityNotice({ children }) {
  return <p className="teacher-capability-notice">{children}</p>;
}

function useAuthorizedTeacherRead() {
  const { requestAuthorization, invalidateAuthorization } = useTeacherProfile();
  return useCallback(async (read) => {
    let authorized = await requestAuthorization();
    if (!authorized.ok) return { ok: false, status: 403, data: null };
    let response = await read();
    if (response.status !== 403) return response;
    invalidateAuthorization();
    authorized = await requestAuthorization();
    if (!authorized.ok) return response;
    response = await read();
    return response;
  }, [requestAuthorization, invalidateAuthorization]);
}

const newIdempotencyKey = (prefix) => `${prefix}:${typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;

function AgendaPreview({ learnerId, learnerName }) {
  const plan = usePanelFetch(() => schoolApi.agendaPreview(learnerId), {
    deps: [learnerId], panel: 'workspace-agenda', notFoundAs: 'unavailable',
    isEmpty: (data) => !(data?.sections ?? []).length,
  });
  const [imageOpen, setImageOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchPreview, setDispatchPreview] = useState(null);
  const [dispatchReceipt, setDispatchReceipt] = useState(null);
  const [dispatchError, setDispatchError] = useState(null);
  const [dispatchKey, setDispatchKey] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'agenda-dispatch' });
  const previewDispatch = async () => {
    setDispatchError(null);
    const response = await teacherWorkspaceApi.agendaDispatchPreview(learnerId, learnerName);
    if (!response.ok) { setDispatchError(response.status === 404 ? 'Teacher dispatch is not enabled on this install.' : 'Couldn’t check printer readiness.'); return; }
    setDispatchPreview(response.data);
    setDispatchKey(newIdempotencyKey(`agenda:${learnerId}`));
    setDispatchOpen(true);
  };
  const dispatch = () => {
    // Keep one key for this preview/attempt. If printing succeeded but its HTTP
    // response was lost, Confirm again must replay the receipt, not print twice.
    const idempotencyKey = dispatchKey;
    if (!idempotencyKey) return;
    run(`agenda:${learnerId}`, ({ actorId, pin, stepUpToken }) => teacherWorkspaceApi.agendaDispatch(learnerId, {
      learnerName, dispatchedBy: actorId, pin,
    }, idempotencyKey, stepUpToken), {
      onSuccess: (receipt) => { setDispatchReceipt(receipt); setDispatchOpen(false); setDispatchKey(null); },
      stepUp: { action: 'agenda.dispatch', resource: learnerId },
    });
  };
  const pngUrl = `/api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/agenda/preview`;

  return (
    <PanelFrame
      title="Today's agenda"
      state={plan.state}
      retry={plan.retry}
      emptyCopy="Nothing is scheduled for today."
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
            <strong>{section.subject ?? 'School'}</strong>
            <span>{section.servedToday
              ? 'Complete today'
              : section.suppressed
                ? `Deferred for ${section.suppressed.bySubject} focus`
                : section.next?.title ?? section.next?.label ?? section.next?.unitId ?? section.lockedRemedy ?? section.timingNotice ?? 'No work offered'}</span>
          </li>
        ))}
      </ol>
      <div className="teacher-action-row">
        <button type="button" onClick={() => setImageOpen((open) => !open)}>{imageOpen ? 'Hide rendered agenda' : 'Preview rendered agenda'}</button>
        <a href={pngUrl} target="_blank" rel="noreferrer">Open PNG</a>
        <button type="button" onClick={previewDispatch}>Print agenda…</button>
      </div>
      {dispatchError && <p className="teacher-panel__error">{dispatchError}</p>}
      {dispatchReceipt && <p className="teacher-action-receipt">{dispatchReceipt.printed ? 'Agenda printed.' : `Printer did not accept the agenda${dispatchReceipt.reason ? `: ${dispatchReceipt.reason}` : '.'}`} <small>Receipt {dispatchReceipt.idempotencyKey}</small></p>}
      {imageOpen && <img className="teacher-agenda-preview" src={pngUrl} alt="Rendered agenda preview" />}
      {dispatchOpen && (
        <div className="teacher-action-preview" role="dialog" aria-label="Agenda dispatch preview">
          <strong>Dispatch preview</strong>
          <p>{dispatchPreview?.ready ? 'The rendered agenda above is ready for the School receipt printer.' : 'The agenda is not ready to print.'}</p>
          {(dispatchPreview?.errors ?? []).length > 0 && <ul className="teacher-workspace__alerts">{dispatchPreview.errors.map((error, index) => <li key={index}>{typeof error === 'string' ? error : error?.message}</li>)}</ul>}
          {dispatchPreview?.ready ? (
            <div className="teacher-action-row">
              <button type="button" disabled={busy === `agenda:${learnerId}`} onClick={dispatch}>Confirm print</button>
              <button type="button" onClick={() => setDispatchOpen(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <CapabilityNotice>Previewing did not allocate or print anything. Resolve the listed planner errors before dispatching.</CapabilityNotice>
              <button type="button" onClick={() => setDispatchOpen(false)}>Close</button>
            </>
          )}
          {errors[`agenda:${learnerId}`] && <p className="teacher-panel__error">{errors[`agenda:${learnerId}`]}</p>}
        </div>
      )}
    </PanelFrame>
  );
}

function SessionList({ learnerId, onOpenSession, window = null }) {
  const authorizedRead = useAuthorizedTeacherRead();
  const [additional, setAdditional] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sessions = usePanelFetch(async () => {
    if (window) return schoolApi.learnerSessions(learnerId, { window });
    const timeline = await authorizedRead(() => teacherWorkspaceApi.timeline(learnerId));
    if (timeline.status !== 404) return { ...timeline, data: timeline.data ? { sessions: timeline.data.items ?? [], nextCursor: timeline.data.nextCursor } : null };
    return schoolApi.learnerSessions(learnerId);
  }, {
    deps: [learnerId, window], panel: 'workspace-sessions', notFoundAs: 'unavailable',
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
    <PanelFrame title={window === 'today' ? 'Today’s sessions' : 'Session history'} state={sessions.state} retry={sessions.retry} emptyCopy="No sessions recorded." unavailableCopy="Session history is not enabled on this install.">
      <ul className="teacher-session-list">
        {rows.map((session, index) => {
          const id = sessionIdOf(session);
          return (
            <li key={id ?? index}>
              <button type="button" onClick={() => id && onOpenSession(id)} disabled={!id}>
                <span><strong>{session.title ?? labelize(session.unitId) ?? 'Session'}</strong><small>{dateOf(session) ? String(dateOf(session)).slice(0, 10) : 'No date'}</small></span>
                <span className={`teacher-status teacher-status--${stateOf(session)}`}>{labelize(stateOf(session))}</span>
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
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading">
        <div><p className="teacher-view__eyebrow">Household school</p><h2>Today at a glance</h2><p>Start with what needs a grown-up, then move into a learner’s day.</p></div>
        <button type="button" className="teacher-primary" onClick={onOpenQueue}>Open action queue</button>
      </div>
      <TodayTab kids={kids} />
      <section className="teacher-panel">
        <h2 className="teacher-panel__title">Student workspaces</h2>
        <div className="teacher-student-grid">
          {kids.map((kid) => <button type="button" key={kid.id} onClick={() => onSelectLearner(kid.id)}><strong>{kid.name}</strong><span>Agenda, courses, history, reports, and repair →</span></button>)}
        </div>
      </section>
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
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Student workspace</p><h2>{learnerName} today</h2><p>Plan, progress, blockers, and the next useful teacher action.</p></div></div>
      <AgendaPreview learnerId={learnerId} learnerName={learnerName} />
      <SessionList learnerId={learnerId} window="today" onOpenSession={onOpenSession} />
      <MilestonesPanel learnerId={learnerId} />
    </div>
  );
}

export function CoursesView({ learnerId, learnerName, courseId, kids }) {
  return (
    <div className="teacher-view">
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Courses & enrollment</p><h2>{courseId ? labelize(courseId) : `${learnerName}’s program`}</h2><p>Operate published courses, enrollment, timing, pass bars, and milestones.</p></div></div>
      {courseId && <p className="teacher-context-banner">Showing the selected course context. Assignment editing remains learner-wide so prerequisites and sequencing stay visible.</p>}
      <AssignmentsView learnerId={learnerId} learnerName={learnerName} />
      <PianoProgramsPanel learnerId={learnerId} />
      <MilestonesPanel learnerId={learnerId} />
      <SchoolMatrix kids={kids} />
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

export function CurriculumView({ kids }) {
  return <div className="teacher-view"><div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Published curriculum</p><h2>Courses, units, and policy</h2><p>Inspect and operate published curriculum. Authoring remains in reviewed source files.</p></div></div><SchoolMatrix kids={kids} /><CurriculumBrowser /><PeriodsTimeline /><EnrichmentPanel kids={kids} /></div>;
}

export function OperationsView({ kids }) {
  return <div className="teacher-view"><div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">School operations</p><h2>Health, gates, and exceptions</h2><p>Find systematic blockers before changing a student record.</p></div></div><StaleSessions kids={kids} /><ActiveOverrides kids={kids} /><PeriodsTimeline /><BulkRegradePanel /><CapabilityNotice>Device health and retained-artifact audit will appear here when their teacher read models are available.</CapabilityNotice></div>;
}

function BulkRegradePanel() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

function GradeCorrection({ sessionId, revision, currentPercent, onApplied }) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(currentPercent == null ? '' : String(Math.round(currentPercent)));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'grade-adjustment' });
  const key = `grade:${sessionId}`;
  const valid = Number.isFinite(Number(percent)) && Number(percent) >= 0 && Number(percent) <= 100 && reason.trim();
  const body = ({ actorId, pin }, apply) => ({
    percent: Number(percent), reason: reason.trim(), adjustedBy: actorId, pin,
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
      <label>Effective percent <input aria-label="Effective percent" type="number" min="0" max="100" value={percent} onChange={(event) => { setPercent(event.target.value); setPreview(null); }} /></label>
      <label>Reason <input aria-label="Grade correction reason" maxLength="240" placeholder="What did the machine get wrong?" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} /></label>
      {preview && <p className="teacher-action-preview"><strong>Impact preview:</strong> {preview.previousEffectiveGrade?.percent ?? 'ungraded'}% → {preview.effectiveGrade?.percent ?? Number(percent)}%; outcome {labelize(preview.outcome?.result ?? preview.outcome ?? 'unchanged')}. Rewards remain unchanged.</p>}
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

function ArtifactPostview({ artifactId }) {
  const [url, setUrl] = useState(null);
  const { run, busy, errors } = useTeacherWrite({ panel: 'artifact-postview' });
  const key = `postview:${artifactId}`;
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const prepare = () => run(key, ({ stepUpToken }) => teacherWorkspaceApi.artifactPostview(artifactId, stepUpToken), {
    stepUp: { action: 'artifact.postview', resource: artifactId },
    onSuccess: (blob) => {
      setUrl((prior) => {
        if (prior) URL.revokeObjectURL(prior);
        return URL.createObjectURL(blob);
      });
    },
  });
  return (
    <>
      {url
        ? <a target="_blank" rel="noreferrer" href={url} download={`postview-${artifactId}.pdf`}>Open postview PDF</a>
        : <button type="button" disabled={busy === key} onClick={prepare}>{busy === key ? 'Preparing…' : 'Prepare postview PDF…'}</button>}
      {errors[key] && <span className="teacher-panel__error">{errors[key]}</span>}
    </>
  );
}

function ArtifactOriginal({ artifactId, index = null }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const authorizedRead = useAuthorizedTeacherRead();
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const prepare = async () => {
    setBusy(true);
    setError(null);
    const response = await authorizedRead(() => teacherWorkspaceApi.artifactOriginal(artifactId));
    if (response.ok) {
      setUrl((prior) => {
        if (prior) URL.revokeObjectURL(prior);
        return URL.createObjectURL(response.data);
      });
    } else setError('Couldn’t open the retained original.');
    setBusy(false);
  };
  return <>{url
    ? <a target="_blank" rel="noreferrer" href={url}>Open issued PDF{index === null ? '' : ` ${index + 1}`}</a>
    : <button type="button" disabled={busy} onClick={prepare}>{busy ? 'Preparing…' : `Open issued PDF${index === null ? '' : ` ${index + 1}`}…`}</button>}
  {error && <span className="teacher-panel__error">{error}</span>}</>;
}

export function SessionInspector({ learnerId, sessionId, kids, onBack }) {
  const authorizedRead = useAuthorizedTeacherRead();
  const [result, setResult] = useState({ state: 'loading', session: null, ownerId: learnerId });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const dedicated = await authorizedRead(() => teacherWorkspaceApi.session(sessionId));
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
  }, [learnerId, sessionId, kids, attempt, authorizedRead]);

  const session = result.session;
  const sessionState = session?.schema === 'school.teacher-session/v1' ? session.state : session;
  const artifactIds = session?.artifactIds?.length ? session.artifactIds
    : [sessionState?.artifactId ?? sessionState?.document?.artifactId ?? sessionState?.issued?.artifactId].filter(Boolean);
  const machineGrade = sessionState?.machineGrade?.percent ?? sessionState?.gradedPercent ?? sessionState?.percent ?? null;
  const effectiveGrade = sessionState?.effectiveGrade?.percent ?? sessionState?.gradedPercent ?? sessionState?.percent ?? null;
  const gradeAdjustments = sessionState?.gradeAdjustments ?? [];
  const canOfferRetake = sessionState?.outcome?.result === 'needs_remediation' && !sessionState?.remediation;
  const { run, busy, errors } = useTeacherWrite({ panel: 'session-retake' });
  const offerRetake = () => run(sessionId, ({ actorId, pin }) => schoolApi.offerRetake(sessionId, {
    openedBy: actorId, pin,
  }), { onSuccess: () => setAttempt((n) => n + 1) });
  const ownerName = kids.find((kid) => kid.id === result.ownerId)?.name ?? result.ownerId;
  const events = useMemo(() => session?.events ?? sessionState?.events ?? sessionState?.history ?? [], [session, sessionState]);

  return (
    <div className="teacher-view teacher-session-inspector">
      <button type="button" className="teacher-back" onClick={onBack}>← Back to history</button>
      <div className="teacher-view__heading"><div><p className="teacher-view__eyebrow">Session inspector</p><h2>{sessionState?.title ?? labelize(sessionState?.unitId) ?? sessionId}</h2><p>{ownerName ? `${ownerName} · ` : ''}{sessionId}</p></div></div>
      {result.state === 'loading' && <div className="teacher-panel__skeleton" aria-label="Loading session" />}
      {result.state === 'error' && <p className="teacher-panel__error">Couldn’t load this session. <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {result.state === 'empty' && <CapabilityNotice>This session is not present in the available learner-history window. A dedicated session read endpoint is required to inspect older records.</CapabilityNotice>}
      {result.state === 'unavailable' && <CapabilityNotice>Session inspection is not enabled on this install.</CapabilityNotice>}
      {session && (
        <>
          <section className="teacher-panel teacher-session-summary">
            <h3 className="teacher-panel__title">Outcome</h3>
            <dl>
              <div><dt>Status</dt><dd>{labelize(stateOf(sessionState))}</dd></div>
              <div><dt>Machine grade</dt><dd>{typeof machineGrade === 'number' ? `${Math.round(machineGrade)}%` : 'Not graded'}</dd></div>
              <div><dt>Effective grade</dt><dd>{typeof effectiveGrade === 'number' ? `${Math.round(effectiveGrade)}%` : 'Not graded'}</dd></div>
              <div><dt>Updated</dt><dd>{dateOf(session) ? new Date(dateOf(session)).toLocaleString() : 'Unknown'}</dd></div>
            </dl>
            <div className="teacher-action-row">{canOfferRetake && <button type="button" disabled={busy === sessionId} onClick={offerRetake}>Offer retake</button>}<GradeCorrection sessionId={sessionId} revision={session?.revision} currentPercent={effectiveGrade} onApplied={() => setAttempt((n) => n + 1)} /><button type="button" disabled title="Use completion credit from Student operations">Completion credit…</button></div>
            {errors[sessionId] && <p className="teacher-panel__error">{errors[sessionId]}</p>}
          </section>
          <section className="teacher-panel">
            <h3 className="teacher-panel__title">Artifact lineage</h3>
            {artifactIds.length ? artifactIds.map((artifactId, index) => <div className="teacher-artifact-actions" key={artifactId}><ArtifactOriginal artifactId={artifactId} index={artifactIds.length > 1 ? index : null} /><ArtifactPostview artifactId={artifactId} /><span>{artifactId}</span></div>) : <CapabilityNotice>No retained artifact is linked to this session. Legacy issues may only have event metadata.</CapabilityNotice>}
          </section>
          {gradeAdjustments.length > 0 && <section className="teacher-panel"><h3 className="teacher-panel__title">Grade corrections</h3><ol className="teacher-event-list">{gradeAdjustments.map((adjustment) => <li key={adjustment.adjustmentId}><strong>{adjustment.percent == null ? 'Evidence correction' : `${adjustment.percent}% correction`}</strong><span>{adjustment.reason}</span><small>{adjustment.adjustedBy}{adjustment.at ? ` · ${new Date(adjustment.at).toLocaleString()}` : ''}</small><GradeAdjustmentRetraction sessionId={sessionId} adjustment={adjustment} revision={session.revision} onApplied={() => setAttempt((n) => n + 1)} /></li>)}</ol></section>}
          <section className="teacher-panel"><h3 className="teacher-panel__title">Event history</h3>{events.length ? <ol className="teacher-event-list">{events.map((event, index) => <li key={event.id ?? `${event.type}:${index}`}><strong>{labelize(event.type ?? event.kind)}</strong><span>{event.at ? new Date(event.at).toLocaleString() : ''}</span><small>{event.by ?? event.actorId ?? event.gradedBy ?? ''}</small></li>)}</ol> : <p className="teacher-panel__empty">Detailed lifecycle events require the session-detail read model.</p>}</section>
        </>
      )}
    </div>
  );
}
