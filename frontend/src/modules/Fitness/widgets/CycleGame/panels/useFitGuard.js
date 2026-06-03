import { useEffect, useMemo, useState } from 'react';
import { fitScale } from '@/modules/Fitness/lib/cycleGame/layoutSizing.js';
import getLogger from '@/lib/logging/Logger.js';

/**
 * Active overflow guard: measures the content element against its zone box and
 * returns a uniform scale (≤ 1) so the content never overflows its zone (which
 * would visually collide with a neighbouring panel). Logs `cycle_game.layout_overflow`
 * (warn) when it has to scale. Re-measures when the zone box changes. Returns 1
 * until measured / when content fits.
 */
export function useFitGuard(ref, zoneBox, panelId) {
  const [scale, setScale] = useState(1);
  const log = useMemo(() => getLogger().child({ component: 'cycle-race-layout' }), []);
  const zw = zoneBox?.width || 0;
  const zh = zoneBox?.height || 0;
  useEffect(() => {
    const el = ref.current;
    if (!el || zw <= 0 || zh <= 0) { setScale(1); return; }
    const content = { width: el.scrollWidth, height: el.scrollHeight };
    const next = fitScale(content, { width: zw, height: zh });
    setScale((prev) => (prev === next ? prev : next));
    if (next < 1) {
      log.warn('cycle_game.layout_overflow', { panelId, content, zone: { width: zw, height: zh }, scale: next });
    }
  }, [ref, zw, zh, panelId, log]);
  return scale;
}

export default useFitGuard;
