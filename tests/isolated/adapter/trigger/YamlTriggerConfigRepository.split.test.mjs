import { describe, it, expect } from 'vitest';
import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';

function harness(files = {}) {
  const disk = {
    'config/triggers/sources': { livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next' } },
    'config/triggers/bindings/nfc': {},
    'config/triggers/responses': {},
    'config/triggers/endpoints': {},
    'history/triggers/nfc.observed': {},
    ...files,
  };
  const loadFile = (p) => disk[p];
  const saveFile = (p, d) => { disk[p] = d; };
  const observedStore = new YamlObservedStateStore({ loadFile, saveFile });
  observedStore.load();
  const repo = new YamlTriggerConfigRepository({ saveFile, observedStore });
  repo.loadRegistry({ loadFile });
  return { repo, disk };
}

describe('YamlTriggerConfigRepository split writes', () => {
  it('recordObserved writes to history, never to bindings', async () => {
    const { repo, disk } = harness();
    const r = await repo.recordObserved('aa', '2026-07-11 10:00:00');
    expect(r.created).toBe(true);
    expect(disk['history/triggers/nfc.observed'].aa.count).toBe(1);
    expect(disk['config/triggers/bindings/nfc'].aa).toBeUndefined();
  });

  it('setNfcNote writes note to bindings (config) and timestamp to history', async () => {
    const { repo, disk } = harness();
    const r = await repo.setNfcNote('bb', 'Pinocchio', '2026-07-11 10:00:00');
    expect(r.created).toBe(true);
    expect(disk['config/triggers/bindings/nfc'].bb.note).toBe('Pinocchio');
    expect(disk['config/triggers/bindings/nfc'].bb.scanned_at).toBeUndefined();
    expect(disk['history/triggers/nfc.observed'].bb.last_seen).toBe('2026-07-11 10:00:00');
  });
});
