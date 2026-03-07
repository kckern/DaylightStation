import { useCallback, useRef } from 'react';
import { useScreenAction } from '../input/useScreenAction.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import MenuStack from '../../modules/Menu/MenuStack.jsx';
import Player from '../../modules/Player/Player.jsx';

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
export function ScreenActionHandler() {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
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
  const handleMenuOpen = useCallback((payload) => {
    showOverlay(MenuStack, { rootMenu: payload.menuId });
  }, [showOverlay]);

  // --- Media play/queue ---
  const handleMediaPlay = useCallback((payload) => {
    showOverlay(Player, {
      play: payload.contentId,
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);

  const handleMediaQueue = useCallback((payload) => {
    showOverlay(Player, {
      queue: [payload.contentId],
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay]);

  // --- Media playback controls ---
  const handleMediaPlayback = useCallback((payload) => {
    const keyMapping = {
      play: 'Enter', pause: 'Enter', toggle: 'Enter',
      next: 'Tab', skip: 'Tab',
      prev: 'Backspace', previous: 'Backspace', back: 'Backspace',
      fwd: 'ArrowRight', forward: 'ArrowRight', ff: 'ArrowRight',
      rew: 'ArrowLeft', rewind: 'ArrowLeft', rw: 'ArrowLeft',
      stop: 'Escape', clear: 'Escape',
    };
    const key = keyMapping[payload.command?.toLowerCase()];
    if (key) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
    }
  }, []);

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
    DaylightAPI(endpoint).catch(() => {});
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
      // Wake on any click on the shader
      const wake = () => {
        el.style.opacity = String(prevShaderOpacity.current ?? 0);
        el.style.pointerEvents = 'none';
        prevShaderOpacity.current = null;
        el.removeEventListener('click', wake);
      };
      el.addEventListener('click', wake);
    }
  }, [getShader]);

  // --- Escape ---
  const handleEscape = useCallback(() => {
    // If shader is active, clear it first
    const el = shaderRef.current;
    if (el && parseFloat(el.style.opacity) > 0) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      prevShaderOpacity.current = null;
      return;
    }
    dismissOverlay();
  }, [dismissOverlay]);

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
