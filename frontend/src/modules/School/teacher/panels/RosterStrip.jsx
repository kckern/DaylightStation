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
 * Every artifact here is one tap from its icon — the worksheet PDF, the result
 * receipt, and the learner's own printed agenda (which lives on the roster
 * card, above the disclosure, because it is the sheet a parent wants before
 * deciding whether to expand anything). None of them is worth a modal: there
 * is a single destination behind each, and an overlay in front of one
 * destination is a tap and a dismissal charged for nothing.
 *
 * Previewing stays side-effect free: every read here is a GET that creates no
 * session, print, ticket, or code — the agenda preview route is inert by
 * construction (`X-School-Preview: agenda-non-recording`).
 */
import { useEffect, useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import SafeImg from './SafeImg.jsx';
import { agendaPreviewSrc } from './LearnerDayView.jsx';
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
const IconAgenda = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M5 2h10v15l-2-1.4-2 1.4-2-1.4L7 17l-2-1.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.2 6h5.6M7.2 8.8h5.6M7.2 11.6h3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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

/**
 * Small square tap targets for the paper record; hidden when nothing was
 * archived.
 *
 * STRAIGHT TO THE FILE. These used to open a modal whose entire content was
 * one thumbnail and an "Open worksheet" link — an interstitial in front of a
 * single destination, which is a tap and a dismissal charged for nothing. The
 * button IS the link now. The PDF is an anchor (a real link a teacher can
 * middle-click or long-press); the receipt PNG goes through `window.open` so
 * the log line still fires on the way out.
 */
function ArtifactButtons({ session, onOpen }) {
  const worksheet = session?.artifacts?.worksheet ?? null;
  const receipt = session?.artifacts?.receipt ?? null;
  const worksheetUrl = worksheet?.originalPdfUrl ?? null;
  const receiptUrl = receipt?.originalUrl ?? null;
  if (!worksheetUrl && !receiptUrl) return null;
  return (
    <span className="teacher-lesson-card__artifacts">
      {worksheetUrl && (
        <a className="teacher-artifact-btn" aria-label="Open the worksheet" href={worksheetUrl}
          target="_blank" rel="noreferrer"
          onClick={() => onOpen('worksheet', session)}><IconPdf /></a>
      )}
      {receiptUrl && (
        <button type="button" className="teacher-artifact-btn" aria-label="Open the result receipt"
          onClick={() => { onOpen('receipt', session); window.open(receiptUrl, '_blank', 'noopener'); }}>
          <IconReceipt />
        </button>
      )}
    </span>
  );
}

const outcomeNote = (session) => {
  if (session?.effectiveScore?.totalCount != null) return null;
  return AWAITING.has(session?.reviewStatus) ? 'Awaiting review' : 'Not graded';
};

/** One lesson on the day — identity, state, score, and its paper, in one square. */
function LessonCard({ row, learnerId, base, onOpen }) {
  const session = row.session;
  const subject = session?.subject ?? row.subject;
  const title = session?.lessonTitle ?? session?.title ?? row.planned ?? 'No work offered';
  const score = session?.effectiveScore;
  const statusLabel = row.status === 'done' && row.carriedOver ? 'Done (earlier day)' : DAY_STATUS_LABEL[row.status];
  // THE POSTER FRAME IS ALWAYS DRAWN, poster or not.
  //
  // It used to be a conditional full-width 52px band — a letterboxed strip of
  // a portrait poster, cropped to a rug. Two problems, both fixed here: art
  // shot at 2:3 is shown at 2:3, and the box holding it exists before the
  // bytes arrive. A frame that appears when an image loads, or vanishes when
  // one 404s, moves every word on the card underneath it; a card in a grid of
  // cards moves its neighbours too. Reserved space is the whole point — the
  // layout is identical at first paint, on load, and on failure.
  const identity = (
    <span className="teacher-lesson-card__identity">
      <span className="teacher-lesson-card__poster">
        {session?.posterUrl && <SafeImg src={session.posterUrl} alt="" fallback="" />}
      </span>
      <span className="teacher-lesson-card__copy">
        <SubjectIdentity subject={subject} />
        <strong className="teacher-lesson-card__title">{title}</strong>
        {session?.courseTitle && <span className="teacher-lesson-card__course">{session.courseTitle}</span>}
      </span>
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
        {session && <ArtifactButtons session={session} onOpen={onOpen} />}
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
  const openArtifact = (kind, session) => {
    teacherLog.nav('artifact-open', { learnerId, sessionId: session.sessionId, kind });
  };
  return (
    <>
      {agenda.state === 'error' && (
        <p className="teacher-roster__plan-notice">Couldn&rsquo;t load the day&rsquo;s plan — showing recorded work only.
          <button type="button" className="teacher-panel__retry" onClick={agenda.retry}>Retry</button></p>
      )}
      {/* The grid waits for the plan. Rendering the recorded sessions first and
          letting the planned ones drop in when the agenda read lands re-flows
          the whole grid under a teacher who has already started reading it —
          cards move, and a tap can land on a card that was somewhere else a
          frame ago. One reserved-height line holds the space instead. */}
      {agenda.state === 'loading'
        ? <p className="teacher-roster__plan-loading" aria-busy="true">Loading the day&rsquo;s plan…</p>
        : joined.rows.length > 0
          ? <div className="teacher-lesson-grid" data-testid="lesson-grid">
            {joined.rows.map((gridRow) => (
              <LessonCard key={gridRow.key} row={gridRow} learnerId={learnerId} base={base} onOpen={openArtifact} />
            ))}
          </div>
          : <p className="teacher-panel__empty">Nothing planned or recorded for this day.</p>}
      <a className="teacher-btn teacher-btn--quiet teacher-roster__day-link"
        href={teacherDayPath(learnerId, row.studyDay ?? undefined, base)}>
        Open the full day record →
      </a>
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
          {/* THE AGENDA BELONGS ON THE CARD, not behind the disclosure. It is
              the child's paper for the day — the thing a parent reaches for
              before deciding whether to open anything at all — and it used to
              cost an accordion open plus a "Show the printed agenda" toggle to
              reach. One tap, straight to the sheet. */}
          <a className="teacher-artifact-btn teacher-roster__agenda-link"
            href={agendaPreviewSrc(row.learnerId, studyDay ?? row.studyDay ?? localDay())}
            target="_blank" rel="noreferrer"
            aria-label={`Open ${nameFor(row.learnerId)}'s printed agenda`}
            onClick={() => teacherLog.nav('agenda-open', { learnerId: row.learnerId })}>
            <IconAgenda />
          </a>
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
