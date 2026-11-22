// A piece of school work as a pinned print: the work's own image when there is
// one, otherwise a title card on the same paper (subject glyph over the title,
// on a light tint of the child's hue). Falls back on a missing image or a load
// error. Reused by the end-of-window showcase.
import React, { useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { subjectGlyph } from './schoolWork.js';

let _l;
const logger = () => (_l ||= getLogger().child({ component: 'weekly-review-work-card' }));

function Print({ item, className }) {
  const [failed, setFailed] = useState(false);
  const showImage = !!item.imageUrl && !failed;
  return (
    <div className={['work-print', !showImage && 'work-print--card', className].filter(Boolean).join(' ')}>
      <span className="work-print-tape" aria-hidden="true" />
      {showImage ? (
        <img
          className="work-print-img"
          src={item.imageUrl}
          alt={item.title || ''}
          onError={() => {
            logger().warn('reel.school-image-error', { kind: item.kind, imageUrl: item.imageUrl });
            setFailed(true);
          }}
        />
      ) : (
        <div className="work-print-card">
          <span className="work-print-glyph" aria-hidden="true">{subjectGlyph(item.subject)}</span>
          <span className="work-print-title">{item.title}</span>
        </div>
      )}
    </div>
  );
}

export default function WorkImage({ item, className }) {
  if (!item) return null;
  // Keyed on the image so a new item gets a fresh try at loading.
  return <Print key={item.imageUrl || 'none'} item={item} className={className} />;
}
