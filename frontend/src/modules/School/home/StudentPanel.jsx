import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { sectionForReport } from '../programs.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { useLearnerFeedback } from './useLearnerFeedback.js';
import { labelize } from '../teacher/labelize.js';
import { useLearnerStanding } from './useLearnerStanding.js';

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

/** Kiosk house rule: inline SVG, never unicode glyphs (WebView renders
 * unrecognized unicode as tofu boxes). currentColor so it inherits the
 * item's is-correct/is-incorrect ink; sized to sit inline with the note
 * text like the glyph it replaces. */
function CorrectIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M4 12.5l5.5 5.5L20 6" />
    </svg>
  );
}

function NoteIcon() {
  // A little envelope: a note is a message, not a verdict.
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="#3d5a80" strokeWidth="2" />
      <path d="M4 8l8 6 8-6" fill="none" stroke="#3d5a80" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IncorrectIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

function relativeDay(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  // A precise growing counter ("24 days ago") reads as a scoreboard of guilt
  // on a kid's own panel — and "a while ago" is a shrug typeset as data
  // (design audit). Past two weeks, say nothing at all.
  if (days <= 13) return `${days} days ago`;
  return null;
}

export default function StudentPanel({ onOpen, bankTitles }) {
  const { currentUser, openPicker, roster, claim } = useSchoolProfile();
  const [reports, setReports] = useState(null);
  const [results, setResults] = useState(null);
  const [coins, setCoins] = useState(null);
  const [todaySections, setTodaySections] = useState(null);

  useEffect(() => {
    if (!currentUser?.id) {
      setReports(null); setResults(null); setCoins(null); setTodaySections(null);
      return undefined;
    }
    let alive = true;
    schoolApi.report(currentUser.id, 'learner').then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !data) { schoolLog.materialsError('report-failed', { userId: currentUser.id }); return; }
      setReports(data.learners[0]?.reports ?? []);
    });
    schoolApi.results(currentUser.id).then(({ ok, data }) => {
      if (alive && ok && Array.isArray(data)) setResults(data);
    });
    // Coins the kid has actually banked (advocacy: rewards they can SEE).
    // Wallet unavailable -> omit the fact quietly, never an error. Optional
    // call: the economy app is a separate module and this panel must not
    // depend on its presence.
    schoolApi.wallet?.(currentUser.id)?.then(({ ok, data }) => {
      if (alive && ok && typeof data?.balance === 'number') setCoins(data.balance);
    });
    // Today's dry-run plan (debt W7a) — the same side-effect-free preview
    // the teacher's LearnerDay panel reads. Any failure or an empty plan
    // just omits the block quietly: a rail never shows an error card.
    schoolApi.agendaPreview(currentUser.id).then(({ ok, data }) => {
      if (!alive) return;
      const sections = ok && data ? (data.sections ?? []) : [];
      setTodaySections(sections.length ? sections : null);
    });
    return () => { alive = false; };
  }, [currentUser?.id]);

  const model = useMemo(() => derivePanelModel(reports), [reports]);
  const score = useMemo(() => deriveLatestScore(results, bankTitles), [results, bankTitles]);
  // Feedback delivery + kid-visible standing (Task 9, spec R7 / adequacy
  // SHOULD 9). Both hooks no-op quietly with no claimed learner.
  const { items: feedback, hasNew, markSeen } = useLearnerFeedback(currentUser?.id ?? null);
  const { courses: standing } = useLearnerStanding(currentUser?.id ?? null);

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
          <span className="school-rail__next-course">{labelize(model.primary.label)}</span>
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

      {(score || model.lastActivity || coins != null) && (
        <div className="school-rail__facts">
          {score && <span>Latest: {score.label} · {score.pct}%</span>}
          {coins != null && <span>Coins: {coins}</span>}
          {/* A label with no value is worse than a vague phrase (M9 fix 3):
              render the row only when the humane date exists. */}
          {model.lastActivity && relativeDay(model.lastActivity) && (
            <span>Last active {relativeDay(model.lastActivity)}</span>
          )}
        </div>
      )}

      {/* Today's plan (debt W7a) — the dry-run agenda, so the kid sees their
          own day, not just the single "up next" pick above. No sections or
          a failed fetch -> omit quietly, never an error card on the rail. */}
      {todaySections && todaySections.length > 0 && (
        <div className="school-rail__today">
          <h4 className="school-rail__today-title">Today</h4>
          <ul className="school-rail__today-list">
            {todaySections.map((section) => (
              <li key={section.subject} className="school-rail__today-item">
                <span className="school-rail__today-subject">{labelize(section.subject)}</span>
                <span className="school-rail__today-next">
                  {section.servedToday
                    ? 'done today'
                    : section.suppressed
                      ? 'focus work scheduled today'
                    : (section.next?.title ?? section.next?.label
                        ?? (section.next?.unitId ? labelize(section.next.unitId) : undefined)
                        ?? section.lockedRemedy ?? section.timingNotice ?? 'nothing offered')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Kid-visible standing (adequacy SHOULD 9): "Fractions: 87%" per
          course with a graded session, this period. No current period or
          nothing graded yet -> omit quietly, never a "no grades" scold. */}
      {standing.length > 0 && (
        <div className="school-rail__standing">
          <h4 className="school-rail__standing-title">Where you stand</h4>
          <ul className="school-rail__standing-list">
            {standing.map((course) => (
              <li key={course.courseId} className="school-rail__standing-item">
                <span className="school-rail__standing-label">{course.label}</span>
                <span className="school-rail__standing-percent">{course.percent}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Feedback delivery (spec R7): a grown-up's marks and notes, where the
          child can actually see them. No resolved items -> omit quietly, a
          kid needs no empty scold. */}
      {feedback.length > 0 && (
        <div className="school-rail__feedback">
          <h4 className="school-rail__feedback-title" onClick={markSeen}>
            Feedback
            {hasNew && <span className="school-rail__feedback-new" data-testid="feedback-new">New</span>}
          </h4>
          <ul className="school-rail__feedback-list">
            {feedback.map((item) => (
              <li key={item.itemId} className={`school-rail__feedback-item is-${item.kind === 'note' ? 'note' : item.verdict}`}>
                <span className="school-rail__feedback-verdict" aria-hidden="true">
                  {/* A parent's NOTE is never a wrong-answer X (student-advocacy #4). */}
                  {item.kind === 'note' ? <NoteIcon /> : item.verdict === 'correct' ? <CorrectIcon /> : <IncorrectIcon />}
                </span>
                <span className="school-rail__feedback-note">
                  {item.note || item.prompt || (item.questionNumber != null ? `Question ${item.questionNumber}` : 'One of your answers')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
