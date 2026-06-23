import { useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import AlbumGrid from './AlbumGrid.jsx';
import AlbumDetail from './AlbumDetail.jsx';
import MusicPlayer from './MusicPlayer.jsx';

/**
 * Music mode — a Plexamp-style jukebox over a configured Plex album collection
 * plus playlists (treated as albums). Three views: album grid → album detail
 * (track list) → now-playing. Config from `music.collection` + `music.playlists`.
 */
export function Music() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-music' }), []);
  const { config } = usePianoKioskConfig();
  const music = config.music || {};
  const [album, setAlbum] = useState(null);
  const [session, setSession] = useState(null); // { album, tracks, startIndex }

  if (session) {
    return (
      <MusicPlayer
        album={session.album}
        tracks={session.tracks}
        startIndex={session.startIndex}
        onBack={() => { logger.info('piano.music-close', {}); setSession(null); }}
      />
    );
  }
  if (album) {
    return (
      <AlbumDetail
        album={album}
        onPlay={(tracks, startIndex) => { logger.info('piano.music-play', { album: album.id, startIndex }); setSession({ album, tracks, startIndex }); }}
        onBack={() => setAlbum(null)}
      />
    );
  }
  return <AlbumGrid music={music} onSelect={(item) => { logger.info('piano.album-open', { id: item.id }); setAlbum(item); }} />;
}

export default Music;
