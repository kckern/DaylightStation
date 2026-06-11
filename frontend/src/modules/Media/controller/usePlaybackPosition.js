// frontend/src/modules/Media/controller/usePlaybackPosition.js
// Bind the hot position tier. Only components that render live progress
// (seek bars, timecodes) use this — everything else binds the snapshot and
// never re-renders at tick rate.
import { useCallback, useSyncExternalStore } from 'react';

const ZERO = { seconds: 0, ts: 0 };
const NOOP_UNSUB = () => {};

export function usePlaybackPosition(controller) {
  const subscribe = useCallback(
    (cb) => (controller?.position ? controller.position.subscribe(cb) : NOOP_UNSUB),
    [controller]
  );
  const get = useCallback(
    () => (controller?.position ? controller.position.get() : ZERO),
    [controller]
  );
  return useSyncExternalStore(subscribe, get, get);
}

export default usePlaybackPosition;
