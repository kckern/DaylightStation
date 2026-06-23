// CourseGrid.jsx
import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';

/** Grid of the configured collection's courses; tap one to open its lectures. */
export default function CourseGrid({ collection, onSelect }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-grid' }), []);
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!collection) { if (!cancelled) { setItems([]); setError('No videos.plexCollection configured.'); } return; }
        const ratingKey = String(collection).replace(/^plex:/, '');
        logger.info('piano.videos-load', { ratingKey });
        const list = await DaylightAPI(`api/v1/list/plex/${ratingKey}`);
        if (!cancelled) setItems(list?.items ?? []);
      } catch (err) {
        if (!cancelled) { setItems([]); setError(err.message); }
        logger.warn('piano.videos-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, collection]);

  return (
    <section className="piano-mode piano-mode--videos">
      <h2>Videos</h2>
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || 'No videos found.'}</p>}
      {items?.length > 0 && (
        <ul className="piano-video-grid">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)}>
                {(item.thumbnail || item.image) && <img src={item.thumbnail || item.image} alt="" loading="lazy" />}
                <span className="piano-video-grid__title">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
