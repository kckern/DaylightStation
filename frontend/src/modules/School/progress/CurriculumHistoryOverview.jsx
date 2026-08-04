import { useMemo, useState } from 'react';
import OverviewDetail from './OverviewDetail.jsx';

const KIND_LABEL = {
  catalog: 'Catalog', subject: 'Subject', course: 'Course', unit: 'Unit', lesson: 'Lesson', module: 'Module',
};

export function flattenCurriculumHistory(roots = []) {
  const items = [];
  const visit = (node, ancestors = []) => {
    const label = displayId(node.id);
    const trail = [...ancestors, label];
    items.push({ ...node, label, trail, depth: ancestors.length });
    (node.children ?? []).forEach((child) => visit(child, trail));
  };
  roots.forEach((root) => visit(root));
  return items;
}

/** Cross-surface progress/history view using the shared overview grammar. */
export default function CurriculumHistoryOverview({ history }) {
  const [listView, setListView] = useState(false);
  const items = useMemo(() => flattenCurriculumHistory(history?.roots), [history]);
  if (items.length === 0) return null;

  return (
    <section className="school-progress-history" aria-labelledby="school-progress-history-title">
      <header className="school-progress-history__head">
        <div>
          <h3 id="school-progress-history-title">Learning history</h3>
          <p>Move through the overview to inspect recorded work.</p>
        </div>
        <button type="button" onClick={() => setListView((value) => !value)}>
          {listView ? 'Compact map' : 'List view'}
        </button>
      </header>
      <OverviewDetail
        items={items}
        ariaLabel="Curriculum progress history"
        columns={listView ? 1 : 4}
        className={listView ? 'is-list' : 'is-map'}
        renderItem={(item) => (
          <>
            <span className="school-progress-history__marker" aria-hidden="true" />
            <span className="school-progress-history__node-kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
            <strong>{item.label}</strong>
            <span className="school-progress-history__node-stat">
              {item.summary.scorePercent === null ? `${item.summary.activityCount} activities` : `${item.summary.scorePercent}%`}
            </span>
          </>
        )}
        renderInspector={(item) => (
          <>
            <div className="school-progress-history__trail">{item.trail.join(' › ')}</div>
            <div className="school-progress-history__inspect-main">
              <div>
                <span>{KIND_LABEL[item.kind] ?? item.kind}</span>
                <strong>{item.label}</strong>
              </div>
              <dl>
                <div><dt>Activities</dt><dd>{item.summary.activityCount}</dd></div>
                <div><dt>Completed</dt><dd>{item.summary.completionCount}</dd></div>
                <div><dt>Accuracy</dt><dd>{item.summary.scorePercent === null ? '—' : `${item.summary.scorePercent}%`}</dd></div>
                <div><dt>Last work</dt><dd>{dateLabel(item.summary.lastActivityAt)}</dd></div>
              </dl>
            </div>
          </>
        )}
      />
      {(history?.unscoped?.evidenceCount ?? 0) > 0 && (
        <p className="school-progress-history__unscoped">
          {history.unscoped.evidenceCount} {history.unscoped.evidenceCount === 1 ? 'record' : 'records'} not assigned to a curriculum path
        </p>
      )}
    </section>
  );
}

function displayId(value) {
  return String(value ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

