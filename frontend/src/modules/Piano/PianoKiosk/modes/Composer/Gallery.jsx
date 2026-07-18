// Gallery.jsx — the "Songs" view: the kid's saved compositions. Secondary to the
// blank-staff editor (reached via the bottom bar's "☰ Songs"); a fresh song is
// started from the bar's "＋ New song", so this view is purely a picker. Empty /
// loading / grid states, tidily aligned.
import { useEffect, useState } from 'react';

export function Gallery({ list, onOpen, onNew }) {
  const [songs, setSongs] = useState(null);
  useEffect(() => { let live = true; list().then((s) => { if (live) setSongs(s); }); return () => { live = false; }; }, [list]);

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
