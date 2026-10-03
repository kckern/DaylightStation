// frontend/src/modules/Media/session/MusicBehindHost.jsx
// Music behind a slideshow playing on THIS device (RQ-PLAY-12): the shared
// MusicBehindLayer, bound to the local player features so the same controls
// steer it as steer a screen's. It lives beside PlayerBridge and outlives the
// slideshow: stopping the photos asks whether to keep the music.
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LocalSessionContext } from './LocalSessionContext.js';
import { getLocalPlayerFeatures } from './localPlayerFeatures.js';
import { MusicBehindLayer } from '../../Player/components/MusicBehindLayer.jsx';
import { isSlideshowItem } from '@shared-contracts/media/playerFeatures.mjs';
import mediaLog from '../logging/mediaLog.js';

export function MusicBehindHost() {
  const ctx = useContext(LocalSessionContext);
  const controller = ctx?.controller ?? null;
  const features = getLocalPlayerFeatures();
  const [music, setMusic] = useState(null); // { contentId, title, startedAt }
  const musicRef = useRef(null);
  const layerRef = useRef(null);
  musicRef.current = music;

  useEffect(() => features.bindMusic({
    command: (op, params = {}) => {
      if (op === 'start') {
        if (!isSlideshowItem(controller?.getSnapshot?.()?.currentItem)) {
          return { ok: false, code: 'NOT_A_SLIDESHOW', error: 'Music behind needs a photo slideshow playing' };
        }
        setMusic({ contentId: params.contentId, title: params.title ?? null, startedAt: Date.now() });
        features.setMusicState({ contentId: params.contentId, title: params.title ?? null, state: 'loading' });
        return { ok: true };
      }
      if (!musicRef.current) return { ok: false, code: 'NO_MUSIC', error: 'No music is playing behind' };
      if (op === 'stop') { setMusic(null); features.setMusicState(null); return { ok: true }; }
      if (!layerRef.current) return { ok: false, code: 'MUSIC_LOADING', error: 'The music is still starting' };
      layerRef.current[op]?.();
      return { ok: true };
    },
  }), [features, controller]);

  useEffect(() => {
    if (!music) return undefined;
    mediaLog.playerFeatureState({ feature: 'music-behind', target: 'local', state: 'started', contentId: music.contentId });
    return () => mediaLog.playerFeatureState({ feature: 'music-behind', target: 'local', state: 'stopped', contentId: music.contentId });
  }, [music]);

  const onState = useCallback((state) => features.setMusicState(state), [features]);
  const onEnded = useCallback(() => { setMusic(null); features.setMusicState(null); }, [features]);

  if (!music) return null;
  return (
    <MusicBehindLayer
      ref={layerRef}
      key={`${music.contentId}:${music.startedAt}`}
      contentId={music.contentId}
      title={music.title}
      onState={onState}
      onEnded={onEnded}
    />
  );
}

export default MusicBehindHost;
