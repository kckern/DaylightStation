import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import CoverFlow from './CoverFlow.jsx';
import { shuffleOrder } from '../../../../../lib/Player/playlist.js';

// Open Cover Flow a few covers in so albums flow off BOTH sides on arrival
// (rather than starting flush-left). Clamped to the collection size.
const FLOW_START = 5;

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

const VIEW_KEY = 'piano.music.view'; // 'flow' | 'grid'
const readView = () => {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'flow'; } catch { return 'flow'; }
};

/**
 * Album browser for the Music mode: the configured collection's albums plus the
 * configured playlists (shown as album tiles). Two interchangeable views — the
 * 3D Cover Flow (default) and a flat poster grid — toggled from the top bar and
 * remembered in localStorage. Tap a cover/tile to open its tracks.
 */
export default function AlbumGrid({ music, onSelect }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-music-grid' }), []);
  const [view, setView] = useState(readView);

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
  const rawItems = noConfig ? [] : [...(albums || []), ...pls];
  const error = noConfig ? null : (albumError || null);

  // The library loads SHUFFLED — a fresh random album order each visit. Stable
  // within a visit (keyed on the resolved id set) so the Cover Flow / grid don't
  // reshuffle on unrelated re-renders. Track play order is shuffled separately.
  const itemsSig = rawItems.map((it) => it.id).join(',');
  const items = useMemo(
    () => shuffleOrder(rawItems.length).map((i) => rawItems[i]),
    [itemsSig], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pickView = (next) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* private mode */ }
    logger.info('piano.music-view', { view: next });
  };

  return (
    <section className={`piano-mode piano-mode--music piano-music-flow piano-music-flow--${view}`}>
      {loading && <PianoEmpty loading />}
      {!loading && items.length === 0 && <PianoEmpty message={error || (noConfig ? 'No music has been set up yet.' : 'No music found.')} />}
      {!loading && items.length > 0 && (
        <>
          <div className="piano-music-viewtoggle" role="group" aria-label="Music view">
            <button
              type="button"
              className={`piano-music-viewtoggle__btn${view === 'flow' ? ' is-on' : ''}`}
              onClick={() => pickView('flow')}
              aria-pressed={view === 'flow'}
            >
              Cover Flow
            </button>
            <button
              type="button"
              className={`piano-music-viewtoggle__btn${view === 'grid' ? ' is-on' : ''}`}
              onClick={() => pickView('grid')}
              aria-pressed={view === 'grid'}
            >
              Grid
            </button>
          </div>

          {view === 'flow' ? (
            <CoverFlow items={items} onOpen={onSelect} startIndex={Math.min(FLOW_START, items.length - 1)} />
          ) : (
            <div className="piano-music-gridwrap">
              <ul className="piano-video-grid piano-music-grid">
                {items.map((item) => {
                  const src = item.thumbnail || item.image;
                  return (
                    <li key={item.id}>
                      <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
                        {src && <img src={src} alt={item.title} loading="eager" decoding="async" />}
                        {item.isPlaylist && <span className="piano-music-grid__badge">♫</span>}
                        <span className="piano-video-grid__title">{item.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
