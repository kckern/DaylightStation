import { describe, it, expect } from 'vitest';
import { YamlFitnessPlayableSnapshotStore } from './YamlFitnessPlayableSnapshotStore.mjs';

function memoryConfig() {
  const files = new Map();
  return {
    files,
    configService: { getRuntimeCachePath: () => '/runtime/fitness' },
    io: {
      resolveYamlPath: (base) => files.has(`${base}.yml`) ? `${base}.yml` : null,
      loadYaml: (base) => structuredClone(files.get(`${base}.yml`)),
      saveYamlToPathAtomic: (file, value) => files.set(file, structuredClone(value)),
    },
  };
}

describe('YamlFitnessPlayableSnapshotStore', () => {
  it('round-trips regenerable course structure across process restarts', () => {
    const env = memoryConfig();
    const first = new YamlFitnessPlayableSnapshotStore(env);
    first.put('playables:plex:675689', [{ id: 'plex:1', title: 'Lesson' }], 1000);
    first.flush();

    const restarted = new YamlFitnessPlayableSnapshotStore(env);
    expect(restarted.load()).toEqual(new Map([
      ['playables:plex:675689', { value: [{ id: 'plex:1', title: 'Lesson' }], at: 1000 }],
    ]));
  });
});
