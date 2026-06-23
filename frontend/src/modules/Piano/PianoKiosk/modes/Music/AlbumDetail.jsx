import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { toMusicTracks, formatTime } from './musicTracks.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import Icon from '../../icons/Icon.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Track list for one album/playlist. Tap a track (or Play All) to start the
 * jukebox at that point. Tracks come from the generic queue endpoint.
 */
export default function AlbumDetail({ album, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-music-detail' }), []);
  const [tracks, setTracks] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = idOf(album?.id);
        logger.info('piano.album-load', { id });
        const res = await DaylightAPI(`api/v1/queue/plex:${id}`);
        if (!cancelled) setTracks(toMusicTracks(res));
      } catch (err) {
        if (!cancelled) { setTracks([]); setError(err.message); }
        logger.warn('piano.album-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, album?.id]);

  const cover = album?.image || album?.thumbnail || tracks?.[0]?.image || null;
  const albumTitle = album?.title || tracks?.[0]?.album || 'Album';

  // Current location in the header breadcrumb (Music › this album).
  usePianoBreadcrumb(useMemo(() => [{ label: albumTitle }], [albumTitle]));

  return (
    <section className="piano-mode piano-mode--music piano-album-detail">
      <div className="piano-album-detail__head">
        <h2>{albumTitle}</h2>
      </div>
      <div className="piano-album-detail__body">
        {cover && <img className="piano-album-detail__cover" src={cover} alt={album?.title || ''} />}
        <div className="piano-album-detail__tracks">
          {tracks === null && <PianoEmpty loading />}
          {tracks?.length === 0 && <PianoEmpty message={error || 'No tracks found.'} />}
          {tracks?.length > 0 && (
            <>
              <button type="button" className="piano-album-detail__playall" onClick={() => onPlay(tracks, 0, true)}>
                <Icon name="shuffle" />{' '}Play All
              </button>
              <ol className="piano-track-list">
                {tracks.map((t, i) => (
                  <li key={t.contentId || i}>
                    <button type="button" className="piano-track-list__row" onClick={() => onPlay(tracks, i)}>
                      <span className="piano-track-list__num">{t.index}</span>
                      <span className="piano-track-list__title">{t.title}</span>
                      <span className="piano-track-list__dur">{t.duration ? formatTime(t.duration) : ''}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
