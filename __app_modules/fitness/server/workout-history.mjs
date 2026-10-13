import { YamlSessionDatastore } from './adapters/persistence/YamlSessionDatastore.mjs';

/** Read-only projection of completed household workouts for Health. */
export function createWorkoutHistoryReader({configService,logger}) {
  const store = new YamlSessionDatastore({configService,logger});
  return {findInRange: store.findInRange.bind(store)};
}
