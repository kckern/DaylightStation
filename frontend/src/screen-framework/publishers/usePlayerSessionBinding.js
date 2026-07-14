// frontend/src/screen-framework/publishers/usePlayerSessionBinding.js
//
// usePlayerSessionBinding — React glue for createPlayerSessionBridge. Mount
// it wherever a legacy Player can appear (ScreenPlayer overlay wrapper,
// MenuWidget's MenuStack, ScreenActionHandler's MenuStack overlays) and hand
// it a getter for the Player's imperative ref. The bridge polls the getter:
// when the ref is live it registers with the playerSessionRegistry, when it
// goes null it unregisters. Multiple bindings can be mounted at once — only
// the one with a live ref registers.
import { useEffect, useRef } from 'react';
import { createPlayerSessionBridge } from './playerSessionBridge.js';
import { getPlayerSessionRegistry } from './playerSessionRegistry.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'usePlayerSessionBinding' });
  return _logger;
}

/**
 * @param {function} getPlayerHandle — returns the Player imperative handle or null.
 * @param {object}   [opts]
 * @param {function} [opts.getItemHint] — returns static item metadata fallback.
 * @param {object}   [opts.registry]    — override registry (tests).
 * @param {number}   [opts.pollMs]
 */
export function usePlayerSessionBinding(getPlayerHandle, { getItemHint, registry, pollMs } = {}) {
  // Latest-ref pattern: the bridge is created once but always reads the
  // freshest getters, so callers may pass inline closures.
  const getHandleRef = useRef(getPlayerHandle);
  getHandleRef.current = getPlayerHandle;
  const getHintRef = useRef(getItemHint);
  getHintRef.current = getItemHint;

  useEffect(() => {
    let bridge = null;
    try {
      bridge = createPlayerSessionBridge({
        getPlayerHandle: () => getHandleRef.current?.() ?? null,
        getItemHint: () => getHintRef.current?.() ?? null,
        registry: registry ?? getPlayerSessionRegistry(),
        ...(pollMs != null ? { pollMs } : {}),
      });
      bridge.start();
    } catch (err) {
      logger().warn('bridge-start-failed', { error: String(err?.message ?? err) });
    }
    return () => {
      try { bridge?.stop(); } catch { /* ignore */ }
    };
  }, [registry, pollMs]);
}

export default usePlayerSessionBinding;
