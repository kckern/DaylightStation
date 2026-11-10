import { DataServicePianoRungLogStore } from "../adapters/persistence/DataServicePianoRungLogStore.mjs";
import { PianoRungLog } from "../application/game-platform/PianoRungLog.mjs";

/**
 * The dated rung-promotion log (`users/{id}/apps/piano/rung-log.yml`). Create
 * ONE per process and hand it to every ladder writer — the piano-games module
 * (checkers, connect-four, and both addressing ladders through it) and the
 * native chess runtime (chess match + chess addressing).
 */
export function createPianoRungLog({ dataService, logger = null }) {
  return new PianoRungLog({
    store: new DataServicePianoRungLogStore({ dataService }),
    logger: logger?.child?.({ component: 'piano-rung-log' }) ?? logger,
  });
}

export default createPianoRungLog;
