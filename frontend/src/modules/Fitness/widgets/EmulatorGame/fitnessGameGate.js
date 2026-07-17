import { createOpenGate } from '../../../Emulator/adapters/GovernanceGate.js';
import { createCoinMeteredGate } from './coinMeteredGate.js';

/**
 * Build the EmulatorConsole governanceGate for a fitness-hosted game.
 *
 * `economyEnabled` + a resolvable userId switch the arcade from free-play to
 * coin-metered spend. The DEFAULT stays the open gate { mode, isPlayable,
 * getStatus, onChange } plus a no-op `tick(dtSec)` — so existing installs are
 * unchanged (always playable) until economy config is turned on.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.economyEnabled=false] turn on coin metering
 * @param {() => (string|null)} [opts.getActivePlayerId] resolves the spending user
 * @param {string} [opts.action] economy action label (default in coin gate)
 * @param {object} [opts.api] injectable economy api adapter (tests/fakes)
 * @param {number} [opts.settleIntervalSec] seconds between periodic settles
 */
export function buildFitnessGameGate(opts = {}) {
  const { economyEnabled = false, getActivePlayerId, action, api, settleIntervalSec } = opts;
  const userId = economyEnabled && typeof getActivePlayerId === 'function' ? getActivePlayerId() : null;
  if (economyEnabled && userId) {
    // createCoinMeteredGate already exposes a safe `tick`, so the host's
    // interval caller stays harmless without extra wrapping.
    return createCoinMeteredGate({ userId, action, api, settleIntervalSec });
  }
  const open = createOpenGate();
  return { ...open, tick: () => {} };
}

export default { buildFitnessGameGate };
