import { useEffect, useState, useCallback } from 'react';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'dance-strobe' });
  return _logger;
}

// 7 hue grades around the color wheel (grade 0 = no shift). Each beat jumps
// straight across the wheel (180°) plus half a grade (360/14 ≈ 25.7°), so a
// full bright→dim→bright round trip advances exactly one grade. 7 grades is
// odd against the 2-state bright/dim alternation, so over a 14-beat cycle
// every grade is shown in BOTH the bright and the dim state.
export const STROBE_HUE_GRADES = 7;
export const STROBE_HUE_STEP_DEG = 180 + 360 / (2 * STROBE_HUE_GRADES); // 1440/7 ≈ 205.71°
export const STROBE_DIM_OPACITY = 0.2; // dim beats stay faintly visible, never black

/**
 * Pure beat math: which hue/brightness the strobe shows at a given beat.
 * Hue is rounded to 2 decimals so float drift never leaks into CSS or
 * equality checks (beat 7 lands back on 0, not 5e-13).
 */
export function strobeFrame(beatIndex) {
  const bright = beatIndex % 2 === 0;
  const hue = Math.round(((beatIndex * STROBE_HUE_STEP_DEG) % 360) * 100) / 100;
  return { hue, bright, opacity: bright ? 1 : STROBE_DIM_OPACITY };
}

// The four video orientations: normal, mirrored, upside-down, and both.
// Applied as scale(x, y) on the video layer.
export const ORIENTATIONS = [
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 }
];

/**
 * Pick a random orientation that is guaranteed to DIFFER from the current
 * one, so every light→dark transition produces a visible flip. rng is
 * injectable for deterministic tests.
 */
export function pickOrientation(current, rng = Math.random) {
  const options = ORIENTATIONS.filter((o) => !(o.x === current.x && o.y === current.y));
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

/**
 * BPM-clocked strobe filter for the dance video layer: off by default,
 * toggled from the now-playing bar. While on, emits a style object
 * ({ filter: hue-rotate, opacity, transform }) that flips bright/dim and
 * walks the hue wheel one beat at a time (see strobeFrame). Each light→dark
 * transition also re-orients the video to a random different flip
 * permutation (pickOrientation), which the next bright beat reveals.
 * Re-enabling always restarts the cycle at hue 0, bright, unflipped.
 */
export function useDanceStrobe({ bpm = 60, rng = Math.random } = {}) {
  const [strobeOn, setStrobeOn] = useState(false);
  const [beatIndex, setBeatIndex] = useState(0);
  const [orientation, setOrientation] = useState(ORIENTATIONS[0]);

  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 60;

  useEffect(() => {
    if (!strobeOn) return undefined;
    const id = setInterval(() => setBeatIndex((i) => i + 1), 60000 / safeBpm);
    return () => clearInterval(id);
  }, [strobeOn, safeBpm]);

  // Odd beats are the dim ones (strobeFrame): entering dark picks the new
  // orientation, hidden behind the 20% dip until the next bright flash.
  useEffect(() => {
    if (!strobeOn || beatIndex % 2 === 0) return;
    setOrientation((current) => pickOrientation(current, rng));
  }, [strobeOn, beatIndex, rng]);

  const toggleStrobe = useCallback(() => {
    setBeatIndex(0);
    setOrientation(ORIENTATIONS[0]);
    setStrobeOn((prev) => {
      const next = !prev;
      logger().info('fitness.dance.strobe.toggle', { strobeOn: next, bpm: safeBpm });
      return next;
    });
  }, [safeBpm]);

  const frame = strobeFrame(beatIndex);
  const strobeStyle = strobeOn
    ? {
        filter: `hue-rotate(${frame.hue}deg)`,
        opacity: frame.opacity,
        transform: `scale(${orientation.x}, ${orientation.y})`
      }
    : null;

  return { strobeOn, toggleStrobe, strobeStyle, beatIndex };
}

export default useDanceStrobe;
