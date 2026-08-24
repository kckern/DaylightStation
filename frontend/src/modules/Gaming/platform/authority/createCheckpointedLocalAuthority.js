import { CheckpointedLocalAuthority, GameRuntime, GameSessionCoordinator, SessionActorAuthorization } from '@shared-gaming/kernel/index.mjs';
import { BrowserSessionJournal, BrowserSnapshotRepository } from './BrowserCheckpointPorts.js';
import { stableSha256 } from '@shared-gaming/kernel/canonical.mjs';

export function createCheckpointedLocalAuthority({ ruleset, definition, namespace, storage = window.localStorage, actorId = 'local-player', clock = { now: () => new Date() } }) {
  const hash = stableSha256(definition);
  const snapshots = new BrowserSnapshotRepository({ storage, namespace }); const journal = new BrowserSessionJournal({ storage, namespace });
  const definitions = { getCurrent: async () => ({ definition, hash }), pin: async () => ({ definition, hash }), getPinned: async (value) => value === hash ? definition : null };
  const coordinator = new GameSessionCoordinator({ runtime: new GameRuntime({ rulesets: [ruleset] }), snapshots, journal, definitions, authorization: new SessionActorAuthorization(), ids: { session: () => `local:${crypto.randomUUID()}`, command: () => `local:${crypto.randomUUID()}`, seed: () => crypto.getRandomValues(new Uint32Array(1))[0] }, clock });
  return new CheckpointedLocalAuthority({ coordinator, actorId });
}
