// frontend/src/screen-framework/publishers/playerSessionBridge.js
//
// createPlayerSessionBridge — adapts the legacy Player's imperative handle
// (modules/Player forwardRef: getMediaElement/getCurrentTime/getDuration/
// getVolume/getPlaybackRate/getNowPlaying) into the registry contract that
// SessionSource understands:
//   player          — { getState, getPosition, getDuration, getConfig, subscribe }
//   queueController — { getQueue, getCurrentItem, getCurrentIndex, subscribe }
//
// Seam notes (why the media element, not getPlaybackState()):
//   Player.getPlaybackState() reads controllerRef, which is only populated
//   when the play prop carries its own onController — usually null on screens.
//   Player.getMediaElement() (_getMediaElFallback) is the reliable reader: it
//   covers renderer media (onMediaRef), controller transports AND content
//   renderers (readalong etc.) that register via onRegisterMediaAccess.
//
// The bridge runs a single poll (default 1s): it registers/unregisters with
// the registry as the handle appears/disappears, and fires the player/queue
// subscriber callbacks only on actual state or item-identity changes (so the
// publisher's 500ms-debounced `change` publishes stay quiet during steady
// playback; the 5s heartbeat carries position updates).
//
// Everything is wrapped in try/catch — a broken bridge must never crash a
// screen (same defensive posture as SessionSource).
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'playerSessionBridge' });
  return _logger;
}

const DEFAULT_POLL_MS = 1000;

// Mirror of shared/contracts/media/shapes.mjs FORMATS (not exported there).
const KNOWN_FORMATS = new Set([
  'video', 'dash_video', 'hls_video', 'audio', 'singalong', 'readalong',
  'readable_paged', 'readable_flow', 'app', 'image', 'composite',
]);

const MEDIA_TYPE_TO_FORMAT = {
  audio: 'audio',
  video: 'video',
  image: 'image',
};

const firstString = (...candidates) => {
  for (const c of candidates) {
    if (c != null && String(c).length > 0) return String(c);
  }
  return null;
};

/**
 * Normalize legacy Player meta (the /play response shape) into a
 * contract-valid PlayableItem: { contentId, format, title?, thumbnail?,
 * duration? }. Returns null when no identity can be derived.
 *
 * @param {object|null} meta — effectiveMeta from the Player (title, thumbnail,
 *   image, duration, format, mediaType, id/assetId/plex/contentId).
 * @param {object|null} hint — static fallback (e.g. the play/queue prop the
 *   player was mounted with), used when meta hasn't resolved yet.
 */
export function normalizePlayableItem(meta, hint = null) {
  const src = (meta && typeof meta === 'object') ? meta : null;
  const fallback = (hint && typeof hint === 'object') ? hint : null;
  if (!src && !fallback) return null;

  const contentId = firstString(
    src?.contentId, src?.assetId, src?.id, src?.plex, src?.key,
    fallback?.contentId, fallback?.assetId, fallback?.plex, fallback?.id,
  );
  if (!contentId) return null;

  const rawFormat = src?.format ?? fallback?.format;
  const mediaType = src?.mediaType ?? fallback?.mediaType;
  const format = KNOWN_FORMATS.has(rawFormat)
    ? rawFormat
    : (MEDIA_TYPE_TO_FORMAT[mediaType] ?? 'video');

  const item = { contentId, format };

  const title = firstString(src?.title, src?.label, fallback?.title, fallback?.label);
  if (title) item.title = title;

  const thumbnail = firstString(src?.thumbnail, src?.image, fallback?.thumbnail, fallback?.image);
  if (thumbnail) item.thumbnail = thumbnail;

  const duration = Number(src?.duration ?? fallback?.duration);
  if (Number.isFinite(duration) && duration > 0) item.duration = duration;

  return item;
}

/**
 * @param {object} opts
 * @param {function} opts.getPlayerHandle — returns the Player imperative
 *   handle (ref.current) or null when no player is mounted.
 * @param {object}   opts.registry        — playerSessionRegistry instance.
 * @param {function} [opts.getItemHint]   — returns a static item fallback
 *   (mount props) used until the player resolves real metadata.
 * @param {number}   [opts.pollMs]
 * @param {function} [opts.setIntervalFn] / [opts.clearIntervalFn] — test seams.
 */
export function createPlayerSessionBridge({
  getPlayerHandle,
  registry,
  getItemHint = null,
  pollMs = DEFAULT_POLL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (typeof getPlayerHandle !== 'function') {
    throw new TypeError('createPlayerSessionBridge: getPlayerHandle (function) is required');
  }
  if (!registry || typeof registry.registerPlayerSession !== 'function') {
    throw new TypeError('createPlayerSessionBridge: registry is required');
  }

  let timer = null;
  let unregister = null;
  const playerSubs = new Set();
  const queueSubs = new Set();
  let lastState = null;
  let lastItemKey = null;
  let observedPlaying = false;
  let observedAdvance = false;
  let observedOperationSeeking = false;
  let observedTargetSeeked = false;
  let observedLastTime = null;
  let observedBindingKey = null;
  let observedResolvedContentId = null;
  let nativeNodeGeneration = 0;
  let detachNativeObservation = () => {};
  let mountedOperationSubscription = null;
  let mountedOperationHandle = null;
  const nativeSubs = new Set();

  const readHandle = () => {
    try {
      return getPlayerHandle() ?? null;
    } catch {
      return null;
    }
  };

  const readHint = () => {
    if (typeof getItemHint !== 'function') return null;
    try {
      return getItemHint() ?? null;
    } catch {
      return null;
    }
  };

  const readMediaEl = () => {
    const handle = readHandle();
    if (!handle) return null;
    try {
      return handle.getMediaElement?.() ?? null;
    } catch {
      return null;
    }
  };

  const nativeError = (el) => {
    const error = el?.error;
    if (!error) return null;
    return { code: error.code ?? null, message: error.message ?? null };
  };

  const emitNative = () => {
    for (const sub of [...nativeSubs]) {
      try { sub.listener(getNativeObservation(sub.sessionId)); } catch (err) {
        logger().warn('native-subscriber-threw', { error: String(err?.message ?? err) });
      }
    }
  };

  const observeNativeNode = (el, handle = readHandle(), operationBinding = null) => {
    let issued = null;
    let resolvedContentId = null;
    let resolvedGeneration = null;
    let acceptedRegistration = null;
    try { issued = handle?.getPlaybackIdentity?.() ?? null; } catch { /* ignore */ }
    try { resolvedContentId = handle?.getMountedContentId?.() ?? null; } catch { /* ignore */ }
    try { resolvedGeneration = handle?.getMountedMediaGeneration?.() ?? null; } catch { /* ignore */ }
    try { acceptedRegistration = handle?.getMountedMediaRegistration?.() ?? null; } catch { /* ignore */ }
    const registrationMatches = Boolean(el && acceptedRegistration
      && acceptedRegistration.node === el
      && acceptedRegistration.resolvedContentId === resolvedContentId
      && acceptedRegistration.resolvedGeneration === resolvedGeneration
      && typeof acceptedRegistration.ownerInstanceId === 'string'
      && Number.isInteger(acceptedRegistration.playbackRevision));
    const bindingKey = el && handle ? {
      node: el,
      resolvedContentId,
      resolvedGeneration,
      ownerInstanceId: registrationMatches ? acceptedRegistration.ownerInstanceId : null,
      ownerPlaybackRevision: registrationMatches ? acceptedRegistration.playbackRevision : null,
      logicalOwnerInstanceId: issued?.ownerInstanceId ?? null,
      logicalOwnerPlaybackRevision: issued?.playbackRevision ?? null,
      registrationAdmitted: registrationMatches,
      operationId: operationBinding?.operationId
        ?? (acceptedRegistration?.operationProof ? acceptedRegistration?.rendererToken?.operationId ?? null : null),
      rendererToken: operationBinding?.rendererToken
        ?? (acceptedRegistration?.operationProof ? acceptedRegistration?.rendererToken ?? null : null),
      targetSeconds: Number.isFinite(operationBinding?.targetSeconds)
        ? operationBinding.targetSeconds
        : null,
    } : null;
    if (bindingKey && observedBindingKey
      && bindingKey.node === observedBindingKey.node
      && bindingKey.resolvedContentId === observedBindingKey.resolvedContentId
      && bindingKey.resolvedGeneration === observedBindingKey.resolvedGeneration
      && (!operationBinding || (
        bindingKey.operationId === observedBindingKey.operationId
        && bindingKey.rendererToken === observedBindingKey.rendererToken
        && bindingKey.targetSeconds === observedBindingKey.targetSeconds
      ))) {
      if (bindingKey.ownerInstanceId !== observedBindingKey.ownerInstanceId
        || bindingKey.ownerPlaybackRevision !== observedBindingKey.ownerPlaybackRevision
        || bindingKey.logicalOwnerInstanceId !== observedBindingKey.logicalOwnerInstanceId
        || bindingKey.logicalOwnerPlaybackRevision !== observedBindingKey.logicalOwnerPlaybackRevision) {
        observedPlaying = false;
        observedAdvance = false;
        observedOperationSeeking = false;
        observedTargetSeeked = false;
        observedLastTime = Number.isFinite(el?.currentTime) ? el.currentTime : null;
      }
      return;
    }
    if (!bindingKey && !observedBindingKey) return;
    try { detachNativeObservation(); } catch { /* ignore */ }
    observedPlaying = false;
    observedAdvance = false;
    observedOperationSeeking = false;
    observedTargetSeeked = false;
    observedLastTime = Number.isFinite(el?.currentTime) ? el.currentTime : null;
    observedBindingKey = bindingKey;
    observedResolvedContentId = resolvedContentId;
    nativeNodeGeneration += 1;
    detachNativeObservation = () => {};
    if (!el || typeof el.addEventListener !== 'function') return;
    const thisBinding = bindingKey;
    const isCurrent = () => {
      if (observedBindingKey !== thisBinding || readMediaEl() !== el) return false;
      const currentHandle = readHandle();
      let currentIdentity = null;
      let currentGeneration = null;
      try { currentIdentity = currentHandle?.getPlaybackIdentity?.() ?? null; } catch { /* ignore */ }
      try { currentGeneration = currentHandle?.getMountedMediaGeneration?.() ?? null; } catch { /* ignore */ }
      const ownerStillAdmitted = thisBinding.registrationAdmitted
        && currentIdentity?.ownerInstanceId === thisBinding.ownerInstanceId
        && currentIdentity?.playbackRevision === thisBinding.ownerPlaybackRevision
        && currentIdentity?.ownerInstanceId === thisBinding.logicalOwnerInstanceId
        && currentIdentity?.playbackRevision === thisBinding.logicalOwnerPlaybackRevision;
      return ownerStillAdmitted && currentGeneration === thisBinding.resolvedGeneration;
    };
    const update = (fn) => {
      if (!isCurrent()) return;
      fn();
      emitNative();
    };
    const markPlaying = () => update(() => {
      observedPlaying = true;
      observedAdvance = false;
      observedLastTime = Number.isFinite(el.currentTime) ? el.currentTime : null;
    });
    const clearPlaying = () => update(() => { observedPlaying = false; });
    const markSeeking = () => update(() => {
      observedPlaying = false;
      if (thisBinding.operationId && thisBinding.targetSeconds > 0) {
        observedOperationSeeking = true;
        observedTargetSeeked = false;
        observedAdvance = false;
      }
    });
    const markSeeked = () => update(() => {
      if (observedOperationSeeking && thisBinding.operationId && thisBinding.targetSeconds > 0
        && Number.isFinite(el.currentTime)
        && Math.abs(el.currentTime - thisBinding.targetSeconds) <= 0.75) {
        observedTargetSeeked = true;
        observedPlaying = false;
        observedAdvance = false;
      }
    });
    const markEnded = () => update(() => { observedPlaying = false; });
    const markAdvanced = () => update(() => {
      const current = Number.isFinite(el.currentTime) ? el.currentTime : null;
      if (observedPlaying && current != null && observedLastTime != null && current > observedLastTime) observedAdvance = true;
      observedLastTime = current;
    });
    try {
      el.addEventListener('playing', markPlaying);
      el.addEventListener('pause', clearPlaying);
      el.addEventListener('waiting', clearPlaying);
      el.addEventListener('seeking', markSeeking);
      el.addEventListener('seeked', markSeeked);
      el.addEventListener('ended', markEnded);
      el.addEventListener('error', markEnded);
      el.addEventListener('timeupdate', markAdvanced);
      detachNativeObservation = () => {
        el.removeEventListener?.('playing', markPlaying);
        el.removeEventListener?.('pause', clearPlaying);
        el.removeEventListener?.('waiting', clearPlaying);
        el.removeEventListener?.('seeking', markSeeking);
        el.removeEventListener?.('seeked', markSeeked);
        el.removeEventListener?.('ended', markEnded);
        el.removeEventListener?.('error', markEnded);
        el.removeEventListener?.('timeupdate', markAdvanced);
      };
    } catch {
      detachNativeObservation = () => {};
    }
  };

  function getNativeObservation(sessionId) {
    const handle = readHandle();
    if (!handle) return null;
    let el = null;
    try { el = handle.getMediaElement?.() ?? null; } catch { /* ignore */ }
    observeNativeNode(el, handle);
    if (!el) return null;
    let queue = null;
    let issued = null;
    try { queue = copyQueueSnapshot(handle.getQueueSnapshot?.()); } catch { /* ignore */ }
    try { issued = handle.getPlaybackIdentity?.() ?? null; } catch { /* ignore */ }
    const current = queue?.currentIndex >= 0 ? queue.items[queue.currentIndex] : null;
    const ownerMatchesNode = current
      && observedResolvedContentId != null
      && String(current.contentId) === String(observedResolvedContentId)
      && issued?.ownerInstanceId
      && issued.ownerInstanceId === observedBindingKey?.ownerInstanceId
      && issued.playbackRevision === observedBindingKey?.ownerPlaybackRevision
      && observedBindingKey?.registrationAdmitted === true
      && Number.isInteger(issued.playbackRevision)
      && Number.isInteger(issued.queueRevision);
    const identity = ownerMatchesNode && sessionId ? {
      ownerInstanceId: issued.ownerInstanceId,
      playbackRevision: issued.playbackRevision,
      queueRevision: issued.queueRevision,
      sessionId,
      contentId: current.contentId,
      queueItemId: current.queueItemId,
    } : null;
    return {
      node: el,
      nodeGeneration: nativeNodeGeneration,
      resolvedContentId: observedResolvedContentId,
      resolvedGeneration: observedBindingKey?.resolvedGeneration ?? null,
      operationId: observedBindingKey?.operationId ?? null,
      rendererToken: observedBindingKey?.rendererToken ?? null,
      identity,
      currentTime: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null,
      readyState: Number.isInteger(el.readyState) ? el.readyState : 0,
      paused: Boolean(el.paused),
      seeking: Boolean(el.seeking),
      ended: Boolean(el.ended),
      error: nativeError(el),
      playingObserved: observedPlaying,
      advancedObserved: observedAdvance,
      targetSeekedObserved: observedTargetSeeked,
    };
  }

  const readNowPlayingMeta = () => {
    const handle = readHandle();
    if (!handle) return null;
    try {
      const np = handle.getNowPlaying?.();
      return np?.item ?? null;
    } catch {
      return null;
    }
  };

  const readQueueSnapshot = () => {
    const handle = readHandle();
    if (!handle) return null;
    try {
      const queue = handle.getQueueSnapshot?.();
      return queue && typeof queue === 'object' ? queue : null;
    } catch {
      return null;
    }
  };

  const copyQueueSnapshot = (queue) => {
    const items = Array.isArray(queue?.items) ? queue.items.map((item) => ({ ...item })) : [];
    const currentIndex = Number.isInteger(queue?.currentIndex) ? queue.currentIndex : -1;
    return {
      items,
      currentIndex,
      upNextCount: Number.isInteger(queue?.upNextCount) && queue.upNextCount >= 0
        ? queue.upNextCount
        : items.filter((item) => item?.priority === 'upNext').length,
      ...(Array.isArray(queue?.executionOrder) ? { executionOrder: [...queue.executionOrder] } : {}),
    };
  };

  // Exactly one imperative queue read defines a capture. Consumers must carry
  // this object through rather than re-reading items/index/order separately.
  const readOwnerCapture = () => {
    const handle = readHandle();
    if (!handle) return null;
    const queue = copyQueueSnapshot(readQueueSnapshot());
    let issuedIdentity = null;
    try { issuedIdentity = handle.getPlaybackIdentity?.() ?? null; } catch { /* ignore */ }
    const validIssuedIdentity = issuedIdentity
      && typeof issuedIdentity.ownerInstanceId === 'string'
      && issuedIdentity.ownerInstanceId.length > 0
      && Number.isInteger(issuedIdentity.playbackRevision)
      && issuedIdentity.playbackRevision >= 0
      && Number.isInteger(issuedIdentity.queueRevision)
      && issuedIdentity.queueRevision >= 0
      ? {
        ownerInstanceId: issuedIdentity.ownerInstanceId,
        playbackRevision: issuedIdentity.playbackRevision,
        queueRevision: issuedIdentity.queueRevision,
      }
      : null;
    const currentEntry = queue.currentIndex >= 0 ? queue.items[queue.currentIndex] : null;
    const canResolveMountedContent = typeof handle.getMountedContentId === 'function';
    let resolvedContentId = null;
    try { resolvedContentId = handle.getMountedContentId?.() ?? null; } catch { /* ignore */ }
    const resolvedCurrent = !canResolveMountedContent || (currentEntry
      && resolvedContentId != null
      && String(currentEntry.contentId) === String(resolvedContentId));
    return {
      queue,
      issuedIdentity: validIssuedIdentity,
      currentItem: getCurrentItem(),
      config: getConfig(),
      state: getState(),
      // A pending B load may still expose A's accessor node. Never attach
      // A's clock to B's queue identity; the native observation port reports
      // the mismatch explicitly until Player resolves the current content.
      position: resolvedCurrent ? getPosition() : 0,
    };
  };

  const getState = () => {
    const handle = readHandle();
    if (!handle) return 'idle';
    try {
      const ownerState = handle.getOwnerState?.();
      if (ownerState) return ownerState;
    } catch { /* native state fallback below */ }
    const el = readMediaEl();
    // No media element yet (still resolving /play, or a non-AV format like an
    // image slideshow) — report loading rather than lying about playback.
    if (!el) return 'loading';
    observeNativeNode(el, handle);
    try {
      if (el.ended) return 'ended';
      if (el.paused) return 'paused';
      return observedPlaying ? 'playing' : 'buffering';
    } catch {
      return 'loading';
    }
  };

  const getPosition = () => {
    const handle = readHandle();
    if (!handle) return 0;
    try {
      const t = handle.getCurrentTime?.();
      return Number.isFinite(t) && t >= 0 ? t : 0;
    } catch {
      return 0;
    }
  };

  const getDuration = () => {
    const handle = readHandle();
    if (!handle) return null;
    try {
      const d = handle.getDuration?.();
      return Number.isFinite(d) && d > 0 ? d : null;
    } catch {
      return null;
    }
  };

  const getConfig = () => {
    const handle = readHandle();
    if (!handle) return null;
    const config = {};
    try {
      const queueConfig = handle.getQueueConfig?.();
      if (typeof queueConfig?.shuffle === 'boolean') config.shuffle = queueConfig.shuffle;
      if (['off', 'one', 'all'].includes(queueConfig?.repeat)) config.repeat = queueConfig.repeat;
    } catch { /* ignore */ }
    try {
      const v = handle.getVolume?.();
      if (Number.isFinite(v)) {
        // Player session volume is 0..1; the snapshot contract wants 0..100.
        config.volume = Math.round(v <= 1 ? v * 100 : Math.min(100, v));
      }
    } catch { /* ignore */ }
    try {
      const r = handle.getPlaybackRate?.();
      if (Number.isFinite(r)) config.playbackRate = r;
    } catch { /* ignore */ }
    try {
      const shader = handle.getShader?.();
      if (shader === null || typeof shader === 'string') config.shader = shader;
    } catch { /* ignore */ }
    return config;
  };

  const getCurrentItem = () => {
    const item = normalizePlayableItem(readNowPlayingMeta(), readHint());
    if (!item) return null;
    if (item.duration == null) {
      const d = getDuration();
      if (d != null) item.duration = d;
    }
    return item;
  };

  const getCurrentIndex = () => {
    const captured = readQueueSnapshot();
    if (Number.isInteger(captured?.currentIndex) && captured.currentIndex >= 0) return captured.currentIndex;
    const handle = readHandle();
    if (!handle) return -1;
    try {
      const np = handle.getNowPlaying?.();
      const idx = np?.queuePosition;
      return Number.isInteger(idx) && idx >= 0 ? idx : (getCurrentItem() ? 0 : -1);
    } catch {
      return -1;
    }
  };

  const player = {
    getState,
    getPosition,
    getDuration,
    getConfig,
    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      playerSubs.add(cb);
      return () => playerSubs.delete(cb);
    },
  };

  const queueController = {
    getCurrentItem,
    getQueue: () => {
      const items = readQueueSnapshot()?.items;
      return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
    },
    getCurrentIndex,
    getExecutionOrder: () => {
      const order = readQueueSnapshot()?.executionOrder;
      return Array.isArray(order) ? [...order] : undefined;
    },
    capture(sessionId) {
      const captured = readOwnerCapture();
      if (!captured) return null;
      const { issuedIdentity, queue, state } = captured;
      const { items, currentIndex } = queue;
      const currentEntry = currentIndex >= 0 ? items[currentIndex] : null;
      const identity = issuedIdentity && sessionId
        && (currentEntry?.queueItemId && currentEntry?.contentId || state === 'idle')
        ? {
        ...issuedIdentity,
        sessionId,
        contentId: currentEntry?.contentId ?? null,
        queueItemId: currentEntry?.queueItemId ?? null,
        }
        : null;
      return { ...captured, queue, identity };
    },
    getPlaybackOwner(sessionId) {
      return this.capture(sessionId)?.identity ?? null;
    },
    getOwnerCapabilities() {
      const current = readOwnerCapture();
      const item = current?.currentItem;
      return {
        handoffV1: false,
        seekable: Boolean(item && Number.isFinite(current?.position) && getDuration() != null),
        liveEdge: false,
      };
    },
    adopt(snapshot, options = {}) {
      const handle = readHandle();
      if (!handle || typeof handle.adoptSessionSnapshot !== 'function') {
        return { ok: false, code: 'UNSUPPORTED' };
      }
      const requiredObserverIds = mountedOperationHandle === handle
        && mountedOperationSubscription?.observerId
        ? [mountedOperationSubscription.observerId]
        : [];
      return handle.adoptSessionSnapshot(snapshot, { ...options, requiredObserverIds });
    },
    stopIfCurrent(expected, sessionId) {
      const handle = readHandle();
      if (!handle || typeof handle.stopIfCurrent !== 'function') {
        return { ok: false, code: 'SOURCE_CHANGED' };
      }
      return handle.stopIfCurrent(expected, sessionId);
    },
    getNativeObservation,
    subscribeNative(listener, sessionId) {
      if (typeof listener !== 'function') return () => {};
      const sub = { listener, sessionId };
      nativeSubs.add(sub);
      getNativeObservation(sessionId);
      return () => nativeSubs.delete(sub);
    },
    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      queueSubs.add(cb);
      return () => queueSubs.delete(cb);
    },
  };

  const emitPlayer = (state) => {
    for (const cb of [...playerSubs]) {
      try { cb(state); } catch (err) {
        logger().warn('player-subscriber-threw', { error: String(err?.message ?? err) });
      }
    }
  };

  const emitQueue = () => {
    for (const cb of [...queueSubs]) {
      try { cb(); } catch (err) {
        logger().warn('queue-subscriber-threw', { error: String(err?.message ?? err) });
      }
    }
  };

  const tick = () => {
    try {
      const handle = readHandle();

      if (handle && !unregister) {
        unregister = registry.registerPlayerSession({ player, queueController });
        lastState = null;
        lastItemKey = null;
      } else if (!handle && unregister) {
        try { unregister(); } catch { /* ignore */ }
        unregister = null;
        try { mountedOperationSubscription?.unsubscribe?.(); } catch { /* ignore */ }
        mountedOperationSubscription = null;
        mountedOperationHandle = null;
        lastState = null;
        lastItemKey = null;
        return;
      }

      if (!handle) return;

      if (mountedOperationHandle !== handle) {
        try { mountedOperationSubscription?.unsubscribe?.(); } catch { /* ignore */ }
        mountedOperationSubscription = null;
        mountedOperationHandle = handle;
        if (typeof handle.subscribeMountedMediaOperations === 'function') {
          mountedOperationSubscription = handle.subscribeMountedMediaOperations((binding) => {
            if (!binding || readHandle() !== handle) return { ready: false };
            observeNativeNode(binding.node, handle, binding);
            let accepted = null;
            try { accepted = handle.getMountedMediaRegistration?.() ?? null; } catch { /* ignore */ }
            const ready = observedBindingKey?.node === binding.node
              && observedBindingKey?.resolvedGeneration === binding.resolvedGeneration
              && accepted?.rendererToken === binding.rendererToken;
            return ready ? { ready: true, ...binding } : { ready: false };
          });
        }
      }

      const state = getState();
      if (state !== lastState) {
        lastState = state;
        emitPlayer(state);
      }

      const item = getCurrentItem();
      const itemKey = item ? `${item.contentId}|${item.title ?? ''}` : null;
      if (itemKey !== lastItemKey) {
        lastItemKey = itemKey;
        emitQueue();
      }
    } catch (err) {
      logger().warn('tick-failed', { error: String(err?.message ?? err) });
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setIntervalFn(tick, pollMs);
      tick();
    },
    stop() {
      if (timer) {
        try { clearIntervalFn(timer); } catch { /* ignore */ }
        timer = null;
      }
      if (unregister) {
        try { unregister(); } catch { /* ignore */ }
        unregister = null;
      }
      try { mountedOperationSubscription?.unsubscribe?.(); } catch { /* ignore */ }
      mountedOperationSubscription = null;
      mountedOperationHandle = null;
      lastState = null;
      lastItemKey = null;
      try { detachNativeObservation(); } catch { /* ignore */ }
      detachNativeObservation = () => {};
      observedPlaying = false;
      observedAdvance = false;
      observedLastTime = null;
      observedBindingKey = null;
      observedResolvedContentId = null;
      nativeSubs.clear();
    },
    // Exposed for tests / diagnostics.
    player,
    queueController,
  };
}

export default createPlayerSessionBridge;
