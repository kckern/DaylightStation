// frontend/src/modules/Media/controller/usePlaybackPosition.js
// Only display consumers bind the hot position tier. Playback and commands
// continue to read the controller even when these displays stop updating.
import { useMemo, useSyncExternalStore } from 'react';
import { whileDocumentVisible } from '@/lib/hooks/useVisibleRefresh.js';

const ZERO = { seconds: 0, ts: 0 };
const NOOP_UNSUB = () => {};

export function usePlaybackPosition(controller) {
  const display = useMemo(() => {
    const position = controller?.position;
    let snapshot = position?.get() ?? ZERO;
    const get = () => snapshot;
    const subscribe = notify => {
      if (!position) return NOOP_UNSUB;
      return whileDocumentVisible(() => {
        const update = () => {
          const current = position.get();
          if (snapshot === current) return;
          snapshot = current;
          notify();
        };
        update();
        return position.subscribe(update);
      });
    };
    return { get, subscribe };
  }, [controller]);
  return useSyncExternalStore(display.subscribe, display.get, display.get);
}

export default usePlaybackPosition;
