import { useCallback, useRef } from 'react';
import { useScreenAction } from '../input/useScreenAction.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import MenuStack from '../../modules/Menu/MenuStack.jsx';
import Player from '../../modules/Player/Player.jsx';
import getLogger from '../../lib/logging/Logger.js';

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
 *   media:playback  - Play/pause, prev, next, fwd, rew on active media
 *   media:rate      - Cycle playback speed (1x → 1.5x → 2x)
 *   display:volume  - Volume up/down/mute via API
 *   display:shader  - Cycle screen dimming overlay
 *   display:sleep   - Full blackout toggle with wake-on-keypress
 *   escape          - Dismisses the current fullscreen overlay
 *
 * This is a renderless component (returns null).
 */
export function ScreenActionHandler({ actions = {} }) {
  const { showOverlay, dismissOverlay, hasOverlay, escapeInterceptorRef } = useScreenOverlay();
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
    const duplicateMode = actions?.menu?.duplicate;
    if (duplicateMode && currentMenuRef.current === payload.menuId) {
      if (duplicateMode === 'navigate') {
        // Dispatch synthetic ArrowRight so Menu.jsx advances to the next item sequentially
        // (ArrowDown skips by column count in grid layouts; ArrowRight always moves +1)
        logger().debug('menu.duplicate-navigate', { menuId: payload.menuId });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      } else {
        logger().debug('menu.duplicate-ignored', { menuId: payload.menuId });
      }
      return;
    }
    currentMenuRef.current = payload.menuId;
    const menuTimeout = actions?.menu?.timeout ?? 0;
    showOverlay(MenuStack, { rootMenu: payload.menuId, MENU_TIMEOUT: menuTimeout });
  }, [showOverlay, actions]);

  // --- Media play/queue ---
  const handleMediaPlay = useCallback((payload) => {
    dismissOverlay(); // clear any stale player overlay first
    showOverlay(Player, {
      play: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);

  const handleMediaQueue = useCallback((payload) => {
    dismissOverlay(); // clear any stale player overlay first
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);

  // --- Media playback controls ---
  const handleMediaPlayback = useCallback((payload) => {
    const idleMode = actions?.playback?.when_idle || 'dispatch';

    // Check if media is currently active
    const media = document.querySelector('audio, video, dash-video');
    const isActive = media && !media.paused;

    if (!isActive && idleMode === 'secondary' && payload.secondary) {
      logger().debug('playback.secondary-fallback', { secondary: payload.secondary.action });
      const { action, payload: secPayload } = payload.secondary;
      if (action === 'media:queue') {
        showOverlay(Player, { queue: [secPayload.contentId], clear: () => dismissOverlay() });
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
  const handleMediaRate = useCallback(() => {
    const media = document.querySelector('audio, video, dash-video');
    if (!media) return;
    const rates = [1.0, 1.5, 2.0];
    const idx = rates.indexOf(media.playbackRate);
    media.playbackRate = rates[(idx + 1) % rates.length];
  }, []);

  // --- Volume ---
  const handleVolume = useCallback((payload) => {
    const endpoints = {
      '+1': 'api/v1/home/vol/+',
      '-1': 'api/v1/home/vol/-',
      'mute_toggle': 'api/v1/home/vol/togglemute',
    };
    const endpoint = endpoints[payload.command] || 'api/v1/home/vol/cycle';
    DaylightAPI(endpoint).catch((err) => {
      logger().warn('volume.api-error', { endpoint, error: err.message });
    });
  }, []);

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
            try {
              const url = new URL(window.location.href);
              url.searchParams.set('_cb', Date.now());
              window.location.replace(url.href);
            } catch {
              window.location.reload();
            }
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
  }, [dismissOverlay, hasOverlay, actions]);

  useScreenAction('menu:open', handleMenuOpen);
  useScreenAction('media:play', handleMediaPlay);
  useScreenAction('media:queue', handleMediaQueue);
  useScreenAction('media:playback', handleMediaPlayback);
  useScreenAction('media:rate', handleMediaRate);
  useScreenAction('display:volume', handleVolume);
  useScreenAction('display:shader', handleShader);
  useScreenAction('display:sleep', handleSleep);
  useScreenAction('escape', handleEscape);

  return null; // Renderless component
}
