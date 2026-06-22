import { createCreditAccumulator, createOpenGate } from '../../../Emulator/adapters/GovernanceGate.js';

// At or above the required zone in the configured order. Unknown zone → false.
export function isInRequiredZone(zoneId, requiredZone, zonesOrder = []) {
  if (!zoneId || !requiredZone) return false;
  const cur = zonesOrder.indexOf(zoneId);
  const req = zonesOrder.indexOf(requiredZone);
  if (cur === -1 || req === -1) return false;
  return cur >= req;
}

/**
 * Build the EmulatorConsole governanceGate for a fitness-hosted game.
 *  - credit: earn playtime while the active player is in/above required_zone.
 *  - open/none: always playable.
 * Returns the gate { mode, isPlayable, getStatus, onChange } PLUS a `tick(dtSec)`
 * the host calls on an interval (credit only; no-op otherwise).
 */
export function buildFitnessGameGate({ game, zonesOrder = [], getActivePlayerId, getUserVitals }) {
  const gov = game?.governance || {};
  const mode = gov.mode || 'open';

  if (mode === 'credit') {
    const acc = createCreditAccumulator({
      earnRate: Number(gov.earn_rate) || 1,
      maxCredit: Number(gov.max_credit_seconds) || 600,
    });
    const inZoneNow = () => {
      const v = typeof getActivePlayerId === 'function' ? getUserVitals?.(getActivePlayerId()) : null;
      return isInRequiredZone(v?.zoneId, gov.required_zone, zonesOrder);
    };
    return {
      mode: 'credit',
      tick: (dtSec) => acc.tick(dtSec, inZoneNow()),
      isPlayable: () => acc.isPlayable(),
      getStatus: () => ({ state: acc.isPlayable() ? 'playing' : 'depleted', creditSeconds: acc.creditSeconds }),
      onChange: () => () => {},
    };
  }

  // open / none / unknown → never gated.
  const open = createOpenGate();
  return { ...open, tick: () => {} };
}

export default { isInRequiredZone, buildFitnessGameGate };
