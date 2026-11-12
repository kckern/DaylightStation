import { useCallback, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { listUsableSkylineBikes } from '../../lib/skylineGlider/bikeSelection.js';

/** The boost partner: the first usable (ridden, connected) bike whose rider is not the shooter. */
export function selectPartner(equipment, session, shooterId) {
  const bike = listUsableSkylineBikes(equipment, session).find((item) => item.riderId !== shooterId);
  return bike ? { riderId: bike.riderId, equipmentId: bike.equipment.id } : null;
}

/**
 * Who the partner is and what their cadence is right now. The boost meter
 * itself is engine state; this only feeds `intents.partnerRpm`.
 *
 * The game does not re-render per frame, so the partner is not only chosen at
 * render time: `readRpm()` looks for one whenever there is none yet. Once
 * chosen, the partner stays the same bike through a sensor dropout (rpm reads
 * null meanwhile, which the engine treats as "no partner input").
 *
 * @returns {{ partner: object|null, readRpm: () => number|null, readPartner: () => object|null }}
 */
export default function useInvadersBoost({ equipment, session, shooterId } = {}) {
  const log = useMemo(() => getLogger().child({ component: 'skyline-invaders-boost' }), []);
  const live = useRef({ pinned: null });
  const state = live.current;
  if (state.pinned && (state.shooterId !== shooterId || state.pinned.riderId === shooterId)) state.pinned = null;
  Object.assign(state, { equipment, session, shooterId });

  const pin = useCallback((found, when) => {
    live.current.pinned = found;
    log.info('skyline_invaders.boost.partner', { ...found, when });
    return found;
  }, [log]);

  if (!state.pinned) {
    const found = selectPartner(equipment, session, shooterId);
    if (found) pin(found, 'render');
  }

  // Called from the frame loop: cadence is read at frame time, not render time.
  const readRpm = useCallback(() => {
    const now = live.current;
    const partner = now.pinned || (() => {
      const found = selectPartner(now.equipment, now.session, now.shooterId);
      return found ? pin(found, 'frame') : null;
    })();
    if (!partner) return null;
    const cadence = now.session?.getEquipmentCadence?.(partner.equipmentId);
    return cadence?.connected && !cadence.transportStalled ? Number(cadence.rpm) || 0 : null;
  }, [pin]);
  const readPartner = useCallback(() => live.current.pinned, []);

  return { partner: state.pinned, readRpm, readPartner };
}
