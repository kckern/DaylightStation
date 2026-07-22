import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { sectionForReport } from '../programs.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';

/**
 * The student panel — the top of the home's meta rail. This is where the old
 * primary/secondary "up next" cards went: the learner's identity, their next
 * step (tap = launch), their latest score and last activity, and the
 * done-for-today flip, all in one card. Tapping the identity row opens the
 * full progress board (ReportPanel).
 *
 * Unclaimed, the panel IS the claim affordance: a personal dashboard for
 * nobody is meaningless, so it asks who's learning instead.
 */

/** Pure model: which report leads, today's metric, the done flip, last activity. */
export function derivePanelModel(reports) {
  const list = reports ?? [];
  const actionable = list.filter((r) => r.next && r.state !== 'satisfied' && r.state !== 'complete');
  const primary = actionable[0] ?? null;
  const today = primary?.metrics?.find((m) => m.kind === 'progress' && m.scope === 'today') ?? null;
  const allDone = actionable.length === 0 && list.length > 0;
  const lastActivity = list.reduce(
    (max, r) => (r.lastActivity && (!max || r.lastActivity > max) ? r.lastActivity : max),
    null,
  );
  return { primary, today, allDone, lastActivity };
}

/**
 * Pure model: the most recently touched results lane, as an accuracy percent.
 * Results are per-bank lifetime aggregates (spec §5 keeps quiz and flashcard
 * lanes separate), so this is "how you're doing on the thing you last did",
 * not a single attempt's score.
 */
export function deriveLatestScore(results, bankTitles) {
  let best = null;
  for (const r of results ?? []) {
    for (const lane of ['quiz', 'flashcard']) {
      const l = r[lane];
      if (l?.lastAt && l.attempts > 0 && (!best || l.lastAt > best.lastAt)) {
        best = { lastAt: l.lastAt, pct: Math.round((l.correct / l.attempts) * 100), bankId: r.bankId };
      }
    }
  }
  if (!best) return null;
  return { label: bankTitles?.get(best.bankId) ?? best.bankId, pct: best.pct };
}

function relativeDay(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export default function StudentPanel({ onOpen, bankTitles }) {
  const { currentUser, openPicker, roster, claim } = useSchoolProfile();
  const [reports, setReports] = useState(null);
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!currentUser?.id) { setReports(null); setResults(null); return undefined; }
    let alive = true;
    schoolApi.report(currentUser.id, 'learner').then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !data) { schoolLog.materialsError('report-failed', { userId: currentUser.id }); return; }
      setReports(data.learners[0]?.reports ?? []);
    });
    schoolApi.results(currentUser.id).then(({ ok, data }) => {
      if (alive && ok && Array.isArray(data)) setResults(data);
    });
    return () => { alive = false; };
  }, [currentUser?.id]);

  const model = useMemo(() => derivePanelModel(reports), [reports]);
  const score = useMemo(() => deriveLatestScore(results, bankTitles), [results, bankTitles]);

  if (!currentUser) {
    // The faces ARE the claim affordance: one tap on your own face, no
    // intermediate picker. (Guests included — a guest claiming a face is
    // just signing in.) Only the kids: parents claim through the picker
    // (launch prompt), not the panel. Missing birthyear fails open — a kid
    // must never vanish from the wall over absent data. Roster-fetch
    // failure leaves no faces, so keep the picker button as the fallback
    // affordance rather than a dead panel.
    const kids = roster.filter(
      (u) => !u.birthyear || new Date().getFullYear() - u.birthyear < 18,
    );
    return (
      <section className="school-rail__student school-rail__student--unclaimed">
        <p className="school-rail__ask">Who&apos;s learning?</p>
        {kids.length ? (
          <div className="school-rail__faces">
            {kids.map((u) => (
              <button
                key={u.id}
                type="button"
                className="school-rail__face"
                onClick={() => claim(u.id)}
              >
                <ProfileAvatar id={u.id} name={u.name} />
                <span>{String(u.name).split(' ')[0]}</span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="school-rail__claim" onClick={openPicker}>
            Choose your face
          </button>
        )}
      </section>
    );
  }

  const primarySection = model.primary ? sectionForReport(model.primary) : null;
  const blocked = model.primary?.next?.blocked;

  return (
    <section className="school-rail__student">
      <button
        type="button"
        className="school-rail__identity"
        onClick={() => onOpen('progress')}
        aria-label="My progress"
      >
        <ProfileAvatar id={currentUser.id} name={currentUser.name} />
        <span className="school-rail__name">{String(currentUser.name).split(' ')[0]}</span>
        <span className="school-rail__more">My progress ›</span>
      </button>

      {model.primary && (
        <button
          type="button"
          className={`school-rail__next${blocked ? ' is-blocked' : ''}`}
          onClick={primarySection ? () => onOpen(primarySection) : undefined}
          disabled={!primarySection}
        >
          <span className="school-rail__next-tag">Up next</span>
          <span className="school-rail__next-course">{model.primary.label}</span>
          {/* When blocked, the REMEDY is the button text (LearnerHome's rule,
              carried forward): a child never meets a wall without a sign. */}
          <span className="school-rail__next-action">
            {blocked ? model.primary.next.blockedReason : model.primary.next?.label}
          </span>
          {model.today && (
            <span className="school-rail__next-count">
              {model.today.value} of {model.today.total} today
            </span>
          )}
        </button>
      )}

      {model.allDone && (
        <div className="school-rail__done">
          <p className="school-rail__done-mark">Done for today</p>
          <p className="school-rail__done-sub">It&apos;s all yours.</p>
        </div>
      )}

      {(score || model.lastActivity) && (
        <div className="school-rail__facts">
          {score && <span>Latest: {score.label} · {score.pct}%</span>}
          {model.lastActivity && <span>Last active {relativeDay(model.lastActivity)}</span>}
        </div>
      )}
    </section>
  );
}
