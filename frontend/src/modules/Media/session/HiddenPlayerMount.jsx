import React, { useContext, useEffect, useState, useCallback } from 'react';
import Player from '../../Player/Player.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';

function adaptForPlayer(currentItem) {
  if (!currentItem) return null;
  // Player expects a `play` object that it treats as PlayableItem-ish.
  // contentId + format + optional fields pass through; additional format-specific
  // fields on PlayableItem land here too.
  return { ...currentItem };
}

export function HiddenPlayerMount() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('HiddenPlayerMount must be inside LocalSessionProvider');
  const { adapter } = ctx;
  const [snapshot, setSnapshot] = useState(adapter.getSnapshot());

  useEffect(() => {
    setSnapshot(adapter.getSnapshot());
    return adapter.subscribe(setSnapshot);
  }, [adapter]);

  const onClear = useCallback(() => adapter.onPlayerEnded(), [adapter]);

  const playProp = adaptForPlayer(snapshot.currentItem);
  if (!playProp) return null;

  return (
    <div className="media-player-host">
      <Player play={playProp} clear={onClear} />
    </div>
  );
}

export default HiddenPlayerMount;
