import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useScreenAction } from '../input/useScreenAction.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { useHasMenuNavigationContext, useMenuNavigationContext } from '../../context/useMenuNavigationContext.js';
import { usePip } from '../pip/usePip.js';
import { DaylightAPI } from '../../lib/api.mjs';
import MenuStack from '../../modules/Menu/MenuStack.jsx';
import { ScreenPlayer as Player } from '../publishers/ScreenPlayer.jsx';
import { getPlayerQueueOpRegistry } from '../../modules/Player/lib/queueOpRegistry.js';
import { usePlayerSessionBinding } from '../publishers/usePlayerSessionBinding.js';
import AppContainer from '../../modules/AppContainer/AppContainer.jsx';
import { getApp } from '../../lib/appRegistry.js';
import { getWidgetRegistry } from '../widgets/registry.js';
import { useScreenVolume } from '../../lib/volume/ScreenVolumeContext.js';
import getLogger from '../../lib/logging/Logger.js';
import { dispatchCyclePlaybackRate } from './cyclePlaybackRate.js';
import { getActionBus } from '../input/ActionBus.js';
import { useSessionSourceContext } from '../publishers/useSessionSourceContext.js';
import { getScreenItemActions } from './screenItemActions.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenActionHandler' });
  return _logger;
}

/**
 * ScreenActionHandler - Bridges ActionBus events to the overlay system.
 *
 * Listens for actions emitted by input adapters (e.g., NumpadAdapter)
 * and translates them into showOverlay/dismissOverlay calls or direct effects.
 *
 * Supported actions:
 *   menu:open       - Opens MenuStack as a fullscreen overlay
 *   media:play      - Opens Player with a single content item
 *   media:queue     - Opens Player with a queued content item
 *   media:queue-op  - Queue ops (play-now mounts Player; reorder via item actions; others logged as unhandled)
 *   media:config-set - Remote shuffle/repeat/volume applied by the playback owner
 *   media:playback  - Play/pause, prev, next, fwd, rew on active media
 *   media:rate      - Cycle playback speed (1x → 1.5x → 2x)
 *   display:volume  - Volume up/down/mute via API
 *   display:shader  - Cycle screen dimming overlay
 *   display:sleep   - Full blackout toggle with wake-on-keypress
 *   escape          - Dismisses the current fullscreen overlay
 *
 * This is a renderless component (returns null).
 */
/**
 * Bridges the hardware/browser Back button (popstate) to the overlay system.
 * MenuNavigationContext gives a registered back-consumer first dibs before it
 * pops the menu, so a fullscreen scene above the menu (e.g. a triggered ArtMode
 * slideshow) is dismissed by Back instead of silently popping the hidden stack.
 *
 * Rendered only when a MenuNavigationProvider is present (tests may mount
 * ScreenActionHandler standalone). The consumer is stable; it reads live state
 * from refs at back-press time, so no re-registration churn.
 */
function MenuBackConsumerBridge({ consumer }) {
  const { registerBackConsumer, unregisterBackConsumer } = useMenuNavigationContext();
  useEffect(() => {
    if (!registerBackConsumer) return undefined;
    registerBackConsumer(consumer);
    return () => unregisterBackConsumer?.();
  }, [registerBackConsumer, unregisterBackConsumer, consumer]);
  return null;
}

// A menuId is either a LEGACY MENU KEY (`music`, `tv` — resolved under
// `api/v1/list/watchlist/…`) or a SOURCE-PREFIXED CONTENT ID (`plex:663144`,
// `menu:music` — resolved under `api/v1/list/<source>/<id>`). Menu.jsx picks
// the endpoint from the SHAPE it is handed: a bare string always means the
// watchlist key, an object with `contentId` means the content id.
//
// Everything that mints a content-id menuId — `?list=`/`?open=` (see
// `toContentId` in parseAutoplayParams), NFC triggers, WS dispatch — was
// handing the string form, so `?list=plex:663144` asked the backend for the
// watchlist literally named "plex:663144". That returns 200 with `items: []`,
// which renders as an empty menu: the trigger looks like it did nothing.
// Colons cannot appear in a watchlist key, so the shape is unambiguous.
const toMenuRoot = (menuId) => (
  typeof menuId === 'string' && menuId.includes(':') ? { contentId: menuId } : menuId
);

export function ScreenActionHandler({ actions = {}, inputType = null }) {
  const sessionSource = useSessionSourceContext();
  const itemActions = useMemo(() => getScreenItemActions(sessionSource), [sessionSource]);
  const { showOverlay, dismissOverlay, hasOverlay, escapeInterceptorRef } = useScreenOverlay();
  const pip = usePip();
  const hasMenuNav = useHasMenuNavigationContext();
  const { step: stepVolume, toggleMute: toggleVolumeMute, stepSize: volumeStepSize } = useScreenVolume();
  const shaderRef = useRef(null);
  const prevShaderOpacity = useRef(null);

  // --- Ensure shader element exists ---
  const getShader = useCallback(() => {
    if (!shaderRef.current) {
      let el = document.querySelector('.screen-action-shader');
      if (!el) {
        el = document.createElement('div');
        el.className = 'screen-action-shader';
        Object.assign(el.style, {
          position: 'fixed', inset: '0', background: '#000',
          opacity: '0', pointerEvents: 'none', zIndex: '9998',
          transition: 'opacity 0.3s ease',
        });
        document.body.appendChild(el);
      }
      shaderRef.current = el;
    }
    return shaderRef.current;
  }, []);

  // --- Menu ---
  const currentMenuRef = useRef(null);

  // Nav-stack Player session bridge: MenuStack overlays mount the legacy
  // Player for menu selections (type:player). Forward a ref so the mounted
  // player registers with the playerSessionRegistry (fleet device-state).
  const navPlayerRef = useRef(null);
  usePlayerSessionBinding(() => navPlayerRef.current);

  const handleMenuOpen = useCallback((payload) => {
    // Check if menuId matches a registered app (e.g., "videocall/livingroom-tv")
    const menuId = payload.menuId;
    const appId = menuId?.split('/')[0];
    if (appId && getApp(appId)) {
      logger().info('app.open', { menuId, appId });
      showOverlay(AppContainer, { open: menuId, clear: () => dismissOverlay() });
      return;
    }

    const duplicateMode = actions?.menu?.duplicate;
    if (duplicateMode && currentMenuRef.current === menuId) {
      if (duplicateMode === 'navigate') {
        // Dispatch synthetic ArrowRight so Menu.jsx advances to the next item sequentially
        // (ArrowDown skips by column count in grid layouts; ArrowRight always moves +1)
        logger().debug('menu.duplicate-navigate', { menuId });
        const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true });
        ev._menuNav = true;
        window.dispatchEvent(ev);
      } else {
        logger().debug('menu.duplicate-ignored', { menuId });
      }
      return;
    }
    currentMenuRef.current = menuId;
    const menuTimeout = actions?.menu?.timeout ?? 0;
    // `ownsNavStack`: a MenuStack overlay RENDERS the shared MenuNavigation
    // stack, so for as long as it is up it is the stack's only renderer and the
    // screen's own menu widget yields (MenuWidget). Without it, a selection made
    // here mounted a Player in BOTH — two unmuted videos in sync.
    showOverlay(
      MenuStack,
      { rootMenu: toMenuRoot(menuId), MENU_TIMEOUT: menuTimeout, playerRef: navPlayerRef },
      { priority: 'high', ownsNavStack: true },
    );
  }, [showOverlay, dismissOverlay, actions]);

  // --- Media play/queue ---
  const lastMediaRef = useRef(null);
  const MEDIA_DEDUP_WINDOW_MS = 3000;

  const isMediaDuplicate = useCallback((contentId) => {
    const now = Date.now();
    if (contentId && contentId === lastMediaRef.current?.contentId
        && now - lastMediaRef.current.ts < MEDIA_DEDUP_WINDOW_MS) {
      logger().debug('media.duplicate-suppressed', { contentId, windowMs: MEDIA_DEDUP_WINDOW_MS });
      return true;
    }
    lastMediaRef.current = { contentId, ts: now };
    return false;
  }, []);

  const handleMediaPlay = useCallback((payload) => {
    if (isMediaDuplicate(payload.contentId)) return;
    dismissOverlay();
    showOverlay(Player, {
      play: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    }, { chrome: 'media', suspendsNavStack: true });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);

  const handleMediaQueue = useCallback((payload) => {
    if (isMediaDuplicate(payload.contentId)) return;
    dismissOverlay();
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    }, { chrome: 'media', suspendsNavStack: true });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);

  // Register an idle playback owner when none is mounted. It holds a queue
  // without starting media and lets a later adoption start (or not) exactly
  // once. Screensavers and other idle fullscreen content must yield first:
  // ScreenOverlayProvider intentionally refuses a normal-priority overlay
  // while one is already mounted. Notify the screensaver controller before
  // replacing its overlay so it rearms its timer.
  const ensurePlaybackOwner = useCallback(async (reason) => {
    const hasOwner = () => !!(sessionSource?.getActionOwner?.() ?? sessionSource?.capture?.()?.identity);
    if (!sessionSource) return true;
    if (hasOwner()) return true;
    getActionBus().emit('screen:screensaver-dismiss', { reason });
    dismissOverlay();
    showOverlay(Player, { play: [], clear: () => dismissOverlay() }, { chrome: 'media', suspendsNavStack: true });
    const deadline = Date.now() + 3000;
    while (!hasOwner() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return hasOwner();
  }, [sessionSource, showOverlay, dismissOverlay]);

  // --- Restore a snapshot (Put it back, resume after sleep, power-cut) ---
  // Request/response over the ActionBus: `media:restore-snapshot`
  // { snapshot, autoplay, reason, requestId } → `media:restore-snapshot-result`
  // { requestId, ok, code? }. Old owner proof is stripped: the owner mints a
  // new identity for the restored visit.
  // Every start that can reach this screen bumps the epoch. A restore that
  // sees the epoch move while it waited (owner bootstrap is async) was
  // overtaken by a newer start — a WakeAndLoad play-now, a URL autoplay,
  // local input — and must not adopt over it. (`media:adopt-snapshot` bumps it
  // itself, inside handleAdoptSnapshot, so no subscription ordering can make
  // an adopt supersede itself.)
  const startEpochRef = useRef(0);
  useEffect(() => {
    const bus = getActionBus();
    const bump = () => { startEpochRef.current += 1; };
    const unsubs = ['media:play', 'media:queue', 'media:queue-op', 'media:handoff']
      .map((event) => bus.subscribe(event, bump));
    return () => unsubs.forEach((u) => u());
  }, []);

  const handleRestoreSnapshot = useCallback((payload = {}) => {
    const { snapshot, autoplay = false, reason = 'restore', requestId, onResult } = payload;
    const reply = (result) => {
      getActionBus().emit('media:restore-snapshot-result', { requestId, ...result });
      try { onResult?.(result); } catch { /* a result observer must not break the restore */ }
    };
    if (!snapshot?.queue?.items?.length) { reply({ ok: false, code: 'NOTHING_TO_RESTORE' }); return; }
    const epochAtStart = startEpochRef.current;
    (async () => {
      if (!(await ensurePlaybackOwner(`restore-${reason}`))) return { ok: false, code: 'PLAYBACK_OWNER_UNAVAILABLE' };
      // Re-checked immediately before adopting: nothing may have started here
      // since the restore began, and a power restore never replaces an item
      // the owner already holds.
      const held = (sessionSource?.getBareSnapshot?.() ?? sessionSource?.getSnapshot?.())?.currentItem;
      if (startEpochRef.current !== epochAtStart || (reason === 'power-restore' && held)) {
        return { ok: false, code: 'RESTORE_SUPERSEDED' };
      }
      const next = structuredClone(snapshot);
      next.meta = { ...next.meta };
      delete next.meta.playbackOwner;
      delete next.meta.queueOwner;
      delete next.controls;
      next.queue.items = next.queue.items.map(item => ({ ...item, format: item.format ?? 'video' }));
      if (next.currentItem) next.currentItem.format ??= next.queue.items[next.queue.currentIndex]?.format ?? 'video';
      const result = sessionSource?.adopt?.(next, { operationId: `restore-${requestId ?? Date.now()}`, autoplay: !!autoplay })
        ?? { ok: false, code: 'UNSUPPORTED' };
      return result?.ok === false ? { ok: false, code: result.code ?? 'RESTORE_FAILED' } : { ok: true };
    })().then((result) => {
      logger()[result.ok ? 'info' : 'warn']('media.restore-snapshot', {
        reason, autoplay: !!autoplay, contentId: snapshot.currentItem?.contentId ?? null, position: snapshot.position ?? null, ...result,
      });
      reply(result);
    }, (error) => {
      logger().warn('media.restore-snapshot', { reason, ok: false, error: error?.message });
      reply({ ok: false, code: 'RESTORE_FAILED' });
    });
  }, [ensurePlaybackOwner, sessionSource]);

  // --- Queue ops (envelope command=queue) ---
  // Both play-now and play-next share the same active-vs-idle routing.
  // Active player → dispatch to the single registered owner; the running Player
  // handles an in-place swap (play-now) or on-deck push (play-next), preserving
  // queue state.
  // Idle player → mount a fresh Player overlay.
  const handleMediaQueueOp = useCallback((payload) => {
    const op = payload?.op;

    if (op === 'item-action' || op === 'undo') {
      const execute = async () => {
        if (op === 'undo') return itemActions.undo(payload.operationId);
        if (!(await ensurePlaybackOwner('item-action-owner-bootstrap'))) {
          return { ok: false, code: 'ITEM_ACTION_UNSUPPORTED', reason: 'The screen playback owner did not become ready.' };
        }
        if (sessionSource?.ownerId) {
          const claimed = await DaylightAPI(`api/v1/device/${encodeURIComponent(sessionSource.ownerId)}/session/item-action/${encodeURIComponent(payload.operationId)}/claim`, {}, 'POST');
          if (claimed?.ok === false) return claimed;
        }
        return itemActions.execute(payload);
      };
      execute().then(result => {
        if (result?.ok) getActionBus().emit('media:queue-op-applied', { ...payload, ...result });
        else getActionBus().emit('command-handler-error', { commandId: payload.commandId, code: result?.code, error: result?.reason ?? result?.code ?? 'Item action failed' });
      }).catch(error => getActionBus().emit('command-handler-error', { commandId: payload.commandId, error: error.message }));
      return;
    }

    // A remote queue reorder ({from,to} or {items}) goes through the same item-action owner as
    // remove/clear, so it is one undoable queue operation and the ack waits for the new order.
    if (op === 'reorder') {
      // No item-action claim here: a reorder is idempotent by operationId on this screen's own ledger and has no second owner to race.
      const operationId = payload.operationId ?? `reorder-${payload.commandId ?? Date.now()}`;
      (async () => {
        if (!(await ensurePlaybackOwner('reorder-owner-bootstrap'))) {
          return { ok: false, code: 'QUEUE_OWNER_UNAVAILABLE', reason: 'The screen playback owner did not become ready.' };
        }
        return itemActions.execute({ kind: 'reorder', from: payload.from, to: payload.to, items: payload.items, collectionItems: [], operationId, tappedAt: Date.now() });
      })().then((result) => {
        if (result?.ok) {
          logger().info('media.queue-op.reordered', { operationId, from: payload.from ?? null, count: payload.items?.length ?? null });
          getActionBus().emit('media:queue-op-applied', { ...payload, ...result });
        } else {
          logger().warn('media.queue-op.reorder-failed', { operationId, code: result?.code });
          getActionBus().emit('command-handler-error', { commandId: payload.commandId, code: result?.code, error: result?.reason ?? result?.code ?? 'Reorder failed' });
        }
      }).catch((error) => getActionBus().emit('command-handler-error', { commandId: payload.commandId, error: error.message }));
      return;
    }

    if (op === 'play-now' || op === 'play-next' || op === 'add') {
      const resultCallbacks = op === 'add' ? {
        onApplied: (result) => getActionBus().emit('media:queue-op-applied', {
          ...payload, ...result,
        }),
        onError: (failure) => getActionBus().emit('command-handler-error', {
          commandId: payload?.commandId,
          ...failure,
        }),
      } : {};
      if (getPlayerQueueOpRegistry().dispatch({ op, ...payload, ...resultCallbacks })) {
        logger().info('media.queue-op.dispatched', { op, contentId: payload.contentId });
        return;
      }
      if (op === 'add') {
        getActionBus().emit('command-handler-error', {
          commandId: payload?.commandId,
          code: 'QUEUE_OWNER_UNAVAILABLE',
          error: 'No queue owner is available to hold this item',
        });
        return;
      }
      // A media element with no registered owner is a short mount/unmount race
      // or a broken integration. Starting a new Player here would recreate the
      // exact overlapping-audio failure this arbitration exists to prevent.
      const unownedPlayerActive = !!document.querySelector(
        '.audio-player, .video-player audio, .video-player video, dash-video'
      );
      if (unownedPlayerActive) {
        logger().warn('media.queue-op.owner-missing', { op, contentId: payload.contentId });
        return;
      }
      if (isMediaDuplicate(payload.contentId)) return;
      dismissOverlay();
      showOverlay(Player, {
        queue: { contentId: payload.contentId, ...payload },
        clear: () => dismissOverlay(),
      }, { chrome: 'media', suspendsNavStack: true });
      return;
    }

    logger().debug('media.queue-op.unhandled', { op, contentId: payload?.contentId });
  }, [showOverlay, dismissOverlay, isMediaDuplicate, itemActions, sessionSource, ensurePlaybackOwner]);

  // --- Remote shuffle / repeat / volume (`config` command -> media:config-set) ---
  // Only the playback-config settings are handled here; shader and the session-control settings
  // (addOnly, endOfQueue, stopAfterCurrent) have their own paths and are ignored.
  const handleMediaConfigSet = useCallback((payload = {}) => {
    const { setting, value, commandId } = payload;
    if (!['shuffle', 'repeat', 'volume'].includes(setting)) return;
    const fail = (code, error) => getActionBus().emit('command-handler-error', { commandId, code, error });
    if (setting === 'shuffle' && typeof value !== 'boolean') return fail('INVALID_VALUE', 'shuffle requires a boolean');
    if (setting === 'repeat' && !['off', 'one', 'all'].includes(value)) return fail('INVALID_VALUE', 'repeat requires off|one|all');
    if (setting === 'volume' && !Number.isFinite(Number(value))) return fail('INVALID_VALUE', 'volume requires a number');
    const dispatched = getPlayerQueueOpRegistry().dispatch({ op: 'set-config', setting, value, commandId });
    logger().info('media.config-set.dispatched', { setting, value, dispatched });
    if (!dispatched) fail('QUEUE_OWNER_UNAVAILABLE', 'No player is available to apply this setting');
    else getActionBus().emit('media:session-control-applied', { commandId });
  }, []);

  // --- Media playback controls ---
  const handleMediaSeek = useCallback((op, payload) => {
    if (!Number.isFinite(payload?.value)) {
      getActionBus().emit('command-handler-error', {
        commandId: payload?.commandId,
        code: 'INVALID_SEEK_VALUE',
        error: 'Seek value must be finite',
      });
      return;
    }
    if (!getPlayerQueueOpRegistry().dispatch({ op, value: payload.value, commandId: payload?.commandId })) {
      getActionBus().emit('command-handler-error', {
        commandId: payload?.commandId,
        code: 'PLAYBACK_OWNER_UNAVAILABLE',
        error: 'No playback owner is available to seek',
      });
    }
  }, []);

  const handleMediaGoLive = useCallback((payload) => {
    if (!getPlayerQueueOpRegistry().dispatch({ op: 'go-live', commandId: payload?.commandId })) {
      getActionBus().emit('command-handler-error', {
        commandId: payload?.commandId,
        code: 'PLAYBACK_OWNER_UNAVAILABLE',
        error: 'No playback owner is available to go live',
      });
    }
  }, []);

  const handleMediaSeekAbs = useCallback((payload) => handleMediaSeek('seek-abs', payload), [handleMediaSeek]);
  const handleMediaSeekRel = useCallback((payload) => handleMediaSeek('seek-rel', payload), [handleMediaSeek]);

  const handleMediaPlayback = useCallback((payload) => {
    if (payload?.command?.toLowerCase() === 'stop') {
      if (!getPlayerQueueOpRegistry().dispatch({ op: 'stop', commandId: payload?.commandId })) {
        getActionBus().emit('command-handler-error', {
          commandId: payload?.commandId,
          code: 'PLAYBACK_OWNER_UNAVAILABLE',
          error: 'No playback owner is available to stop',
        });
      }
      return;
    }

    const idleMode = actions?.playback?.when_idle || 'dispatch';

    // Check if media is currently active
    const media = document.querySelector('audio:not([data-role="ambient"]), video, dash-video');
    const isActive = media && !media.paused;

    // While an ArtMode scene is mounted it owns the transport (next/prev/fwd/rew/
    // pause), so the idle secondary fallback must not hijack the buttons — even when
    // its music is paused (which would otherwise read as "not active").
    const artScene = document.querySelector('audio[data-role="artmode-music"]');

    if (!isActive && !artScene && idleMode === 'secondary' && payload.secondary) {
      logger().debug('playback.secondary-fallback', { secondary: payload.secondary.action });
      const { action, payload: secPayload } = payload.secondary;
      if (action === 'media:queue') {
        showOverlay(Player, { queue: { contentId: secPayload.contentId, ...secPayload }, clear: () => dismissOverlay() }, { chrome: 'media', suspendsNavStack: true });
      } else if (action === 'media:play') {
        showOverlay(Player, { play: { contentId: secPayload.contentId, ...secPayload }, clear: () => dismissOverlay() }, { chrome: 'media', suspendsNavStack: true });
      } else if (action === 'menu:open') {
        showOverlay(MenuStack, { rootMenu: toMenuRoot(secPayload.menuId), playerRef: navPlayerRef }, { ownsNavStack: true });
      }
      return;
    }

    // Explicit remote transport commands must use the active owner's imperative
    // lifecycle. A synthetic Enter only toggles the renderer, which can resume
    // native media after Stop while leaving the owner's published state `ready`.
    const transportOp = payload?.command?.toLowerCase();
    // A photo slideshow has no media keyboard handler: a synthetic Tab never
    // reached it, so a remote Next did nothing (RQ-PLAY-12 needs "skip a
    // photo"). Only a current IMAGE item takes this route; video/audio keep Tab.
    if (transportOp === 'skipnext') {
      const current = (sessionSource?.getBareSnapshot?.() ?? sessionSource?.getSnapshot?.())?.currentItem;
      if (current?.format === 'image'
        && getPlayerQueueOpRegistry().dispatch({ op: 'skip-next', commandId: payload?.commandId })) {
        return;
      }
    }
    if (transportOp === 'skipprev') {
      if (!getPlayerQueueOpRegistry().dispatch({ op: 'skip-prev', commandId: payload?.commandId })) {
        getActionBus().emit('command-handler-error', {
          commandId: payload?.commandId,
          code: 'PLAYBACK_OWNER_UNAVAILABLE',
          error: 'No playback owner is available to select the previous queue item',
        });
      }
      return;
    }
    if ((transportOp === 'play' || transportOp === 'pause' || transportOp === 'toggle')
      && getPlayerQueueOpRegistry().dispatch({ op: transportOp, commandId: payload?.commandId })) {
      return;
    }

    // Default: dispatch synthetic keydown
    // Keyed on the LOWERCASED command, so every spelling a caller might send
    // has to appear in lower case here. `skipNext`/`skipPrev` are the transport
    // vocabulary the WebSocket command envelope actually uses
    // (shared/contracts/media/commands.mjs, via useScreenCommands'
    // `media:playback` emit) — they were missing, so every remote skip landed on
    // `playback.unknown-command` and did nothing at all. The numpad's own next
    // reaches the same Tab keydown, and now so does a WS skipNext.
    const keyMapping = {
      play: 'Enter', pause: 'Enter', toggle: 'Enter',
      next: 'Tab', skip: 'Tab', skipnext: 'Tab',
      prev: 'Backspace', previous: 'Backspace', back: 'Backspace',
      fwd: 'ArrowRight', forward: 'ArrowRight', ff: 'ArrowRight',
      rew: 'ArrowLeft', rewind: 'ArrowLeft', rw: 'ArrowLeft',
      clear: 'Escape',
    };
    const key = keyMapping[payload.command?.toLowerCase()];
    if (!key) {
      logger().warn('playback.unknown-command', { command: payload.command });
      return;
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
  }, [actions, showOverlay, dismissOverlay, sessionSource]);

  // --- Playback rate ---
  // ArtMode's background music is excluded: rate is meaningless for it, and the
  // office screen repurposes the rate button to cycle ArtMode's view mode instead.
  const handleMediaRate = useCallback(() => {
    dispatchCyclePlaybackRate();
  }, []);

  // --- Volume (software master, applied as a multiplier on every audio source
  //     rendered inside the screen-framework — see lib/volume/ScreenVolumeContext.js) ---
  const handleVolume = useCallback((payload) => {
    const cmd = payload?.command;
    const stepSize = volumeStepSize ?? 0.1;
    if (cmd === '+1') {
      stepVolume(+stepSize);
    } else if (cmd === '-1') {
      stepVolume(-stepSize);
    } else if (cmd === 'mute_toggle') {
      toggleVolumeMute();
    } else {
      logger().warn('volume.unknown-command', { command: cmd });
    }
  }, [stepVolume, toggleVolumeMute, volumeStepSize]);

  // --- Shader (dimming) ---
  const handleShader = useCallback(() => {
    const el = getShader();
    const levels = [0, 0.25, 0.5, 0.75, 0.9];
    const current = parseFloat(el.style.opacity) || 0;
    const idx = levels.findIndex(l => Math.abs(l - current) < 0.01);
    const nextIdx = (idx + 1) % levels.length;
    el.style.opacity = String(levels[nextIdx]);
  }, [getShader]);

  // --- Sleep (full blackout toggle) ---
  const handleSleep = useCallback(() => {
    const el = getShader();
    const current = parseFloat(el.style.opacity) || 0;
    const wakeMode = actions?.sleep?.wake || 'click';

    if (current >= 0.99) {
      // Wake up — restore previous opacity
      el.style.opacity = String(prevShaderOpacity.current ?? 0);
      el.style.pointerEvents = 'none';
      prevShaderOpacity.current = null;
    } else {
      // Sleep — save current and go full black
      prevShaderOpacity.current = current;
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      logger().debug('sleep.enter', { wakeMode });

      const wake = (e) => {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        el.style.opacity = String(prevShaderOpacity.current ?? 0);
        el.style.pointerEvents = 'none';
        prevShaderOpacity.current = null;
        logger().debug('sleep.wake', { wakeMode });
        if (wakeMode === 'click' || wakeMode === 'both') {
          el.removeEventListener('click', wake);
        }
        if (wakeMode === 'keydown' || wakeMode === 'both') {
          window.removeEventListener('keydown', wake, true);
        }
      };

      if (wakeMode === 'click' || wakeMode === 'both') {
        el.addEventListener('click', wake);
      }
      if (wakeMode === 'keydown' || wakeMode === 'both') {
        window.addEventListener('keydown', wake, true);
      }
    }
  }, [getShader, actions]);

  // --- Escape ---
  const handleEscape = useCallback(() => {
    // First priority: let any registered interceptor handle escape
    // (e.g., MenuStack pops its navigation stack before the framework acts)
    if (escapeInterceptorRef?.current) {
      const handled = escapeInterceptorRef.current();
      if (handled) {
        logger().debug('escape.intercepted', {});
        return;
      }
    }

    // Second priority: dismiss PIP if visible
    if (pip.hasPip) {
      logger().debug('escape.pip-dismiss', {});
      pip.dismiss();
      return;
    }

    const shaderActive = shaderRef.current && parseFloat(shaderRef.current.style.opacity) > 0;

    // Configurable fallback chain from YAML actions.escape
    if (Array.isArray(actions.escape)) {
      for (const step of actions.escape) {
        if (step.when === 'shader_active' && shaderActive) {
          logger().debug('escape.chain', { matched: step.when, action: step.do });
          if (step.do === 'clear_shader') {
            shaderRef.current.style.opacity = '0';
            shaderRef.current.style.pointerEvents = 'none';
            prevShaderOpacity.current = null;
          }
          return;
        }
        if (step.when === 'overlay_active' && hasOverlay) {
          logger().debug('escape.chain', { matched: step.when, action: step.do });
          if (step.do === 'dismiss_overlay') {
            currentMenuRef.current = null;
            dismissOverlay();
          }
          return;
        }
        if (step.when === 'idle') {
          logger().debug('escape.chain', { matched: step.when, action: step.do });
          if (step.do === 'reload') {
            window.location.reload();
          }
          return;
        }
      }
      return;
    }

    // Default behavior (no actions.escape configured)
    if (shaderActive) {
      logger().debug('escape.default', { hadShader: true, dismissed: true });
      shaderRef.current.style.opacity = '0';
      shaderRef.current.style.pointerEvents = 'none';
      prevShaderOpacity.current = null;
      return;
    }
    logger().debug('escape.default', { hadShader: false, dismissed: hasOverlay });
    currentMenuRef.current = null;
    dismissOverlay();
  }, [escapeInterceptorRef, pip, actions.escape, hasOverlay, dismissOverlay]);

  // --- Hardware Back (popstate) consumer ---
  // Mirror live overlay/pip state into refs so the consumer (invoked at
  // back-press time) reads fresh values without re-registering each render.
  const hasOverlayRef = useRef(hasOverlay);
  hasOverlayRef.current = hasOverlay;
  const pipRef = useRef(pip);
  pipRef.current = pip;

  const consumeBack = useCallback(() => {
    // An overlay that manages its own back navigation (MenuStack popping levels,
    // Piano blocking escapes) registers an escape interceptor — defer to the
    // normal menu pop for those. Otherwise a "dumb" fullscreen scene (e.g. a
    // triggered ArtMode slideshow) is on top: dismiss it and report consumed so
    // the hidden menu stack beneath isn't popped instead.
    if (escapeInterceptorRef?.current) return false;
    if (pipRef.current?.hasPip) {
      logger().debug('back.pip-dismiss', {});
      pipRef.current.dismiss();
      return true;
    }
    if (hasOverlayRef.current) {
      logger().debug('back.overlay-dismiss', {});
      currentMenuRef.current = null;
      dismissOverlay();
      return true;
    }
    return false;
  }, [dismissOverlay, escapeInterceptorRef]);

  // --- Overlay: show a registered widget by name ---
  const handleDisplayOverlay = useCallback((payload) => {
    const { overlayId } = payload || {};
    if (!overlayId) return;
    const Component = getWidgetRegistry().get(overlayId);
    if (!Component) {
      logger().warn('action.overlay.notFound', { overlayId });
      return;
    }
    logger().info('action.overlay.show', { overlayId });
    showOverlay(Component, {}, { mode: 'fullscreen' });
  }, [showOverlay]);

  // Ad-hoc ArtMode scene: a display:content art:<preset> id (from a FKB URL param
  // or a WS display command) fetches the preset props and shows ArtMode fullscreen.
  // Works on any screen, independent of the screensaver config.
  const handleDisplayContent = useCallback((payload) => {
    const id = payload?.id;
    if (!id || !String(id).startsWith('art:')) return;
    const preset = String(id).slice('art:'.length);
    DaylightAPI(`api/v1/art/preset/${encodeURIComponent(preset)}`)
      .then((props) => {
        if (!props) return;
        const Component = getWidgetRegistry().get('art');
        if (!Component) { logger().warn('action.scene.widget-not-found'); return; }
        // Raw-key handling default depends on the screen's input device. Macro-keypad
        // (numpad) screens emit semantic ActionBus actions PLUS spurious companion nav
        // keys, so raw keys would double-trigger view-mode/shuffle there → default off.
        // Plain remotes (e.g. the living-room Shield) have no companion-key hazard and
        // an empty/partial keymap, so raw keys give the full interactive surface
        // (brightness, view-cycle, OK-exit) exactly like the idle screensaver → default
        // on. A preset may override either way with an explicit rawKeys.
        const rawKeysDefault = inputType === 'remote';
        showOverlay(
          Component,
          { rawKeys: rawKeysDefault, ...props, onExit: () => dismissOverlay('fullscreen') },
          { mode: 'fullscreen', priority: 'high' },
        );
        logger().info('action.scene.show', { preset, rawKeys: props?.rawKeys ?? rawKeysDefault });
      })
      .catch((err) => logger().warn('artmode.scene.unknown', { preset, error: err?.message }));
  }, [showOverlay, dismissOverlay, inputType]);

  // --- PIP doorbell (simulate doorbell event via webhook) ---
  const handlePipDoorbell = useCallback(() => {
    logger().info('pip.action.doorbell');
    DaylightAPI('api/v1/camera/doorbell/event', { event: 'ring' }).catch((err) => {
      logger().warn('pip.doorbell.error', { error: err.message });
    });
  }, []);

  // --- PIP promote ---
  const handlePipPromote = useCallback(() => {
    if (pip.state !== 'visible') return;
    logger().info('pip.action.promote');
    pip.promote();
  }, [pip]);

  // --- PIP dismiss ---
  const handlePipDismiss = useCallback(() => {
    if (!pip.hasPip) return;
    logger().info('pip.action.dismiss');
    pip.dismiss();
  }, [pip]);

  useScreenAction('display:overlay', handleDisplayOverlay);
  useScreenAction('display:content', handleDisplayContent);
  useScreenAction('pip:doorbell', handlePipDoorbell);
  useScreenAction('pip:promote', handlePipPromote);
  useScreenAction('pip:dismiss', handlePipDismiss);
  useScreenAction('menu:open', handleMenuOpen);
  useScreenAction('media:play', handleMediaPlay);
  useScreenAction('media:queue', handleMediaQueue);
  useScreenAction('media:queue-op', handleMediaQueueOp);
  useScreenAction('media:config-set', handleMediaConfigSet);
  useScreenAction('media:restore-snapshot', handleRestoreSnapshot);
  // §6.2.4 adopt-snapshot (a move here from another screen, PLACE.9a): the
  // command was acknowledged but never adopted. It is the restore path —
  // bootstrap an owner when idle, then adopt — playing unless told otherwise.
  // A failed adopt tells the mover at once (command-handler-error carries the
  // commandId back as the command's failure) instead of leaving the move to
  // wait out its observation window.
  const handleAdoptSnapshot = useCallback((payload = {}) => {
    startEpochRef.current += 1;
    handleRestoreSnapshot({
      snapshot: payload.snapshot, autoplay: payload.autoplay !== false, reason: 'adopt', requestId: payload.commandId,
      onResult: (result) => {
        if (!payload.commandId) return;
        if (result?.ok !== false) {
          getActionBus().emit('media:session-control-applied', { commandId: payload.commandId });
          return;
        }
        getActionBus().emit('command-handler-error', {
          commandId: payload.commandId,
          code: result.code ?? 'ADOPT_FAILED',
          error: result.code === 'PLAYBACK_OWNER_UNAVAILABLE'
            ? 'This screen could not start a player to take the move'
            : (result.code === 'RESTORE_SUPERSEDED' ? 'Something else started on this screen first' : (result.code ?? 'The move was not adopted')),
        });
      },
    });
  }, [handleRestoreSnapshot]);
  useScreenAction('media:adopt-snapshot', handleAdoptSnapshot);
  useScreenAction('media:seek-abs', handleMediaSeekAbs);
  useScreenAction('media:seek-rel', handleMediaSeekRel);
  useScreenAction('media:go-live', handleMediaGoLive);
  useScreenAction('media:playback', handleMediaPlayback);
  useScreenAction('media:rate', handleMediaRate);
  useScreenAction('display:volume', handleVolume);
  useScreenAction('display:shader', handleShader);
  useScreenAction('display:sleep', handleSleep);
  useScreenAction('escape', handleEscape);

  // Renderless, except for the Back-button bridge when a menu nav context exists.
  return hasMenuNav ? <MenuBackConsumerBridge consumer={consumeBack} /> : null;
}
