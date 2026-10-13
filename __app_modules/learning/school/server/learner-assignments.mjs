import { YamlAssignmentStore } from './adapters/persistence/YamlAssignmentStore.mjs';

/** Read-only learner assignment query used by Piano pacing. */
export function createLearnerAssignmentReader({configService,logger}) {
  const store = new YamlAssignmentStore({configService,logger});
  return {get:store.get.bind(store)};
}
