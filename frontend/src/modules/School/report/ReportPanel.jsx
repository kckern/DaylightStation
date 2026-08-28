import { useEffect, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import MetricTile from './MetricTile.jsx';
import CurriculumHistoryOverview from '../progress/CurriculumHistoryOverview.jsx';
import InstructionalInsightsOverview from '../progress/InstructionalInsightsOverview.jsx';
import { useTeacherToday } from './useTeacherToday.js';
import { labelize } from '../teacher/labelize.js';

/** A recent-score title for humans: the LAST path segment, labelized —
 * never 'history/i-survived/02-…/01-alone-in-the-matawan-creek' as a
 * child's achievement (design audit #3). */
function scoreTitle(score) {
  const raw = score.learning?.lessonId ?? score.activityId ?? '';
  const last = String(raw).split('/').filter(Boolean).at(-1) ?? String(raw);
  return labelize(last) || raw;
}

/**
 * The aggregate board: every program × every learner, in one shape.
 *
 * Renders entirely from the closed report contract, so it has no knowledge of
 * quizzes, courses or sentence ladders and gains no branch when a program is
 * added. Both scopes live on one screen because that is how the Portal is
 * actually used — a parent glances at everyone, a child taps their own face.
 *
 * `next` is the field this view exists for, so it is the loudest thing on each
 * card. A blocked step always names its remedy; the contract guarantees the
 * string is there.
 */

const STATE_LABEL = {
  blocked: 'Blocked',
  active: 'In progress',
  idle: 'Paused',
  'not-started': 'Not started',
  complete: 'Complete',
};

function relativeDay(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

const SESSION_STATE_LABEL = {
  blocked: 'Blocked',
  active: 'Active',
  idle: 'Paused',
  'not-started': 'Not started',
  complete: 'Complete',
};

/**
 * "Today" strip — attempts, sessions in flight, and anything waiting on a
 * grown-up, for ONE learner (Task 6's `GetTeacherToday`). Rendered above that
 * learner's program cards so the household teacher sees today before the
 * historical board underneath it.
 *
 * The pending-review badge is the only navigation this view has ever needed
 * to a DIFFERENT app: the review queue lives in Admin (`/admin/school/review`,
 * behind its own auth gate), not on this kiosk board, so it is a real link —
 * a broken/dead link would be worse than the count alone, but a link that
 * goes nowhere is worse than either.
 */
function TodayStrip({ digest, status, kidMode = false }) {
  if (status === 'error') {
    return <p className="school-report__today school-report__today-error">Could not load today&apos;s activity.</p>;
  }
  // Still loading — stay out of the way rather than flash an empty strip
  // before data lands. Once the fetch has resolved, though, a learner with
  // NO row (reachable in prod: the route answers `[]` whenever the
  // lifecycle isn't fully wired) gets the same zero-state as an explicit
  // all-zero row — "no work recorded today", never blank.
  if (status !== 'ready') return null;

  const { attemptsToday = 0, correctToday = 0, sessionsToday = [], pendingReview = 0 } = digest ?? {};
  const hasWork = attemptsToday > 0 || sessionsToday.length > 0;

  return (
    <div className="school-report__today">
      {hasWork ? (
        <>
          <span className="school-report__today-stat">
            {attemptsToday} {attemptsToday === 1 ? 'attempt' : 'attempts'} today
            {attemptsToday > 0 && ` · ${correctToday} correct`}
          </span>
          {sessionsToday.length > 0 && (
            <span className="school-report__today-sessions">
              {sessionsToday.map((s, i) => (
                 
                <span key={`${s.unitId ?? 'unit'}-${i}`} className="school-report__today-session">
                  {s.unitId ?? 'Unnamed unit'} · {SESSION_STATE_LABEL[s.state] ?? s.state ?? 'in progress'}
                </span>
              ))}
            </span>
          )}
        </>
      ) : (
        <span className="school-report__today-empty">No work recorded today</span>
      )}

      {pendingReview > 0 && (kidMode ? (
        // A kid's board never links into the admin app; the same fact in
        // their terms — waiting is normal, not their problem to fix.
        <span className="school-report__today-badge">
          {pendingReview} waiting for a grown-up to check
        </span>
      ) : (
        <a href="/admin/school/review" className="school-report__today-badge">
          {pendingReview} {pendingReview === 1 ? 'item needs' : 'items need'} marking
        </a>
      ))}
    </div>
  );
}

function ProgramCard({ report }) {
  return (
    <article className={`school-report__card is-${report.state}`}>
      <header className="school-report__card-head">
        {/* Human words, never slugs, on a child's board (M9 fix 1). */}
        <h4 className="school-report__program">{labelize(report.label)}</h4>
        <span className={`school-report__state is-${report.state}`}>
          {STATE_LABEL[report.state] ?? labelize(report.state)}
        </span>
      </header>

      {report.headline && <p className="school-report__headline">{report.headline}</p>}

      {report.next && (
        <p className={`school-report__next${report.next.blocked ? ' is-blocked' : ''}`}>
          <span className="school-report__next-label">
            {report.next.blocked ? report.next.blockedReason : report.next.label}
          </span>
          {!report.next.blocked && report.next.detail && (
            <span className="school-report__next-detail">{report.next.detail}</span>
          )}
        </p>
      )}

      {report.metrics.length > 0 && (
        <div className="school-report__metrics">
          {report.metrics.map((m) => <MetricTile key={m.id} metric={m} />)}
        </div>
      )}

      {report.lastActivity && (
        <p className="school-report__seen">Last studied {relativeDay(report.lastActivity)}</p>
      )}
    </article>
  );
}

function FlashcardProgress({ report }) {
  const decks = report?.decks ?? [];
  if (!decks.length) return null;
  return <section className="school-report__flashcards" aria-label="Flashcard progress"><h3>Flashcards</h3><div className="school-report__cards">{decks.map((deck) => {
    const counts = deck.summary?.counts ?? {};
    return <article className="school-report__card" key={deck.id}><h4 className="school-report__program">{deck.title}</h4><p className="school-report__headline">{counts.due ?? 0} due · {counts.new ?? 0} new · {counts.mastered ?? 0} mastered</p><p className="school-report__seen">{counts.reviewed ?? 0} reviews · {Math.floor((counts.activeSeconds ?? 0) / 60)} active min</p></article>;
  })}</div></section>;
}

function ProgressOverview({ snapshot, options, periodId, setPeriodId, subjectId, setSubjectId, coreOnly, setCoreOnly, focus, onFollowUp, kidMode = false }) {
  if (!snapshot) return null;
  const summary = snapshot.summary;
  const learnerNames = new Map((options?.learners ?? []).map((learner) => [learner.id, learner.name]));
  const subjects = snapshot.facets?.subjects ?? [];
  return (
    <section className="school-progress" aria-label="Learning progress">
      <div className="school-progress__filters">
        <label>
          Period
          <select aria-label="Academic period" value={periodId} onChange={(event) => setPeriodId(event.target.value)}>
            <option value="">All time</option>
            {(options?.periods ?? []).map((period) => (
              <option key={period.periodId} value={period.periodId}>{period.label}</option>
            ))}
          </select>
        </label>
        <label>
          Subject
          <select aria-label="Subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            <option value="">All subjects</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.id}</option>)}
          </select>
        </label>
        <label className="school-progress__check">
          <input type="checkbox" checked={coreOnly} onChange={(event) => setCoreOnly(event.target.checked)} />
          Hide electives
        </label>
      </div>

      <div className="school-progress__summary">
        <ProgressFigure label="Questions" value={summary.responseCount.toLocaleString()} />
        <ProgressFigure label="Accuracy" value={summary.scorePercent === null ? '—' : `${summary.scorePercent}%`} />
        <ProgressFigure label="Completed" value={summary.completionCount.toLocaleString()} />
        {/* "Pending sync" is infrastructure gossip on a child's dashboard
            (design audit) — teachers keep it, kids don't. */}
        {!kidMode && <ProgressFigure label="Pending sync" value={summary.pendingCount.toLocaleString()} pending={summary.pendingCount > 0} />}
      </div>

      {snapshot.followUps.length > 0 && (
        <div className="school-progress__actions" aria-label="Follow-up actions">
          {snapshot.followUps.map((action) => (
            <button
              key={action.actionId}
              type="button"
              disabled={action.availability !== 'ready' || !focus || !onFollowUp}
              onClick={() => onFollowUp?.(action)}
              title={action.reason ?? action.label}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <CurriculumHistoryOverview history={snapshot.curriculumHistory} />

      {snapshot.recentScores.length > 0 && (
        <div className="school-progress__recent">
          <h3>Recent scores</h3>
          <div className="school-progress__score-list">
            {snapshot.recentScores.map((score) => (
              <article key={`${score.learnerId}:${score.assessmentId}`} className="school-progress__score">
                {!focus && <span className="school-progress__score-learner">{learnerNames.get(score.learnerId) ?? score.learnerId}</span>}
                <strong>{scoreTitle(score)}</strong>
                <span className="school-progress__score-value">{score.score.correct}/{score.score.total} · {score.score.percent}%</span>
                {score.verification === 'pending' && <span className="school-progress__pending">Pending sync</span>}
                <span className="school-progress__score-when">{relativeDay(score.occurredAt)}</span>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ProgressFigure({ label, value, pending = false }) {
  return (
    <div className={`school-progress__figure${pending ? ' is-pending' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ReportPanel({ userId = null, onFollowUp = null, kidMode = false }) {
  const [data, setData] = useState(null);
  const [progress, setProgress] = useState(null);
  const [insights, setInsights] = useState(null);
  const [options, setOptions] = useState(null);
  const [status, setStatus] = useState('loading');
  const [focus, setFocus] = useState(userId);
  const [periodId, setPeriodId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [coreOnly, setCoreOnly] = useState(false);
  const [flashcardReport, setFlashcardReport] = useState(null);
  const [householdFlashcards, setHouseholdFlashcards] = useState({});
  const { byLearner: todayByLearner, status: todayStatus } = useTeacherToday();

  useEffect(() => { setFocus(userId); }, [userId]);

  useEffect(() => {
    let alive = true;
    schoolApi.progressOptions().then(({ ok, data: body }) => {
      if (alive && ok && body) setOptions(body);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    const flashcards = focus && typeof schoolApi.flashcardReport === 'function'
      ? schoolApi.flashcardReport(focus)
      : Promise.resolve({ ok: true, data: null });
    Promise.all([
      schoolApi.report(focus),
      schoolApi.progress({
        ...(focus ? { learnerId: focus } : { scopeType: 'household', scopeId: 'household' }),
        ...(periodId ? { periodId } : {}),
        ...(subjectId ? { subjectIds: [subjectId] } : {}),
        ...(coreOnly ? { excludeClassifications: ['elective'] } : {}),
        groupBy: ['subject'], recentLimit: 12,
      }), flashcards,
    ]).then(([reportResponse, progressResponse, flashcardResponse]) => {
      if (!alive) return;
      if ((!reportResponse.ok || !reportResponse.data) && (!progressResponse.ok || !progressResponse.data)) {
        schoolLog.materialsError('report-failed', { userId: focus });
        setStatus('error');
        return;
      }
      setData(reportResponse.ok ? reportResponse.data : { learners: [] });
      setProgress(progressResponse.ok ? progressResponse.data : null);
      setFlashcardReport(flashcardResponse.ok ? flashcardResponse.data : null);
      const hasReports = reportResponse.ok && reportResponse.data?.learners?.length > 0;
      const hasEvidence = progressResponse.ok && progressResponse.data?.summary?.evidenceCount > 0;
      const hasFlashcards = (flashcardResponse.data?.decks ?? []).some((deck) => (deck.summary?.counts?.reviewed ?? 0) > 0);
      setStatus(hasReports || hasEvidence || hasFlashcards ? 'ready' : 'empty');
    });
    return () => { alive = false; };
  }, [focus, periodId, subjectId, coreOnly]);

  // Household reporting remains server-scoped per learner: the same endpoint
  // that drives a child's report is called for roster ids returned by the
  // ordinary household report, never by accepting an arbitrary client roster.
  useEffect(() => {
    let alive = true;
    if (focus || typeof schoolApi.flashcardReport !== 'function') {
      setHouseholdFlashcards({});
      return () => { alive = false; };
    }
    const learners = data?.learners ?? [];
    Promise.all(learners.map(async (learner) => [learner.id, await schoolApi.flashcardReport(learner.id)]))
      .then((rows) => {
        if (!alive) return;
        setHouseholdFlashcards(Object.fromEntries(rows
          .filter(([, response]) => response.ok && response.data)
          .map(([id, response]) => [id, response.data])));
      });
    return () => { alive = false; };
  }, [focus, data]);

  useEffect(() => {
    let alive = true;
    if (focus) {
      setInsights(null);
      return () => { alive = false; };
    }
    schoolApi.instructionalInsights({ scopeType: 'household', scopeId: 'household' })
      .then(({ ok, data: body }) => {
        if (alive) setInsights(ok ? body : null);
      });
    return () => { alive = false; };
  }, [focus]);

  if (status === 'loading') return <p className="school-report__status">Loading…</p>;
  if (status === 'error') return <p className="school-report__status">Could not load progress.</p>;
  if (status === 'empty') return <p className="school-report__status">Nobody has started anything yet.</p>;

  return (
    <div className="school-report">
      {focus && !kidMode && (
        <button type="button" className="school-report__all" onClick={() => setFocus(null)}>
          ‹ Everyone
        </button>
      )}

      <ProgressOverview
        snapshot={progress}
        options={options}
        periodId={periodId}
        setPeriodId={setPeriodId}
        subjectId={subjectId}
        setSubjectId={setSubjectId}
        coreOnly={coreOnly}
        setCoreOnly={setCoreOnly}
        focus={focus}
        onFollowUp={onFollowUp}
        kidMode={kidMode}
      />

      {focus && <FlashcardProgress report={flashcardReport} />}

      {!focus && <InstructionalInsightsOverview insights={insights} />}

      {(data?.learners ?? []).map((learner) => (
        <section key={learner.id} className="school-report__learner">
          <header className="school-report__learner-head">
            {/* Drilling in is the same endpoint filtered, not a second view. */}
            <button
              type="button"
              className="school-report__learner-name"
              onClick={kidMode ? undefined : () => setFocus(focus ? null : learner.id)}
              disabled={kidMode}
            >
              {learner.name}
            </button>
            {learner.needsAttention && !kidMode && (
              <span className="school-report__flag">Needs attention</span>
            )}
          </header>
          <TodayStrip digest={todayByLearner.get(learner.id)} status={todayStatus} kidMode={kidMode} />
          {!focus && <FlashcardProgress report={householdFlashcards[learner.id]} />}
          <div className="school-report__cards">
            {learner.reports.map((r) => <ProgramCard key={`${r.program}:${r.label}`} report={r} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
