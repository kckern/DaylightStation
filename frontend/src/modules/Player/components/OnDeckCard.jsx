import React, { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import './OnDeckCard.scss';

const logger = getLogger().child({ component: 'OnDeckCard' });

export function OnDeckCard({ item, flashKey }) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!item) return undefined;
    const node = rootRef.current;
    const rect = node?.getBoundingClientRect?.();
    logger.info('mounted', {
      flashKey,
      contentId: item.contentId || item.id || null,
      title: item.title || null,
      hasThumbnail: !!item.thumbnail,
      rect: rect ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : null,
      viewport: {
        width: typeof window !== 'undefined' ? window.innerWidth : null,
        height: typeof window !== 'undefined' ? window.innerHeight : null,
      },
    });
    return () => {
      logger.debug('unmounted', { flashKey, contentId: item.contentId || item.id || null });
    };
  }, [item, flashKey]);

  if (!item) return null;
  return (
    <div ref={rootRef} className="on-deck-card" data-flash-key={flashKey}>
      <div className="on-deck-thumb">
        {item.thumbnail && <img src={item.thumbnail} alt={item.title || 'thumbnail'} />}
        <div className="on-deck-icon" aria-label="up next">▶▶</div>
      </div>
      <div className="on-deck-title-strip">
        {item.title || ''}
      </div>
    </div>
  );
}

export default OnDeckCard;
