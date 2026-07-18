// Gallery.jsx — the "Songs" view: the kid's saved compositions. Secondary to the
// blank-staff editor (reached via the bottom bar's "☰ Songs"); a fresh song is
// started from the bar's "＋ New song", so this view is purely a picker. Empty /
// loading / grid states, tidily aligned.
import { useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';

export function Gallery({ list, onOpen, onNew }) {
  const logger = useMemo(() => getLogger().child({ component: 'composer-gallery' }), []);
  const [songs, setSongs] = useState(null);
  useEffect(() => {
    let live = true;
    list()
      .then((s) => {
        if (!live) return;
        setSongs(s);
        logger.info('composer.gallery.loaded', { count: s.length });
      })
      .catch((err) => {
        if (!live) return;
        setSongs([]); // render the empty/CTA state rather than a permanent spinner
        logger.error('composer.gallery.load-failed', { error: err?.message });
      });
    return () => { live = false; };
  }, [list, logger]);

  return (
    <div className="composer-gallery">
      <h2 className="composer-gallery__title">Your songs</h2>
      {songs == null ? (
        <p className="composer-gallery__empty">Loading…</p>
      ) : songs.length === 0 ? (
        <button type="button" className="composer-gallery__cta" onClick={onNew}>
          <span className="composer-gallery__cta-mark">＋</span>
          <span>No songs yet — start a new one</span>
        </button>
      ) : (
        <ul className="composer-gallery__grid">
          {songs.map((s) => (
            <li key={s.id}>
              <button type="button" className="composer-gallery__tile" onClick={() => onOpen(s.id)}>
                {s.title || 'Untitled'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
