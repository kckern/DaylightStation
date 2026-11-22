// One piece of a child's school work in the day reel: the work pinned up on
// the left like a print on the fridge door, who did what on the right.
import React, { useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import WorkImage from './WorkImage.jsx';
import { verbLabel, workDay, kidStyle } from './schoolWork.js';

let _l;
const logger = () => (_l ||= getLogger().child({ component: 'weekly-review-work-card' }));

export default function WorkCard({ item, index, total, color }) {
  useEffect(() => {
    if (item) logger().debug('reel.school-card', { kind: item.kind, learnerId: item.learnerId });
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  const when = workDay(item.studyDay);
  return (
    <div className="weekly-review-work-card" style={kidStyle(color)}>
      <div className="work-card-stage">
        <WorkImage item={item} className="work-card-print" />
      </div>
      <div className="work-card-text">
        <div className="work-card-name">{item.learnerName}</div>
        <div className="work-card-verb">{verbLabel(item)}</div>
        <div className="work-card-title">{item.title}</div>
        {item.subtitle && <div className="work-card-subtitle">{item.subtitle}</div>}
        {when && <div className="work-card-when">{when}</div>}
      </div>
      {total > 0 && <div className="work-card-index fullscreen-image-index">{index + 1} / {total}</div>}
    </div>
  );
}
