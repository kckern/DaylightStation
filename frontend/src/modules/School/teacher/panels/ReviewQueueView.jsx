/**
 * ReviewQueueView — the pending marks awaiting a grown-up, grouped by
 * learner (read-only; resolution controls are the teacher.review.resolve
 * stub until wave 2 — the Admin queue stays the place to resolve).
 */
export default function ReviewQueueView({ items, kids }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id ?? 'Unknown';
  const byLearner = new Map();
  for (const item of items) {
    const key = item.learnerId ?? 'unknown';
    if (!byLearner.has(key)) byLearner.set(key, []);
    byLearner.get(key).push(item);
  }
  return (
    <div className="teacher-review">
      {[...byLearner.entries()].map(([learnerId, list]) => (
        <div key={learnerId} className="teacher-review__group">
          <h3 className="teacher-review__learner">{nameFor(learnerId)}</h3>
          <ul>
            {list.map((item) => (
              <li key={`${item.sessionId}:${item.itemId}`} className="teacher-review__item">
                {item.questionNumber != null && <span className="teacher-review__qnum">Q{item.questionNumber}</span>}
                <span className="teacher-review__prompt">{item.prompt ?? item.itemId}</span>
                {item.given != null && <blockquote className="teacher-review__given">{String(item.given)}</blockquote>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <a className="teacher-review__admin-link" href="/admin/school/review">Resolve in Admin →</a>
    </div>
  );
}
