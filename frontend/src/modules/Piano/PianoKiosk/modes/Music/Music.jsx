import { useMemo } from 'react';
import { Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import usePianoList from '../../usePianoList.js';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import MusicPlayer from './MusicPlayer.jsx';
import { toMusicTracks } from './musicTracks.js';
import { SkeletonList } from '../../Skeleton.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Music mode — a Plexamp-style jukebox over a configured Plex album collection
 * plus playlists (treated as albums).
 *
 * Routed so the album/playlist id and the starting track live in the URL
 * (deep-linkable, survives reload, physical/browser Back becomes an "up"
 * gesture):
 *   index            → album grid
 *   :albumId         → album detail (track list)
 *   :albumId/play?track=N → now-playing
 *
 * All navigation is RELATIVE (navigate('subpath') / navigate('..')) so the mode
 * works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 * Config from `music.collection` + `music.playlists`.
 */
export function Music() {
  const { config } = usePianoKioskConfig();
  const music = config.music || {};
  return (
    <Routes>
      <Route index element={<AlbumGridRoute music={music} />} />
      <Route path=":albumId" element={<AlbumDetailRoute />} />
      <Route path=":albumId/play" element={<MusicPlayerRoute />} />
    </Routes>
  );
}

/** Album grid → push the selected album/playlist id (relative). */
function AlbumGridRoute({ music }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-music' }), []);
  const navigate = useNavigate();
  return (
    <AlbumGrid
      music={music}
      onSelect={(item) => { logger.info('piano.album-open', { id: item.id }); navigate(idOf(item.id)); }}
    />
  );
}

/** Album detail → push `play?track=N` (relative); Back goes up a level. */
function AlbumDetailRoute() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-music' }), []);
  const { albumId } = useParams();
  const navigate = useNavigate();
  const album = useMemo(() => ({ id: albumId }), [albumId]);
  return (
    <AlbumDetail
      album={album}
      onPlay={(tracks, startIndex, shuffle = false) => {
        logger.info('piano.music-play', { album: albumId, startIndex, shuffle });
        navigate(`play?track=${startIndex}${shuffle ? '&shuffle=1' : ''}`);
      }}
    />
  );
}

/**
 * Now-playing route. Re-resolves the album's tracks from the cached queue
 * endpoint so a cold deep-link works (the track array isn't in memory after a
 * reload). `?track=N` is the starting position. `toMusicTracks` is the cache
 * mapper, so the cache stores already-mapped tracks (same shape AlbumDetail
 * fetches today).
 */
function MusicPlayerRoute() {
  const { albumId } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { data: tracks } = usePianoList(
    `api/v1/queue/plex:${idOf(albumId)}`,
    (r) => toMusicTracks(r),
  );
  const startIndex = Math.max(0, parseInt(sp.get('track') || '0', 10) || 0);
  const shuffle = sp.get('shuffle') === '1';

  if (tracks === null) return <section className="piano-mode piano-mode--music"><SkeletonList rows={8} /></section>;
  if (!tracks.length) {
    return (
      <div className="piano-mode__placeholder">
        No tracks found.{' '}
        <button type="button" onClick={() => navigate('..', { relative: 'path' })}>Back</button>
      </div>
    );
  }
  return <MusicPlayer album={{ id: albumId }} tracks={tracks} startIndex={startIndex} shuffle={shuffle} onBack={() => navigate('..', { relative: 'path' })} />;
}

export default Music;
