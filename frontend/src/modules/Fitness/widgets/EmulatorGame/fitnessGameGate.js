import { createOpenGate } from '../../../Emulator/adapters/GovernanceGate.js';

/**
 * Build the EmulatorConsole governanceGate for a fitness-hosted game.
 *
 * Governance is disabled: games are always playable regardless of the game's
 * `governance` config (no credit gating, no zone requirement). Returns the open
 * gate { mode, isPlayable, getStatus, onChange } plus a no-op `tick(dtSec)` so
 * the host's interval caller stays harmless.
 */
export function buildFitnessGameGate() {
  const open = createOpenGate();
  return { ...open, tick: () => {} };
}

export default { buildFitnessGameGate };
