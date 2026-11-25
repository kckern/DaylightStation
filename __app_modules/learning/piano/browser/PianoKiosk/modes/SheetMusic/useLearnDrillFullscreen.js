import { useBoardGameFullscreen, useHostedFullscreenToggle } from '../../PianoFullscreenContext.jsx';

/**
 * The Learn drill's hold on the tablet's full screen (two rails, 2026-11-24): while `active`, the app's top
 * bar (PianoChrome) steps aside and no full-screen toggle is drawn, so the drill's status line is the only
 * bar; it comes back when the drill closes. The kiosk's own remembered full-screen choice is untouched.
 * Inert outside the kiosk (the office screen has no PianoFullscreenProvider and no app bar).
 */
export default function useLearnDrillFullscreen(active) {
  useBoardGameFullscreen(active ? 'sheet-music-learn' : null);
  useHostedFullscreenToggle(active);
}
