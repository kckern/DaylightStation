/**
 * RosterStrip — one card per learner from GET /teacher/today, joined with the
 * kids' roster for names (digest rows carry learnerId only, by design).
 *
 * Tapping a learner expands the day as a GRID of lesson cards — every lesson
 * on the day side by side: done work with its score (marks + percent), planned
 * work not yet started, and per-lesson access to the issued worksheet and the
 * printed result receipt. The artifact links ride the digest itself
 * (GetTeacherToday derives them from session state at zero extra I/O), so
 * showing them costs no per-session fetch — the N+1 the old eager dashboard
 * paid stays dead. The one lazy read is the agenda preview (per learner, on
 * expand, GET-only and non-recording) that contributes the "not yet started"
 * cards; without it the grid still renders everything recorded.
 *
 * Previewing stays side-effect free: every read here is a GET that creates no
 * session, print, ticket, or code — the PrintedAgenda preview is inert by
 * construction (see its own comment).
 */
import { useEffect, useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import SafeImg from './SafeImg.jsx';
import IssuedArtifactCard from './IssuedArtifactCard.jsx';
import { PrintedAgenda } from './LearnerDayView.jsx';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { joinLearnerDay, DAY_STATUS_LABEL } from '../learnerDay.js';
import { teacherBaseFor, teacherDayPath, teacherSessionPath } from '../teacherUrl.js';
import { localDay } from '../teacherDates.js';
import { SubjectIdentity } from '../CurriculumIdentity.jsx';
import { teacherLog } from '../teacherLog.js';

// ---------------------------------------------------------------------------
// Inline SVG marks (kiosk WebViews render unicode glyphs as tofu).
// ---------------------------------------------------------------------------
const MarkCheck = () => (
  <svg viewBox="0 0 16 16" className="teacher-mark teacher-mark--check" aria-hidden="true" focusable="false">
    <path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const MarkCross = () => (
  <svg viewBox="0 0 16 16" className="teacher-mark teacher-mark--cross" aria-hidden="true" focusable="false">
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
const IconPdf = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M5 1.5h7l4 4V17a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 17V3A1.5 1.5 0 0 1 5.5 1.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 1.5V6h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M6.5 10h7M6.5 12.7h7M6.5 15.4h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconReceipt = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M5 2h10v15l-2-1.4-2 1.4-2-1.4L7 17l-2-1.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.2 6h5.6M7.2 8.8h5.6M7.2 11.6h3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconChevron = ({ open }) => (
  <svg viewBox="0 0 16 16" className={`teacher-roster__chevron${open ? ' teacher-roster__chevron--open' : ''}`} aria-hidden="true" focusable="false">
    <path d="M5.5 3.5L11 8l-5.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconClose = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// `reviewStatus` is 'pending' | 'complete' on the wire; accept the historical
// 'pending_review' spelling too so a backend rename can't silence the label.
const AWAITING = new Set(['pending', 'pending_review']);

const SELF_LABEL = {
  not_yet: 'says: not yet', uncertain: 'says: not sure', ready: 'says: feels ready',
};

/**
 * The score as the operator asked for it: green checks and red X's AND a
 * percentage. The marks carry the count visually; the aria-label states it in
 * words so the pair never has to be printed twice as text (IA1). Past a dozen
 * items individual marks stop reading as a count, so one mark of each kind
 * with a numeral stands in.
 */
function ScoreMarks({ score }) {
  const { correctCount: correct, totalCount: total, percent } = score;
  const label = `${correct} of ${total} correct`;
  const pct = typeof percent === 'number' ? Math.round(percent) : Math.round((correct / total) * 100);
  return (
    <div className="teacher-lesson-card__score" role="img" aria-label={label} data-testid="score-marks">
      <span className="teacher-lesson-card__marks">
        {total <= 12 ? <>
          {Array.from({ length: correct }, (_, i) => <MarkCheck key={`c${i}`} />)}
          {Array.from({ length: total - correct }, (_, i) => <MarkCross key={`x${i}`} />)}
        </> : <>
          <MarkCheck /><span className="teacher-lesson-card__mark-count">{correct}</span>
          <MarkCross /><span className="teacher-lesson-card__mark-count">{total - correct}</span>
        </>}
      </span>
      <span className={`teacher-lesson-card__percent${pct < 80 ? ' teacher-lesson-card__percent--low' : ''}`}>{pct}%</span>
    </div>
  );
}

/** Small square tap targets for the paper record; hidden when nothing was archived. */
function ArtifactButtons({ session, onPeek }) {
  const worksheet = session?.artifacts?.worksheet ?? null;
  const receipt = session?.artifacts?.receipt ?? null;
  if (!worksheet && !receipt) return null;
  return (
    <span className="teacher-lesson-card__artifacts">
      {worksheet && (
        <button type="button" className="teacher-artifact-btn" aria-label="Peek at the worksheet"
          onClick={() => onPeek('worksheet', session)}><IconPdf /></button>
      )}
      {receipt && (
        <button type="button" className="teacher-artifact-btn" aria-label="Peek at the result receipt"
          onClick={() => onPeek('receipt', session)}><IconReceipt /></button>
      )}
    </span>
  );
}

/**
 * The artifact, right there — an overlay over the dashboard, not a route away.
 * Renders the archived bytes through the same IssuedArtifactCard the session
 * inspector uses; the digest's refs are re-shaped into that card's contract.
 * Read-only GETs of immutable artifacts: peeking pollutes nothing.
 */
function ArtifactPeek({ peek, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const { kind, session } = peek;
  const title = session.lessonTitle ?? session.title ?? 'Lesson';
  const artifact = kind === 'receipt'
    ? { ...session.artifacts.receipt, kind: 'result-receipt', availability: 'exact' }
    : { ...session.artifacts.worksheet, kind: 'worksheet', availability: 'exact' };
  return (
    <div className="teacher-artifact-peek" role="dialog" aria-modal="true"
      aria-label={`${kind === 'receipt' ? 'Result receipt' : 'Worksheet'} — ${title}`}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="teacher-artifact-peek__panel">
        <button type="button" className="teacher-artifact-peek__close" aria-label="Close preview" onClick={onClose}>
          <IconClose />
        </button>
        <IssuedArtifactCard artifact={artifact} lessonTitle={title} />
      </div>
    </div>
  );
}

const outcomeNote = (session) => {
  if (session?.effectiveScore?.totalCount != null) return null;
  return AWAITING.has(session?.reviewStatus) ? 'Awaiting review' : 'Not graded';
};

/** One lesson on the day — identity, state, score, and its paper, in one square. */
function LessonCard({ row, learnerId, base, onPeek }) {
  const session = row.session;
  const subject = session?.subject ?? row.subject;
  const title = session?.lessonTitle ?? session?.title ?? row.planned ?? 'No work offered';
  const score = session?.effectiveScore;
  const statusLabel = row.status === 'done' && row.carriedOver ? 'Done (earlier day)' : DAY_STATUS_LABEL[row.status];
  const identity = (
    <span className="teacher-lesson-card__identity">
      {session?.posterUrl && <SafeImg className="teacher-lesson-card__poster" src={session.posterUrl} alt="" fallback="" />}
      <SubjectIdentity subject={subject} />
      <strong className="teacher-lesson-card__title">{title}</strong>
      {session?.courseTitle && <span className="teacher-lesson-card__course">{session.courseTitle}</span>}
    </span>
  );
  return (
    <article className={`teacher-lesson-card teacher-lesson-card--${row.status}`} data-testid="lesson-card">
      <span className={`teacher-day-chip teacher-day-chip--${row.status}`}>{statusLabel}</span>
      {session?.sessionId
        ? <a className="teacher-lesson-card__open" href={teacherSessionPath(learnerId, session.sessionId, base, { from: 'today' })}>{identity}</a>
        : identity}
      <span className="teacher-lesson-card__foot">
        {score?.correctCount != null && score?.totalCount != null
          ? <ScoreMarks score={score} />
          : <span className="teacher-lesson-card__pending">{session ? outcomeNote(session) : row.detail ?? 'Nothing recorded yet'}</span>}
        {session && <ArtifactButtons session={session} onPeek={onPeek} />}
      </span>
    </article>
  );
}

/**
 * The expanded day for one learner. Joins the recorded sessions (already in
 * the digest row) with the day's plan (one lazy agenda-preview read) through
 * the same claim logic the day record uses, so "done" and "not yet started"
 * are one vocabulary across surfaces.
 */
function LearnerDayGrid({ row, base, studyDay: studyDayProp }) {
  const [peek, setPeek] = useState(null);
  const learnerId = row.learnerId;
  // A v1 digest carries no studyDay; default LOCAL (never the UTC date, which
  // flips to tomorrow every evening) so PrintedAgenda and the agenda read
  // always name a real day — `studyDay=undefined` is rejected as malformed.
  const studyDay = studyDayProp ?? localDay();
  const agenda = usePanelFetch(() => schoolApi.agendaPreview(learnerId, studyDay), {
    deps: [learnerId, studyDay], panel: `roster-agenda-${learnerId}`, notFoundAs: 'unavailable',
  });
  useEffect(() => {
    teacherLog.nav('drill-open', { learnerId, sessions: (row.sessions ?? []).length });
  }, [learnerId]); // eslint-disable-line react-hooks/exhaustive-deps -- one open, one event
  const sessions = row.sessions ?? row.sessionsToday ?? [];
  const carriedOver = (row.processedToday ?? []).filter((session) => session.studyDay !== studyDay);
  const joined = joinLearnerDay({
    sections: agenda.data?.sections ?? [], sessions, carriedOver, studyDay,
  });
  const openPeek = (kind, session) => {
    teacherLog.nav('artifact-peek', { learnerId, sessionId: session.sessionId, kind });
    setPeek({ kind, session });
  };
  return (
    <>
      {agenda.state === 'error' && (
        <p className="teacher-roster__plan-notice">Couldn&rsquo;t load the day&rsquo;s plan — showing recorded work only.
          <button type="button" className="teacher-panel__retry" onClick={agenda.retry}>Retry</button></p>
      )}
      {joined.rows.length > 0
        ? <div className="teacher-lesson-grid" data-testid="lesson-grid">
          {joined.rows.map((gridRow) => (
            <LessonCard key={gridRow.key} row={gridRow} learnerId={learnerId} base={base} onPeek={openPeek} />
          ))}
        </div>
        : agenda.state !== 'loading' && <p className="teacher-panel__empty">Nothing planned or recorded for this day.</p>}
      <PrintedAgenda learnerId={learnerId} studyDay={studyDay} />
      <a className="teacher-btn teacher-btn--quiet teacher-roster__day-link"
        href={teacherDayPath(learnerId, row.studyDay ?? undefined, base)}>
        Open the full day record →
      </a>
      {peek && <ArtifactPeek peek={peek} onClose={() => setPeek(null)} />}
    </>
  );
}

export default function RosterStrip({ rows, kids, studyDay = null }) {
  const [openId, setOpenId] = useState(null);
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  return (
    <div className="teacher-roster">
      {rows.map((row) => (
        <div key={row.learnerId} className="teacher-roster__entry">
          {(() => { const panelId = `teacher-day-${String(row.learnerId).replace(/[^a-z0-9_-]/gi, '-')}`;
            const sessions = row.sessions ?? row.sessionsToday ?? [];
            const base = teacherBaseFor(globalThis.location?.pathname ?? '');
            return <>
          <button
            type="button"
            className="teacher-roster__card"
            onClick={() => setOpenId((cur) => (cur === row.learnerId ? null : row.learnerId))}
            aria-expanded={openId === row.learnerId}
            aria-controls={panelId}
          >
            <ProfileAvatar id={row.learnerId} name={nameFor(row.learnerId)} />
            <span className="teacher-roster__name">{nameFor(row.learnerId)}</span>
            {(row.effectiveScoreTotals?.total ?? row.attemptsToday) > 0 ? (
              <span className="teacher-roster__stats">
                {row.effectiveScoreTotals?.correct ?? row.correctToday} / {row.effectiveScoreTotals?.total ?? row.attemptsToday} correct
                {sessions.length > 1 ? ` across ${sessions.length} assignments` : ''}
              </span>
            ) : (
              // "0 / 0 correct — idle" was division-by-zero as a status line
              // (design audit): a quiet phrase carries the same fact kindly.
              <span className="teacher-roster__stats teacher-roster__stats--none">nothing yet today</span>
            )}
            {sessions.length > 0 && (
              <span className="teacher-roster__sessions">
                {`${sessions.length} session${sessions.length > 1 ? 's' : ''}`}
              </span>
            )}
            {row.pendingReview > 0 && (
              <span className="teacher-roster__badge">{row.pendingReview} to review</span>
            )}
          </button>
          <span className="teacher-roster__disclosure" aria-hidden="true"><IconChevron open={openId === row.learnerId} /></span>
          {/* A learner with nothing recorded is not a dead end: the plan for
              the day is the next thing a teacher wants to see. */}
          {!((row.effectiveScoreTotals?.total ?? row.attemptsToday) > 0) && (
            <a className="teacher-btn teacher-btn--quiet teacher-roster__plan-link"
               href={teacherDayPath(row.learnerId, row.studyDay ?? undefined, base)}>
              See today’s plan →
            </a>
          )}
          {/* The kid's own words about today's work (advocacy wave 7):
              reflections used to be written and read by nobody. */}
          {(row.reflectionsToday ?? []).length > 0 && (
            <ul className="teacher-roster__reflections" data-testid="reflections">
              {(row.reflectionsToday ?? []).map((r, i) => (
                // eslint-disable-next-line react/no-array-index-key -- order stable within one fetch
                <li key={i} className="teacher-roster__reflection">
                  {r.selfAssessment && <span className="teacher-roster__reflection-mood">{SELF_LABEL[r.selfAssessment] ?? r.selfAssessment}</span>}
                  {r.note && <span className="teacher-roster__reflection-note">&ldquo;{r.note}&rdquo;</span>}
                </li>
              ))}
            </ul>
          )}
          {openId === row.learnerId && <div id={panelId} className="teacher-roster__details">
            <LearnerDayGrid row={row} base={base} studyDay={studyDay ?? row.studyDay ?? null} />
          </div>}
          </>; })()}
        </div>
      ))}
    </div>
  );
}
