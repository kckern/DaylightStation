import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Grid of scores from the configured Plex sheet-music collection. Tap a score
 * to open the viewer.
 */
export default function ScoreGrid({ collection, onSelect }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic-grid' }), []);
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!collection) { if (!cancelled) { setItems([]); setError('No sheetmusic.collection configured.'); } return; }
        logger.info('piano.sheetmusic-load', { collection: idOf(collection) });
        const list = await DaylightAPI(`api/v1/list/plex/${idOf(collection)}`);
        if (!cancelled) setItems(list?.items ?? []);
      } catch (err) {
        if (!cancelled) { setItems([]); setError(err.message); }
        logger.warn('piano.sheetmusic-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, collection]);

  return (
    <section className="piano-mode piano-mode--sheetmusic">
      <h2>Sheet Music</h2>
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || 'No scores found.'}</p>}
      {items?.length > 0 && (
        <ul className="piano-video-grid piano-video-grid--posters">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
                {(item.thumbnail || item.image) && <img src={item.thumbnail || item.image} alt={item.title} loading="lazy" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
