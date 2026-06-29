import { useCallback, useEffect, useRef } from 'react';
import { useScreenAction } from '../input/useScreenAction.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { useHasMenuNavigationContext, useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { usePip } from '../pip/PipManager.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import MenuStack from '../../modules/Menu/MenuStack.jsx';
import Player from '../../modules/Player/Player.jsx';
import AppContainer from '../../modules/AppContainer/AppContainer.jsx';
import { getApp } from '../../lib/appRegistry.js';
import { getWidgetRegistry } from '../widgets/registry.js';
import { useScreenVolume } from '../../lib/volume/ScreenVolumeContext.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenActionHandler' });
  return _logger;
}

/**
 * Tell the active Player to cycle its playback rate. We dispatch an event rather
 * than mutate the media element directly: a DOM poke can't reach the <video> inside
 * the dash-video shadow DOM and is overwritten by the Player's controlled rate.
 */
export function dispatchCyclePlaybackRate() {
  window.dispatchEvent(new CustomEvent('player:cycle-playback-rate'));
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
 *   media:queue-op  - Queue ops (play-now mounts Player; others logged as unhandled)
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

export function ScreenActionHandler({ actions = {}, inputType = null }) {
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
    showOverlay(MenuStack, { rootMenu: menuId, MENU_TIMEOUT: menuTimeout }, { priority: 'high' });
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
    });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);

  const handleMediaQueue = useCallback((payload) => {
    if (isMediaDuplicate(payload.contentId)) return;
    dismissOverlay();
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);

  // --- Queue ops (envelope command=queue) ---
  // --- Queue ops (envelope command=queue) ---
  // Both play-now and play-next share the same active-vs-idle routing.
  // Active player → dispatch event; the running Player handles in-place
  // swap (play-now) or on-deck push (play-next), preserving queue state.
  // Idle player → mount a fresh Player overlay.
  const handleMediaQueueOp = useCallback((payload) => {
    const op = payload?.op;

    if (op === 'play-now' || op === 'play-next') {
      const playerActive = !!document.querySelector(
        '.audio-player, .video-player audio, .video-player video, dash-video'
      );
      if (playerActive) {
        window.dispatchEvent(new CustomEvent('player:queue-op', { detail: { op, ...payload } }));
        return;
      }
      if (isMediaDuplicate(payload.contentId)) return;
      dismissOverlay();
      showOverlay(Player, {
        queue: { contentId: payload.contentId, ...payload },
        clear: () => dismissOverlay(),
      });
      return;
    }

    logger().debug('media.queue-op.unhandled', { op, contentId: payload?.contentId });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);

  // --- Media playback controls ---
  const handleMediaPlayback = useCallback((payload) => {
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
        showOverlay(Player, { queue: { contentId: secPayload.contentId }, clear: () => dismissOverlay() });
      } else if (action === 'media:play') {
        showOverlay(Player, { play: secPayload.contentId, clear: () => dismissOverlay() });
      } else if (action === 'menu:open') {
        showOverlay(MenuStack, { rootMenu: secPayload.menuId });
      }
      return;
    }

    // Default: dispatch synthetic keydown
    const keyMapping = {
      play: 'Enter', pause: 'Enter', toggle: 'Enter',
      next: 'Tab', skip: 'Tab',
      prev: 'Backspace', previous: 'Backspace', back: 'Backspace',
      fwd: 'ArrowRight', forward: 'ArrowRight', ff: 'ArrowRight',
      rew: 'ArrowLeft', rewind: 'ArrowLeft', rw: 'ArrowLeft',
      stop: 'Escape', clear: 'Escape',
    };
    const key = keyMapping[payload.command?.toLowerCase()];
    if (!key) {
      logger().warn('playback.unknown-command', { command: payload.command });
      return;
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
  }, [actions, showOverlay, dismissOverlay]);

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
  }, [dismissOverlay, hasOverlay, actions, pip]);

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
  useScreenAction('media:playback', handleMediaPlayback);
  useScreenAction('media:rate', handleMediaRate);
  useScreenAction('display:volume', handleVolume);
  useScreenAction('display:shader', handleShader);
  useScreenAction('display:sleep', handleSleep);
  useScreenAction('escape', handleEscape);

  // Renderless, except for the Back-button bridge when a menu nav context exists.
  return hasMenuNav ? <MenuBackConsumerBridge consumer={consumeBack} /> : null;
}
