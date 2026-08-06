/**
 * RosterStrip — one card per learner from GET /teacher/today, joined with the
 * kids' roster for names (digest rows carry learnerId only, by design).
 * Tapping a card expands the LearnerDay drill-in beneath it.
 */
import { useState } from 'react';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import LearnerDay from './LearnerDay.jsx';

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
            <span className="teacher-roster__stats">
              {row.correctToday} / {row.attemptsToday} correct
            </span>
            <span className="teacher-roster__sessions">
              {row.sessionsToday.length ? `${row.sessionsToday.length} session${row.sessionsToday.length > 1 ? 's' : ''}` : 'idle'}
            </span>
            {row.pendingReview > 0 && (
              <span className="teacher-roster__badge">{row.pendingReview} to review</span>
            )}
          </button>
          {openId === row.learnerId && <LearnerDay learnerId={row.learnerId} />}
        </div>
      ))}
    </div>
  );
}
