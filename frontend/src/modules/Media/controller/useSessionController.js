// frontend/src/modules/Media/controller/useSessionController.js
// Bind a SessionController (local or remote) into React. One hook, either
// side — the symmetry seam in hook form. Both contexts are read
// unconditionally (rules of hooks); target selection just picks which
// resolved controller to bind.
import { useContext, useCallback, useSyncExternalStore } from 'react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { PeekContext } from '../peek/PeekContext.js';

const NOOP_UNSUB = () => {};
const noopGroup = {};

export function useSessionController(target) {
  const local = useContext(LocalSessionContext);
  const peek = useContext(PeekContext);

  let controller = null;
  if (target === 'local') {
    if (!local) throw new Error("useSessionController('local') must be inside LocalSessionProvider");
    controller = local.controller;
  } else if (target && typeof target === 'object' && typeof target.deviceId === 'string') {
    controller = peek?.getController?.(target.deviceId) ?? null;
  } else {
    throw new Error('useSessionController: target must be "local" or {deviceId}');
  }

  const subscribe = useCallback(
    (cb) => (controller ? controller.subscribe(cb) : NOOP_UNSUB),
    [controller]
  );
  const getSnapshot = useCallback(
    () => (controller ? controller.getSnapshot() : null),
    [controller]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    controller,
    snapshot,
    transport: controller?.transport ?? noopGroup,
    queue: controller?.queue ?? noopGroup,
    config: controller?.config ?? noopGroup,
    lifecycle: controller?.lifecycle ?? noopGroup,
    portability: controller?.portability ?? noopGroup,
    capabilities: controller?.capabilities ?? { seekable: false, acked: false },
  };
}

export default useSessionController;
