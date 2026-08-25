/**
 * RosterStrip — one card per learner from GET /teacher/today, joined with the
 * kids' roster for names (digest rows carry learnerId only, by design).
 * Tapping a card expands the LearnerDay drill-in beneath it.
 */
import { useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import LearnerDay from './LearnerDay.jsx';
import { teacherBaseFor, teacherSessionPath } from '../teacherUrl.js';

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
              {session.posterUrl && <img src={session.posterUrl} alt="" />}
              <span><strong>{session.lessonTitle ?? session.title ?? 'Lesson'}</strong><small>{[session.subject, session.courseTitle, session.moduleTitle].filter(Boolean).join(' → ')}</small><small>{session.studyDay ?? ''} · {session.effectiveScore?.percent == null ? 'Not graded' : `${session.effectiveScore.percent}%`} · {session.reviewStatus ?? session.state}</small></span>
            </a>)}</div>}
            {(row.processedToday ?? []).length > 0 && <section className="teacher-processed"><h3>Processed today</h3>{row.processedToday.map((session) => <a key={session.sessionId} href={teacherSessionPath(row.learnerId, session.sessionId, base)}><strong>{session.lessonTitle ?? 'Lesson'}</strong><span>Work from {session.studyDay} · processed {session.processedAt ? new Date(session.processedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'today'}</span></a>)}</section>}
            <LearnerDay learnerId={row.learnerId} />
          </div>}
          </>; })()}
        </div>
      ))}
    </div>
  );
}
