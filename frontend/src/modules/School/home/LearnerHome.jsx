import { useEffect, useMemo, useState } from 'react';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { sectionForReport } from '../programs.js';
import SectionGrid from './SectionGrid.jsx';

/**
 * The learner's home — what to do next, not what content exists.
 *
 * The previous home was a grid of category nouns: it answered "what is in this
 * system", identically every day and identically for every child, while the
 * one thing the system actually knew about the child standing there — their
 * next step — sat one tap deep behind a tile called "Progress" whose hint was
 * written in the third person for a parent.
 *
 * This screen inverts that. Obligation first at high weight, free browse
 * second at low weight, and **the weights swap when the day's work is done** —
 * which is the homeschool bargain made visible rather than asserted.
 *
 * Everything here comes from the report contract with `audience: 'learner'`,
 * so parent instrumentation (scores, streaks, trends, seat-time, triage flags)
 * is filtered server-side and never reaches this component to be rendered by
 * accident.
 */

function greeting(name) {
  return name ? `Hi ${name.split(' ')[0]}` : 'Hi';
}

/**
 * The one card that answers "what do I do now". Sized, because a child weighs
 * the cost of starting before they start, and "12 sentences" is a far smaller
 * commitment than an unbounded "continue".
 */
function PrimaryCard({ report, onOpen }) {
  const section = sectionForReport(report);
  const blocked = report.next?.blocked;
  const today = report.metrics.find((m) => m.kind === 'progress' && m.scope === 'today');

  return (
    <button
      type="button"
      className={`school-next school-next--primary${blocked ? ' is-blocked' : ''}`}
      onClick={section ? () => onOpen(section) : undefined}
      disabled={!section}
    >
      <span className="school-next__course">{report.label}</span>
      {/* When blocked, the REMEDY is the button text. A child should never
          meet a wall whose sign does not say how to get past it. */}
      <span className="school-next__action">
        {blocked ? report.next.blockedReason : report.next?.label}
      </span>
      {!blocked && report.next?.detail && (
        <span className="school-next__detail">{report.next.detail}</span>
      )}
      {today && (
        <span className="school-next__bar" aria-hidden="true">
          <span
            className="school-next__bar-fill"
            style={{ width: `${Math.min(100, (today.value / today.total) * 100)}%` }}
          />
        </span>
      )}
      {today && (
        <span className="school-next__count">{today.value} of {today.total} done today</span>
      )}
    </button>
  );
}

function SecondaryCard({ report, onOpen }) {
  const section = sectionForReport(report);
  const blocked = report.next?.blocked;
  return (
    <button
      type="button"
      className={`school-next school-next--secondary${blocked ? ' is-blocked' : ''}`}
      onClick={section ? () => onOpen(section) : undefined}
      disabled={!section}
    >
      <span className="school-next__course">{report.label}</span>
      <span className="school-next__action">
        {blocked ? report.next.blockedReason : report.next?.label}
      </span>
    </button>
  );
}

export default function LearnerHome({ user, sections, onOpen, onSwitchProfile }) {
  const [reports, setReports] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!user?.id) return undefined;
    let alive = true;
    setStatus('loading');
    schoolApi.report(user.id, 'learner').then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !data) {
        // The home must still be usable when the report fails — a child who
        // cannot browse because a summary endpoint is down is stuck.
        schoolLog.materialsError('report-failed', { userId: user.id });
        setStatus('error');
        return;
      }
      setReports(data.learners[0]?.reports ?? []);
      setStatus('ready');
    });
    return () => { alive = false; };
  }, [user?.id]);

  // Only work that can actually be started leads. `satisfied` and `complete`
  // carry no call to action, so they never occupy the primary slot.
  const actionable = useMemo(
    () => (reports ?? []).filter((r) => r.next && r.state !== 'satisfied' && r.state !== 'complete'),
    [reports],
  );
  const [primary, ...secondary] = actionable;
  const allDone = status === 'ready' && actionable.length === 0 && (reports ?? []).length > 0;

  return (
    <div className={`school-home${allDone ? ' is-free' : ''}`}>
      <header className="school-home__hello">
        <ProfileAvatar id={user.id} name={user.name} />
        <h2 className="school-home__greeting">{greeting(user.name)}</h2>
        {onSwitchProfile && (
          <button type="button" className="school-home__switch" onClick={onSwitchProfile}>
            Not you?
          </button>
        )}
      </header>

      {status === 'loading' && <p className="school-home__status">Loading…</p>}

      {primary && (
        <section className="school-home__primary">
          <PrimaryCard report={primary} onOpen={onOpen} />
        </section>
      )}

      {secondary.length > 0 && (
        <section className="school-home__secondary">
          <h3 className="school-home__heading">Also waiting</h3>
          <div className="school-home__secondary-cards">
            {secondary.map((r) => (
              <SecondaryCard key={`${r.program}:${r.instanceId}`} report={r} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}

      {allDone && (
        // Finishing releases the shelves rather than unlocking a new demand.
        // The reward for completing the day's work is visible freedom, which
        // is the one extrinsic structure that does not corrode the intrinsic
        // one — it gates nothing, it just opens.
        <section className="school-home__done">
          <p className="school-home__done-mark">Done for today</p>
          <p className="school-home__done-sub">Anything below is yours.</p>
        </section>
      )}

      <section className="school-home__explore">
        <h3 className="school-home__heading">{allDone ? 'Explore' : 'Or explore'}</h3>
        <SectionGrid sections={sections} onOpen={onOpen} compact={!allDone} />
      </section>
    </div>
  );
}
