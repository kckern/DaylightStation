import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Album grid for the Music mode: the configured collection's albums plus the
 * configured playlists (shown as album tiles). Tap a tile to open its tracks.
 */
export default function AlbumGrid({ music, onSelect }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-music-grid' }), []);

  const collection = music?.collection;
  const playlists = Array.isArray(music?.playlists) ? music.playlists : [];

  // Albums from the collection — cached via usePianoList.
  const { data: albums, error: albumError } = usePianoList(
    collection ? `api/v1/list/plex/${idOf(collection)}` : null
  );

  // Playlists: each resolves to a single tile (not cached — playlist lists are short).
  const [pls, setPls] = useState([]);
  const playlistKey = playlists.join(',');
  useEffect(() => {
    if (playlists.length === 0) { setPls([]); return undefined; }
    let cancelled = false;
    Promise.all(
      playlists.map((pl) =>
        DaylightAPI(`api/v1/list/plex/${idOf(pl)}`)
          .then((r) => (r?.items?.[0] ? { ...r.items[0], isPlaylist: true } : null))
          .catch(() => null)
      )
    ).then((results) => {
      if (!cancelled) setPls(results.filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [playlistKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine combined state.
  const noConfig = !collection && playlists.length === 0;
  // Loading while albums is null (only when collection is set).
  const loading = !noConfig && albums === null && collection;
  const items = noConfig ? [] : [...(albums || []), ...pls];
  const error = noConfig ? null : (albumError || null);

  if (!noConfig && !loading) {
    // Log once when the combined list first resolves (info level only on initial load).
    // (usePianoList covers fetch failures internally.)
  }

  return (
    <section className="piano-mode piano-mode--music">
      {loading && <PianoEmpty loading />}
      {!loading && items.length === 0 && <PianoEmpty message={error || (noConfig ? 'No music has been set up yet.' : 'No music found.')} />}
      {!loading && items.length > 0 && (
        <ul className="piano-video-grid piano-music-grid">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
                {(item.thumbnail || item.image) && <img src={item.thumbnail || item.image} alt={item.title} loading="eager" decoding="async" />}
                {item.isPlaylist && <span className="piano-music-grid__badge">♫</span>}
                <span className="piano-video-grid__title">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
