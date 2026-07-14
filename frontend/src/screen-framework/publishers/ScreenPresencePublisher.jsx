import { useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { useScreenScene } from '../providers/ScreenSceneContext.jsx';
import { isContentActive } from '../screenActivity.js';
import { useScreenPresencePublisher } from './useScreenPresencePublisher.js';
import { useRegistryPlaybackState } from './useRegistryPlaybackState.js';

/**
 * Renderless: computes content-presence from the nav stack + overlay state and
 * publishes it for the backend ScreenPresenceService (drives office_tv_active)
 * and ScreenContentTracker. `playing` excludes ArtMode scenes (screensaver /
 * ambient presets), which are passive even though they own a fullscreen overlay.
 * When a legacy Player is registered in the playerSessionRegistry, its live
 * state is authoritative for `playing` (a paused player is not playing); when
 * nothing is registered (apps, readalong, etc.) the activity heuristic stands.
 * Must be mounted inside MenuNavigationProvider + ScreenOverlayProvider + ScreenSceneProvider.
 */
export function ScreenPresencePublisher({ deviceId }) {
  const { currentContent } = useMenuNavigationContext();
  const { hasOverlay } = useScreenOverlay();
  const { artSceneActive } = useScreenScene();
  const { registered, playing: registryPlaying } = useRegistryPlaybackState();
  const active = isContentActive(currentContent, hasOverlay);
  const playing = active && !artSceneActive && (registered ? registryPlaying : true);
  useScreenPresencePublisher({ deviceId, active, playing });
  return null;
}

export default ScreenPresencePublisher;
