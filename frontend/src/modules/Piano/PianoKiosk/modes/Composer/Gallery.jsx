// Gallery.jsx — the "Songs" view: the kid's saved compositions. Secondary to the
// blank-staff editor (reached from the editor toolbar's "Songs"). Empty /
// loading / grid states, tidily aligned.
//
// This view OWNS the new-song path. The mode's bottom bar used to carry "New
// song" alongside the gallery, and the empty-state CTA below was only ever the
// no-songs-yet case — so when that bar was deleted, a kid with even one saved
// song had no way back to a blank staff. Hence the header action, which is
// present in EVERY state.
import { useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { IconPlus } from './icons.jsx';

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
      <div className="composer-gallery__head">
        <h2 className="composer-gallery__title">Your songs</h2>
        {/* Drawn plus + the words. A Unicode "+" variant renders as tofu on the
            kiosk, so the mark comes from icons.jsx like every other glyph. */}
        <button
          type="button"
          className="composer-gallery__new"
          onClick={() => { logger.debug('composer.nav.new', {}); onNew(); }}
          aria-label="New song"
        >
          <IconPlus size={18} />
          <span>New song</span>
        </button>
      </div>
      {songs == null ? (
        <p className="composer-gallery__empty">Loading…</p>
      ) : songs.length === 0 ? (
        <button type="button" className="composer-gallery__cta" onClick={onNew}>
          <IconPlus size={26} />
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
