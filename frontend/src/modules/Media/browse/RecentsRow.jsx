import React, { useEffect, useState } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { readRecents } from '../session/recents.js';

export function RecentsRow() {
  const { queue } = useSessionController('local');
  const [items, setItems] = useState(() => readRecents());

  useEffect(() => {
    function refresh() { setItems(readRecents()); }
    // Cross-tab: storage event fires for changes made in other tabs.
    function onStorage(e) {
      if (e.key === 'media-app.recents') refresh();
    }
    // Same-tab: custom event dispatched by recordRecent.
    window.addEventListener('storage', onStorage);
    window.addEventListener('media-recents-updated', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('media-recents-updated', refresh);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section data-testid="recents-row" className="recents-row">
      <h2 className="recents-row-title">Recently played</h2>
      <div className="recents-row-items">
        {items.map((it) => (
          <button
            key={it.contentId}
            data-testid={`recent-${it.contentId}`}
            className="recent-card"
            onClick={() => queue.playNow({ contentId: it.contentId, title: it.title, thumbnail: it.thumbnail, format: it.format }, { clearRest: true })}
            title={it.title ?? it.contentId}
          >
            {it.thumbnail && <img src={it.thumbnail} alt="" loading="lazy" className="recent-card-thumb" />}
            <span className="recent-card-title">{it.title ?? it.contentId}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default RecentsRow;
