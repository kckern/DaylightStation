import { JsonGamingSnapshotRepository } from '../adapters/persistence/JsonGamingSnapshotRepository.mjs';
// Shared session authority; installed product composition supplies rules and identity policy.
import { GameRuntime, GameSessionCoordinator, SessionActorAuthorization } from '../../portable/kernel/index.mjs';
import { YamlGamingSnapshotRepository } from '../adapters/persistence/YamlGamingSnapshotRepository.mjs';
import { YamlGamingSessionJournal } from '../adapters/persistence/YamlGamingSessionJournal.mjs';

export function createGamingSessionRuntime({ definitions: definitionStore, snapshotsDir, journalsDir, rulesets, createIds, clock }) {
  const snapshots = new JsonGamingSnapshotRepository({ snapshotsDir, legacy: new YamlGamingSnapshotRepository({ snapshotsDir }) });
  const journal = new YamlGamingSessionJournal({ journalsDir });
  const runtime = new GameRuntime({ rulesets });
  const ids = createIds();
  const coordinator = new GameSessionCoordinator({ runtime, snapshots, journal, definitions: definitionStore, ids, clock, authorization: new SessionActorAuthorization() });
  return { snapshots, journal, runtime, ids, coordinator };
}
