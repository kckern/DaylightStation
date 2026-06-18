// frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx
import React from 'react';
import DayDataPoints from './DayDataPoints.jsx';

export default function DayContextPanel({ day, open }) {
  if (!open || !day) return null;
  return (
    <div className="weekly-review-context-panel" role="dialog" aria-modal="true" aria-label="Day details">
      <div className="context-panel-inner">
        <DayDataPoints day={day} />
      </div>
    </div>
  );
}
