import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { isContentActive } from '../screenActivity.js';
import { useScreenPresencePublisher } from './useScreenPresencePublisher.js';

/**
 * Renderless: computes content-presence from the nav stack + overlay state and
 * publishes it for the backend ScreenPresenceService (drives office_tv_active).
 * Must be mounted inside MenuNavigationProvider + ScreenOverlayProvider.
 */
export function ScreenPresencePublisher({ deviceId }) {
  const { currentContent } = useMenuNavigationContext();
  const { hasOverlay } = useScreenOverlay();
  const active = isContentActive(currentContent, hasOverlay);
  useScreenPresencePublisher({ deviceId, active });
  return null;
}

export default ScreenPresencePublisher;
