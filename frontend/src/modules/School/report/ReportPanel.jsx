import { useEffect, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import MetricTile from './MetricTile.jsx';

/**
 * The aggregate board: every program × every learner, in one shape.
 *
 * Renders entirely from the closed report contract, so it has no knowledge of
 * quizzes, courses or sentence ladders and gains no branch when a program is
 * added. Both scopes live on one screen because that is how the Portal is
 * actually used — a parent glances at everyone, a child taps their own face.
 *
 * `next` is the field this view exists for, so it is the loudest thing on each
 * card. A blocked step always names its remedy; the contract guarantees the
 * string is there.
 */

const STATE_LABEL = {
  blocked: 'Blocked',
  active: 'In progress',
  idle: 'Paused',
  'not-started': 'Not started',
  complete: 'Complete',
};

function relativeDay(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

function ProgramCard({ report }) {
  return (
    <article className={`school-report__card is-${report.state}`}>
      <header className="school-report__card-head">
        <h4 className="school-report__program">{report.label}</h4>
        <span className={`school-report__state is-${report.state}`}>
          {STATE_LABEL[report.state] ?? report.state}
        </span>
      </header>

      {report.headline && <p className="school-report__headline">{report.headline}</p>}

      {report.next && (
        <p className={`school-report__next${report.next.blocked ? ' is-blocked' : ''}`}>
          <span className="school-report__next-label">
            {report.next.blocked ? report.next.blockedReason : report.next.label}
          </span>
          {!report.next.blocked && report.next.detail && (
            <span className="school-report__next-detail">{report.next.detail}</span>
          )}
        </p>
      )}

      {report.metrics.length > 0 && (
        <div className="school-report__metrics">
          {report.metrics.map((m) => <MetricTile key={m.id} metric={m} />)}
        </div>
      )}

      {report.lastActivity && (
        <p className="school-report__seen">Last studied {relativeDay(report.lastActivity)}</p>
      )}
    </article>
  );
}

export default function ReportPanel({ userId = null }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [focus, setFocus] = useState(userId);

  useEffect(() => { setFocus(userId); }, [userId]);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    schoolApi.report(focus).then(({ ok, data: body }) => {
      if (!alive) return;
      if (!ok || !body) {
        schoolLog.materialsError('report-failed', { userId: focus });
        setStatus('error');
        return;
      }
      setData(body);
      setStatus(body.learners.length ? 'ready' : 'empty');
    });
    return () => { alive = false; };
  }, [focus]);

  if (status === 'loading') return <p className="school-report__status">Loading…</p>;
  if (status === 'error') return <p className="school-report__status">Could not load progress.</p>;
  if (status === 'empty') return <p className="school-report__status">Nobody has started anything yet.</p>;

  return (
    <div className="school-report">
      {focus && (
        <button type="button" className="school-report__all" onClick={() => setFocus(null)}>
          ‹ Everyone
        </button>
      )}

      {data.learners.map((learner) => (
        <section key={learner.id} className="school-report__learner">
          <header className="school-report__learner-head">
            {/* Drilling in is the same endpoint filtered, not a second view. */}
            <button
              type="button"
              className="school-report__learner-name"
              onClick={() => setFocus(focus ? null : learner.id)}
            >
              {learner.name}
            </button>
            {learner.needsAttention && (
              <span className="school-report__flag">Needs attention</span>
            )}
          </header>
          <div className="school-report__cards">
            {learner.reports.map((r) => <ProgramCard key={`${r.program}:${r.label}`} report={r} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
