import {
  createEphemeralPorts,
  EphemeralAuthority,
  GameRuntime,
  GameSessionCoordinator,
  SessionActorAuthorization,
} from '@shared-gaming/kernel/index.mjs';
import { stableSha256 } from '@shared-gaming/kernel/canonical.mjs';

export function createEphemeralLocalAuthority({ ruleset, definition, actorId = 'local-player', clock = { now: () => new Date() } }) {
  const hash = stableSha256(definition);
  const { snapshots, journal } = createEphemeralPorts();
  const definitions = {
    getCurrent: async () => ({ definition, hash }),
    pin: async () => ({ definition, hash }),
    getPinned: async (candidate) => candidate === hash ? definition : null,
  };
  const coordinator = new GameSessionCoordinator({
    runtime: new GameRuntime({ rulesets: [ruleset] }), snapshots, journal, definitions,
    authorization: new SessionActorAuthorization(),
    ids: {
      session: () => `ephemeral:${crypto.randomUUID()}`,
      command: () => `ephemeral:${crypto.randomUUID()}`,
      seed: () => crypto.getRandomValues(new Uint32Array(1))[0],
    },
    clock,
  });
  const authority = new EphemeralAuthority({ coordinator });
  authority.actorId = actorId;
  return authority;
}
