// frontend/src/modules/Piano/PianoKiosk/modes/Composer/Gallery.jsx
import { useEffect, useState } from 'react';

export function Gallery({ list, onOpen, onNew }) {
  const [songs, setSongs] = useState(null);
  useEffect(() => { let live = true; list().then((s) => { if (live) setSongs(s); }); return () => { live = false; }; }, [list]);

  return (
    <div className="composer-gallery">
      <div className="composer-gallery__head">
        <button onClick={onNew}>New Song</button>
      </div>
      {songs == null ? (
        <p className="composer-gallery__loading">Loading…</p>
      ) : songs.length === 0 ? (
        <p className="composer-gallery__empty">No songs yet — tap New Song to start writing.</p>
      ) : (
        <ul className="composer-gallery__grid">
          {songs.map((s) => (
            <li key={s.id}>
              <button className="composer-gallery__tile" onClick={() => onOpen(s.id)}>{s.title}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
