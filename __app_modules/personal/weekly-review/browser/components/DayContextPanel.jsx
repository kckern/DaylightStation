// frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx
import React from 'react';
import DayDataPoints from "./DayDataPoints.jsx";
import { verbLabel, kidStyle } from "./schoolWork.js";

// Everything the children did for school that day (day.schoolAll, not just the
// curated reel picks), grouped by child.
function SchoolSection({ items, learnerColors }) {
  if (!items?.length) return null;
  const groups = [];
  const byLearner = new Map();
  for (const w of items) {
    let g = byLearner.get(w.learnerId);
    if (!g) {
      g = { learnerId: w.learnerId, learnerName: w.learnerName, items: [] };
      byLearner.set(w.learnerId, g);
      groups.push(g);
    }
    g.items.push(w);
  }
  return (
    <section className="context-section context-school">
      <h3 className="context-section-title">School</h3>
      <div className="context-school-groups">
        {groups.map(g => (
          <div key={g.learnerId} className="context-school-learner" style={kidStyle(learnerColors?.[g.learnerId])}>
            <div className="context-school-name">{g.learnerName}</div>
            {g.items.map((w, i) => (
              <div key={`${w.groupKey}:${i}`} className="context-school-line">
                {verbLabel(w)} {w.title}{w.subtitle ? ` — ${w.subtitle}` : ''}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DayContextPanel({ day, open, learnerColors }) {
  if (!open || !day) return null;
  return (
    <div className="weekly-review-context-panel" role="dialog" aria-modal="true" aria-label="Day details">
      <div className="context-panel-inner">
        <DayDataPoints day={day} />
        <SchoolSection items={day.schoolAll} learnerColors={learnerColors} />
      </div>
    </div>
  );
}
