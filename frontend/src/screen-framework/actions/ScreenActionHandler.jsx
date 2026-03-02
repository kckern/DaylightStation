import { useCallback } from 'react';
import { useScreenAction } from '../input/useScreenAction.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import MenuStack from '../../modules/Menu/MenuStack.jsx';
import Player from '../../modules/Player/Player.jsx';

/**
 * ScreenActionHandler - Bridges ActionBus events to the overlay system.
 *
 * Listens for specific actions emitted by input adapters (e.g., NumpadAdapter)
 * and translates them into showOverlay/dismissOverlay calls.
 *
 * Supported actions:
 *   menu:open   - Opens MenuStack as a fullscreen overlay
 *   media:play  - Opens Player with a single content item
 *   media:queue - Opens Player with a queued content item
 *   escape      - Dismisses the current fullscreen overlay
 *
 * This is a renderless component (returns null).
 */
export function ScreenActionHandler() {
  const { showOverlay, dismissOverlay } = useScreenOverlay();

  const handleMenuOpen = useCallback((payload) => {
    showOverlay(MenuStack, {
      rootMenu: payload.menuId,
    });
  }, [showOverlay]);

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

  const handleEscape = useCallback(() => {
    dismissOverlay();
  }, [dismissOverlay]);

  useScreenAction('menu:open', handleMenuOpen);
  useScreenAction('media:play', handleMediaPlay);
  useScreenAction('media:queue', handleMediaQueue);
  useScreenAction('escape', handleEscape);

  return null; // Renderless component
}
