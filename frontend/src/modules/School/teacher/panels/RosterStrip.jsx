/**
 * RosterStrip — one card per learner from GET /teacher/today, joined with the
 * kids' roster for names (digest rows carry learnerId only, by design).
 * Tapping a card expands the LearnerDay drill-in beneath it.
 */
import { useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import LearnerDay from './LearnerDay.jsx';
import { teacherBaseFor, teacherSessionPath } from '../teacherUrl.js';
import { LessonIdentity } from '../CurriculumIdentity.jsx';

function humanDay(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  }).format(date);
}

function outcomeLine(session) {
  const score = session.effectiveScore;
  if (score?.correctCount != null && score?.totalCount != null) {
    return `${score.correctCount} of ${score.totalCount} correct${score.percent == null ? '' : ` · ${Math.round(score.percent)}%`}`;
  }
  return session.reviewStatus === 'pending_review' ? 'Awaiting review' : 'Not graded';
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
            {sessions.length > 0 && <div className="teacher-day-sessions">{sessions.map((session) => <a className="teacher-day-session" key={session.sessionId ?? session.unitId} href={teacherSessionPath(row.learnerId, session.sessionId, base)}>
              <LessonIdentity subject={session.subject} courseTitle={session.courseTitle} moduleTitle={session.moduleTitle} lessonTitle={session.lessonTitle ?? session.title} posterUrl={session.posterUrl} compact />
              <small className="teacher-day-session__outcome">{[humanDay(session.studyDay), outcomeLine(session)].filter(Boolean).join(' · ')}</small>
            </a>)}</div>}
            {(row.processedToday ?? []).length > 0 && <section className="teacher-processed"><h3>Processed today</h3>{row.processedToday.map((session) => <a key={session.sessionId} href={teacherSessionPath(row.learnerId, session.sessionId, base)}><strong>{session.lessonTitle ?? 'Lesson'}</strong><span>Work from {session.studyDay} · processed {session.processedAt ? new Date(session.processedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'today'}</span></a>)}</section>}
            <LearnerDay sessions={sessions} />
          </div>}
          </>; })()}
        </div>
      ))}
    </div>
  );
}
