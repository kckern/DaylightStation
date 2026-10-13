import { entropyBytes, uuid } from '#system/utils/id.mjs';

/** Runtime identity source for gaming sessions, commands, and deterministic seeds. */
export function createGamingIdentitySource({ newUuid = uuid, newEntropy = entropyBytes } = {}) {
  return {
    session: () => `game:${newUuid()}`,
    command: () => `cmd:${newUuid()}`,
    seed: () => newEntropy(4).readUInt32LE(0),
  };
}
