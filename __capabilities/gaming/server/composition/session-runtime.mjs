import { performance } from 'node:perf_hooks';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { JsonGamingSnapshotRepository } from '../adapters/persistence/JsonGamingSnapshotRepository.mjs';
// Shared session authority; installed product composition supplies rules and identity policy.
import { GameRuntime, GameSessionCoordinator, SessionActorAuthorization } from '../../portable/kernel/index.mjs';
import { YamlGamingSnapshotRepository } from '../adapters/persistence/YamlGamingSnapshotRepository.mjs';
import { YamlGamingSessionJournal } from '../adapters/persistence/YamlGamingSessionJournal.mjs';

export function createGamingSessionRuntime({ definitions: definitionStore, snapshotsDir, journalsDir, rulesets, createIds, clock, onOperation = null }) {
  const snapshots = new JsonGamingSnapshotRepository({ snapshotsDir, legacy: new YamlGamingSnapshotRepository({ snapshotsDir }) });
  const journal = new YamlGamingSessionJournal({ journalsDir });
  const runtime = new GameRuntime({ rulesets });
  const ids = createIds();
  const scheduler = new NodeApplicationScheduler();
  const coordinator = new GameSessionCoordinator({ runtime, snapshots, journal, definitions: definitionStore, ids, clock, authorization: new SessionActorAuthorization(), yieldControl: () => scheduler.wait(0), measureNow: () => performance.now(), onOperation });
  return { snapshots, journal, runtime, ids, coordinator };
}
