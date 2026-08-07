/**
 * RosterStrip — one card per learner from GET /teacher/today, joined with the
 * kids' roster for names (digest rows carry learnerId only, by design).
 * Tapping a card expands the LearnerDay drill-in beneath it.
 */
import { useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import LearnerDay from './LearnerDay.jsx';

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
          <button
            type="button"
            className="teacher-roster__card"
            onClick={() => setOpenId((cur) => (cur === row.learnerId ? null : row.learnerId))}
          >
            <ProfileAvatar id={row.learnerId} name={nameFor(row.learnerId)} />
            <span className="teacher-roster__name">{nameFor(row.learnerId)}</span>
            {row.attemptsToday > 0 ? (
              <span className="teacher-roster__stats">
                {row.correctToday} / {row.attemptsToday} correct
              </span>
            ) : (
              // "0 / 0 correct — idle" was division-by-zero as a status line
              // (design audit): a quiet phrase carries the same fact kindly.
              <span className="teacher-roster__stats teacher-roster__stats--none">nothing yet today</span>
            )}
            {row.sessionsToday.length > 0 && (
              <span className="teacher-roster__sessions">
                {`${row.sessionsToday.length} session${row.sessionsToday.length > 1 ? 's' : ''}`}
              </span>
            )}
            {row.pendingReview > 0 && (
              <span className="teacher-roster__badge">{row.pendingReview} to review</span>
            )}
          </button>
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
          {openId === row.learnerId && <LearnerDay learnerId={row.learnerId} />}
        </div>
      ))}
    </div>
  );
}
