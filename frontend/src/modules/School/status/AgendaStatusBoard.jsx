/**
 * AgendaStatusBoard — a read-only, at-a-glance board of every student's school
 * day: how many agenda lessons exist, how many are done, and a status word.
 *
 * Deliberately NON-INTERACTIVE (kiosk spec wave 5): it renders on the locked
 * Portal beside the keypad as a reminder/preview only — codes and printed
 * agendas remain the only entry path, so the rows accept no taps and the
 * board must never block or delay the keypad. It reads the same models the
 * teacher console uses: the agenda dry-run preview (the plan) and the teacher
 * day digest (what's done). Exported for reuse by adult surfaces that may
 * mount a more interactive variant later.
 */
import { useEffect, useMemo, useState } from 'react';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

const REFRESH_MS = 5 * 60_000;

export function dayStatus({ total, done }) {
  if (!total) return null;
  if (done >= total) return 'Done for the day';
  if (done > 0) return 'In progress';
  return 'Not started';
}

// The plan ∪ the outcomes, per learner: agenda sections (suppressed ones
// excluded) matched against passed sessions by subject. This is the coarse
// counting version; the teacher workspace's Learner Day does the same join
// per-row and by unit id (teacher/learnerDay.js#joinLearnerDay), because a
// subject key double-counts a unit the planner bucketed into 'other'.
export function summarize(sections, sessions) {
  const planned = (sections ?? []).filter((section) => !section.suppressed);
  const passedSubjects = new Set((sessions ?? [])
    .filter((session) => session.outcome?.result === 'passed')
    .map((session) => session.subject));
  const done = planned.filter((section) => section.servedToday || passedSubjects.has(section.subject)).length;
  return { total: planned.length, done };
}

export default function AgendaStatusBoard({ kids = [], day }) {
  const [rows, setRows] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!kids.length || !day) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const [dayResponse, ...plans] = await Promise.all([
          schoolApi.teacherDay ? schoolApi.teacherDay(day) : Promise.resolve({ ok: false }),
          ...kids.map((kid) => schoolApi.agendaPreview(kid.id, day)),
        ]);
        if (!alive) return;
        const learners = dayResponse.ok ? (dayResponse.data?.learners ?? []) : [];
        const next = kids.map((kid, index) => {
          const plan = plans[index];
          if (!plan?.ok) return { kid, summary: null };
          const sessions = learners.find((row) => row.learnerId === kid.id)?.sessions ?? [];
          return { kid, summary: summarize(plan.data?.sections, sessions) };
        });
        setRows(next.every((row) => row.summary === null) ? null : next);
      } catch (error) {
        if (!alive) return;
        schoolLog.selfServiceError?.('status-board.load-failed', { error: error?.message });
        setRows(null);
      }
    };
    load();
    return () => { alive = false; };
  }, [kids, day, nonce]);

  // Periodic refresh — minutes, not seconds; a hidden panel refreshes nothing.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') setNonce((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(() => rows ?? [], [rows]);
  if (!visible.length) return null;
  return (
    <div className="school-status-board" data-testid="agenda-status-board">
      <h2 className="school-status-board__title">Today</h2>
      {/* One card per student, equal height whether or not a plan loaded —
          the board is a wall fixture, and four uneven rows read as broken. */}
      <ul className="school-status-board__rows">
        {visible.map(({ kid, summary }) => (
          <li key={kid.id} className="school-status-board__row" data-status={summary ? dayStatus(summary) : null}>
            <ProfileAvatar id={kid.id} name={kid.name} size={192} />
            <div className="school-status-board__info">
              <div className="school-status-board__line">
                <span className="school-status-board__name">{kid.name}</span>
                {summary && summary.total > 0 ? (
                  <span className="school-status-board__status">{dayStatus(summary)}</span>
                ) : (
                  <span className="school-status-board__status school-status-board__status--none">No plan to show</span>
                )}
              </div>
              {summary && summary.total > 0 && (
                <>
                  <span className="school-status-board__pills" aria-hidden="true">
                    {Array.from({ length: summary.total }, (_, i) => (
                      <i key={i} className={`school-status-board__pill${i < summary.done ? ' is-done' : ''}`} />
                    ))}
                  </span>
                  <span className="school-status-board__count">{summary.done} of {summary.total}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
