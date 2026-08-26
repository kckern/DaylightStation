/**
 * RosterStrip — one card per learner from GET /teacher/today, joined with the
 * kids' roster for names (digest rows carry learnerId only, by design).
 *
 * Tapping a card expands a COMPACT drill-in: today's sessions, and one link
 * into the learner's day record. It deliberately does not re-render the day
 * (UX audit IA1) — the paper records, the plan, and the earlier-day grading
 * all live on the day record, which owns them once.
 */
import { useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import { teacherBaseFor, teacherDayPath, teacherSessionPath } from '../teacherUrl.js';
import { LessonIdentity } from '../CurriculumIdentity.jsx';
import { humanDate } from '../teacherDates.js';

// `reviewStatus` is 'pending' | 'complete' on the wire; this file tested for a
// 'pending_review' that never arrives, so an unmarked session read "Not
// graded". Accept both spellings so the fix survives a backend rename.
const AWAITING = new Set(['pending', 'pending_review']);
function outcomeLine(session) {
  const score = session.effectiveScore;
  if (score?.correctCount != null && score?.totalCount != null) {
    // No trailing percent: "5 of 5 correct · 100%" states one fact twice.
    return `${score.correctCount} of ${score.totalCount} correct`;
  }
  return AWAITING.has(session.reviewStatus) ? 'Awaiting review' : 'Not graded';
}

const SELF_LABEL = {
  not_yet: 'says: not yet', uncertain: 'says: not sure', ready: 'says: feels ready',
};

export default function RosterStrip({ rows, kids }) {
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
          <span className="teacher-roster__disclosure" aria-hidden="true">{openId === row.learnerId ? '▾' : '▸'}</span>
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
            {sessions.length > 0 && <div className="teacher-day-sessions">{sessions.map((session) => <a className="teacher-day-session" key={session.sessionId ?? session.unitId} href={teacherSessionPath(row.learnerId, session.sessionId, base, { from: 'today' })}>
              <LessonIdentity subject={session.subject} courseTitle={session.courseTitle} moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? session.title} posterUrl={session.posterUrl} compact />
              <small className="teacher-day-session__outcome">{[humanDate(session.studyDay), outcomeLine(session)].filter(Boolean).join(' · ')}</small>
            </a>)}</div>}
            <a className="teacher-btn teacher-btn--quiet teacher-roster__day-link"
               href={teacherDayPath(row.learnerId, row.studyDay ?? undefined, base)}>
              Open the full day record →
            </a>
          </div>}
          </>; })()}
        </div>
      ))}
    </div>
  );
}
