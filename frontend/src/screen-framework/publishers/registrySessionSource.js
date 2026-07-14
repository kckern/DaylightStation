// frontend/src/screen-framework/publishers/registrySessionSource.js
//
// createRegistrySessionSource — a SessionSource ({getSnapshot, subscribe})
// whose backing player/queueController is whatever is currently registered in
// the playerSessionRegistry. When nothing is registered it behaves exactly
// like the idle fallback source (`createSessionSource({ ownerId })`).
//
// This is what ScreenRenderer feeds into <SessionSourceProvider> so the
// renderer-level <SessionStatePublisher> can observe a Player mounted far
// away (overlay or nav stack). Everything is wrapped defensively: a broken
// registration degrades to the idle snapshot, never a crash.
import { createSessionSource } from './SessionSource.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'registrySessionSource' });
  return _logger;
}

function randomSessionId() {
  try {
    if (typeof globalThis !== 'undefined'
      && globalThis.crypto
      && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {object} opts
 * @param {object} opts.registry  — playerSessionRegistry instance.
 * @param {string} opts.ownerId   — deviceId; goes in snapshot.meta.ownerId.
 * @param {string} [opts.sessionId] — stable session id (generated if omitted).
 */
export function createRegistrySessionSource({ registry, ownerId, sessionId } = {}) {
  if (!registry || typeof registry.getCurrent !== 'function') {
    throw new TypeError('createRegistrySessionSource: registry is required');
  }
  if (!ownerId || typeof ownerId !== 'string') {
    throw new TypeError('createRegistrySessionSource: ownerId (non-empty string) is required');
  }

  // One stable sessionId across registration changes so fleet consumers see a
  // continuous session per screen, not a new id every time a player mounts.
  const sid = sessionId && typeof sessionId === 'string' ? sessionId : randomSessionId();

  const idleSource = createSessionSource({ ownerId, sessionId: sid });

  // Cache the adapted source per registration identity so getSnapshot()
  // doesn't rebuild it on every call.
  let cachedReg = null;
  let cachedSource = null;

  const sourceFor = (reg) => {
    if (!reg) return idleSource;
    if (cachedReg === reg && cachedSource) return cachedSource;
    const queueController = reg.queueController
      ?? (reg.item ? { getCurrentItem: () => reg.item } : null);
    cachedReg = reg;
    cachedSource = createSessionSource({
      player: reg.player ?? null,
      queueController,
      ownerId,
      sessionId: sid,
    });
    return cachedSource;
  };

  const currentSource = () => {
    try {
      return sourceFor(registry.getCurrent());
    } catch (err) {
      logger().warn('source-resolve-failed', { error: String(err?.message ?? err) });
      return idleSource;
    }
  };

  function getSnapshot() {
    try {
      return currentSource().getSnapshot();
    } catch (err) {
      logger().warn('snapshot-failed', { error: String(err?.message ?? err) });
      try {
        return idleSource.getSnapshot();
      } catch {
        return null; // useSessionStatePublisher skips null snapshots
      }
    }
  }

  function subscribe({ onChange, onStateTransition } = {}) {
    let innerUnsub = null;

    const wireInner = () => {
      if (typeof innerUnsub === 'function') {
        try { innerUnsub(); } catch { /* ignore */ }
      }
      innerUnsub = null;
      try {
        innerUnsub = currentSource().subscribe({ onChange, onStateTransition });
      } catch (err) {
        logger().warn('inner-subscribe-failed', { error: String(err?.message ?? err) });
      }
    };

    wireInner();

    let registryUnsub = () => {};
    try {
      registryUnsub = registry.subscribe(() => {
        wireInner();
        // Registration flips are both a content change and (usually) a state
        // transition — emit both so the publisher re-publishes immediately and
        // starts/stops its heartbeat.
        try { onChange?.(); } catch (err) {
          logger().warn('onChange-threw', { error: String(err?.message ?? err) });
        }
        try {
          const state = getSnapshot()?.state ?? 'idle';
          onStateTransition?.(state);
        } catch (err) {
          logger().warn('onStateTransition-threw', { error: String(err?.message ?? err) });
        }
      });
    } catch (err) {
      logger().warn('registry-subscribe-failed', { error: String(err?.message ?? err) });
    }

    return () => {
      try { registryUnsub(); } catch { /* ignore */ }
      if (typeof innerUnsub === 'function') {
        try { innerUnsub(); } catch { /* ignore */ }
      }
    };
  }

  return {
    getSnapshot,
    subscribe,
    get sessionId() { return sid; },
    get ownerId() { return ownerId; },
  };
}

export default createRegistrySessionSource;
