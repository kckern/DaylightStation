// flingStart.js — where a fling (local → screen, shell/FlingButton.jsx) starts.
// The screen starts from the beginning by default. Once local playback is
// past FLING_CHOICE_FRACTION of the item, the fling also offers "Start where
// I am"; the beginning stays the default and first choice. Live playback and
// items without a known duration never offer the choice.

export const FLING_CHOICE_FRACTION = 0.1;

/** @returns {{ offerChoice: boolean, position: number }} */
export function flingStartChoice({ position, duration, isLive = false } = {}) {
  const at = Number.isFinite(position) && position > 0 ? position : 0;
  const offerChoice = !isLive && Number.isFinite(duration) && duration > 0
    && at >= duration * FLING_CHOICE_FRACTION;
  return { offerChoice, position: at };
}

/** Seconds the screen starts at for a start mode ('beginning' | 'current'). */
export function flingStartAt(startMode, position) {
  if (startMode !== 'current') return 0;
  return Number.isFinite(position) && position > 0 ? position : 0;
}
