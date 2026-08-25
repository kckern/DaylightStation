import { useMemo } from 'react';
import OverviewDetail from './OverviewDetail.jsx';

const SIGNAL_LABELS = {
  review_instruction: 'Review instruction',
  limited_evidence: 'More evidence needed',
  monitor: 'On track',
  review_pacing: 'Review pacing',
  upcoming: 'Upcoming',
  met: 'Met',
};

// Severity order for the grouped view: what needs a teacher first.
const SIGNAL_ORDER = ['review_instruction', 'review_pacing', 'limited_evidence', 'upcoming', 'monitor', 'met'];

/** Adult-facing, subject-neutral overview of content and pacing signals. */
export default function InstructionalInsightsOverview({ insights }) {
  const items = useMemo(() => [
    ...(insights?.concepts ?? []).map((row) => ({
      ...row, key: `concept:${row.target.id}`, kind: 'concept', id: row.target.id,
    })),
    ...(insights?.items ?? []).map((row) => ({
      ...row, key: `item:${row.target.id}`, kind: 'item', id: row.target.id,
    })),
    ...(insights?.pacing ?? []).map((row) => ({
      ...row, key: `pacing:${row.expectationId}`, kind: 'pacing', id: row.target.id,
      signal: row.status,
    })),
  ], [insights]);

  // One collapsible group per signal, severity-first, so 30 "more evidence
  // needed" cards read as one line instead of a wall (UX audit C12). Only the
  // most severe non-empty group opens by default.
  const groups = useMemo(() => {
    const known = new Set(SIGNAL_ORDER);
    const order = [...SIGNAL_ORDER, ...new Set(items.map((item) => item.signal).filter((signal) => !known.has(signal)))];
    return order
      .map((signal) => ({ signal, items: items.filter((item) => item.signal === signal) }))
      .filter((group) => group.items.length > 0);
  }, [items]);

  if (items.length === 0) return null;
  return (
    <section className="school-insights" aria-labelledby="school-insights-title">
      <header className="school-insights__head">
        <h3 id="school-insights-title">Instructional view</h3>
        <p>Content signals for planning—not learner rankings or ability labels.</p>
      </header>
      {groups.map((group, index) => (
        <details key={group.signal} className="school-insights__group" open={index === 0}>
          <summary>{SIGNAL_LABELS[group.signal] ?? displayId(group.signal)} ({group.items.length})</summary>
          <InsightsGrid items={group.items} />
        </details>
      ))}
    </section>
  );
}

function InsightsGrid({ items }) {
  return (
    <OverviewDetail
        items={items}
        ariaLabel="Instructional content and pacing signals"
        columns={4}
        renderItem={(item) => (
          <>
            <span className={`school-insights__marker is-${item.signal}`} aria-hidden="true" />
            <span className="school-insights__kind">{item.kind}</span>
            <strong>{displayId(item.id)}</strong>
            <span className="school-insights__signal">{SIGNAL_LABELS[item.signal] ?? displayId(item.signal)}</span>
          </>
        )}
        renderInspector={(item) => (
          <div className="school-insights__inspector">
            <div>
              <span>{item.kind === 'pacing' ? `${item.target.kind} pacing` : item.kind}</span>
              <strong>{displayId(item.id)}</strong>
              <small>{SIGNAL_LABELS[item.signal] ?? displayId(item.signal)}</small>
            </div>
            {item.kind === 'pacing' ? (
              <dl>
                <div><dt>Completed</dt><dd>{item.completedPercent}%</dd></div>
                <div><dt>Expected</dt><dd>{item.expectedCompletedPercent}%</dd></div>
                <div><dt>Learners</dt><dd>{item.completedLearnerCount}/{item.learnerCount}</dd></div>
                <div><dt>Due</dt><dd>{dateLabel(item.dueAt)}</dd></div>
              </dl>
            ) : (
              <dl>
                <div><dt>Accuracy</dt><dd>{item.accuracyPercent}%</dd></div>
                <div><dt>Responses</dt><dd>{item.responseCount}</dd></div>
                <div><dt>Affected</dt><dd>{item.affectedLearnerCount}</dd></div>
                <div><dt>Last seen</dt><dd>{dateLabel(item.lastActivityAt)}</dd></div>
              </dl>
            )}
            <RecommendationBasis recommendation={item.suggestedAction?.recommendation} />
          </div>
        )}
    />
  );
}

function RecommendationBasis({ recommendation }) {
  if (!recommendation) return null;
  const { basis, policy } = recommendation;
  return (
    <aside className="school-insights__basis" aria-label="Why this recommendation">
      <strong>Why this is suggested</strong>
      <span>{basisLabel(basis)}</span>
      <small>
        Suggested automatically from answer history · reassess when evidence changes{policy?.expiresAt ? ` · expires ${dateLabel(policy.expiresAt)}` : ''}
      </small>
    </aside>
  );
}

const counted = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function basisLabel(basis) {
  if (basis?.kind === 'evidence_aggregate') {
    return `${basis.correctCount}/${basis.responseCount} correct across ${counted(basis.evidenceCount, 'record')} and ${counted(basis.learnerCount, 'learner')}.`;
  }
  if (basis?.kind === 'authored_expectation') {
    return `${basis.completedLearnerCount}/${basis.learnerCount} learners completed an authored ${basis.expectedCompletedPercent}% expectation due ${dateLabel(basis.dueAt)}.`;
  }
  return 'No recommendation basis supplied.';
}

function displayId(value) {
  const raw = String(value ?? '');
  // A bare bank item id like "q2" is not a name — say what it is.
  const question = /^q(\d+)$/i.exec(raw);
  if (question) return `Question ${question[1]}`;
  return raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}
