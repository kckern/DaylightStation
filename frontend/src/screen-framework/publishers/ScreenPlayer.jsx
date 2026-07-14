// frontend/src/screen-framework/publishers/ScreenPlayer.jsx
//
// ScreenPlayer — drop-in wrapper around the legacy Player used by
// ScreenActionHandler's overlay mounts. Behaves identically to Player, plus
// it binds the mounted player into the playerSessionRegistry so the
// screen-level SessionStatePublisher can broadcast live device-state (fleet
// view). The play/queue props double as the item-metadata hint until the
// player resolves real metadata.
import React, { useRef } from 'react';
import Player from '../../modules/Player/Player.jsx';
import { usePlayerSessionBinding } from './usePlayerSessionBinding.js';

export function ScreenPlayer(props) {
  const playerRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  usePlayerSessionBinding(
    () => playerRef.current,
    {
      getItemHint: () => {
        const p = propsRef.current || {};
        const hint = p.play ?? p.queue ?? null;
        return (hint && typeof hint === 'object' && !Array.isArray(hint)) ? hint : null;
      },
    },
  );

  return <Player {...props} ref={playerRef} />;
}

export default ScreenPlayer;
