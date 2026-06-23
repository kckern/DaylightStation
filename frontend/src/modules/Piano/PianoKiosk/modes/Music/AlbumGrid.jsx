import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Album grid for the Music mode: the configured collection's albums plus the
 * configured playlists (shown as album tiles). Tap a tile to open its tracks.
 */
export default function AlbumGrid({ music, onSelect }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-music-grid' }), []);
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const collection = music?.collection;
  const playlists = Array.isArray(music?.playlists) ? music.playlists : [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!collection && playlists.length === 0) {
          if (!cancelled) { setItems([]); setError('No music.collection configured.'); }
          return;
        }
        logger.info('piano.music-load', { collection: idOf(collection), playlists: playlists.length });
        // Albums from the collection, plus each playlist resolved to a tile.
        const albumReq = collection
          ? DaylightAPI(`api/v1/list/plex/${idOf(collection)}`).then((r) => r?.items ?? [])
          : Promise.resolve([]);
        const playlistReqs = playlists.map((pl) =>
          DaylightAPI(`api/v1/list/plex/${idOf(pl)}`)
            .then((r) => (r?.items?.[0] ? { ...r.items[0], isPlaylist: true } : null))
            .catch(() => null)
        );
        const [albums, ...pls] = await Promise.all([albumReq, ...playlistReqs]);
        if (!cancelled) setItems([...albums, ...pls.filter(Boolean)]);
      } catch (err) {
        if (!cancelled) { setItems([]); setError(err.message); }
        logger.warn('piano.music-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, collection, playlists.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="piano-mode piano-mode--music">
      <h2>Music</h2>
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || 'No music found.'}</p>}
      {items?.length > 0 && (
        <ul className="piano-video-grid piano-music-grid">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
                {(item.thumbnail || item.image) && <img src={item.thumbnail || item.image} alt={item.title} loading="lazy" />}
                {item.isPlaylist && <span className="piano-music-grid__badge">♫</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
