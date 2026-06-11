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

/**
 * BPM-clocked strobe filter for the dance video layer: off by default,
 * toggled from the now-playing bar. While on, emits a style object
 * ({ filter: hue-rotate, opacity }) that flips bright/dim and walks the hue
 * wheel one beat at a time (see strobeFrame). Re-enabling always restarts
 * the cycle at hue 0, bright.
 */
export function useDanceStrobe({ bpm = 60 } = {}) {
  const [strobeOn, setStrobeOn] = useState(false);
  const [beatIndex, setBeatIndex] = useState(0);

  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 60;

  useEffect(() => {
    if (!strobeOn) return undefined;
    const id = setInterval(() => setBeatIndex((i) => i + 1), 60000 / safeBpm);
    return () => clearInterval(id);
  }, [strobeOn, safeBpm]);

  const toggleStrobe = useCallback(() => {
    setBeatIndex(0);
    setStrobeOn((prev) => {
      const next = !prev;
      logger().info('fitness.dance.strobe.toggle', { strobeOn: next, bpm: safeBpm });
      return next;
    });
  }, [safeBpm]);

  const frame = strobeFrame(beatIndex);
  const strobeStyle = strobeOn
    ? { filter: `hue-rotate(${frame.hue}deg)`, opacity: frame.opacity }
    : null;

  return { strobeOn, toggleStrobe, strobeStyle, beatIndex };
}

export default useDanceStrobe;
