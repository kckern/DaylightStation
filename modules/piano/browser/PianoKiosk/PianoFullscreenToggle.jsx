import Icon from '../ui/icons/Icon.jsx';
import { usePianoFullscreen } from './PianoFullscreenContext.jsx';

/**
 * The one full-screen button. Its name never changes — "Full screen", pressed or
 * not — because a toggle that renames itself announces the opposite of its state
 * to half the people reading it. The drawn icon is what changes.
 *
 * Unstyled on purpose: the header, a game rail and the floating corner each
 * dress it in their own button class, so it looks like it belongs wherever it is.
 *
 * @param {string} [className] - the host's button class
 * @param {string} [source] - where it was pressed, for the log
 */
export default function PianoFullscreenToggle({ className = '', source = 'unknown' }) {
  const { available, fullscreen, toggle } = usePianoFullscreen();
  if (!available) return null;
  return (
    <button
      type="button"
      className={`piano-fullscreen-toggle ${className}`.trim()}
      aria-label="Full screen"
      aria-pressed={fullscreen}
      onClick={() => toggle(source)}
    >
      <Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} />
    </button>
  );
}
