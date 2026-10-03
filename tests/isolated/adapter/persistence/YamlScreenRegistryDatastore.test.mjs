// The household screen registry lives beside the household media lists
// (household[-{id}]/media/screens.yml).
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { YamlScreenRegistryDatastore } from '#adapters/persistence/yaml/YamlScreenRegistryDatastore.mjs';

describe('YamlScreenRegistryDatastore', () => {
  let dir;
  let store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screen-registry-'));
    const configService = { getHouseholdPath: (rel, hid) => join(dir, hid ? `household-${hid}` : 'household', rel) };
    store = new YamlScreenRegistryDatastore({ configService });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('an empty household reads an empty registry', async () => {
    expect(await store.load()).toEqual({ screens: {}, aliases: {} });
  });

  test('round-trips screens and aliases per household', async () => {
    const state = {
      screens: { 'browser:abc': { name: 'Kitchen tablet', room: 'Kitchen', firstSeen: 't0', lastSeen: 't1', renames: [{ from: 'A', to: 'Kitchen tablet', at: 't1' }], retiredAt: null, source: 'seen' } },
      aliases: { 'browser:dup': { into: 'browser:abc', mergedAt: 't2' } },
    };
    await store.save(state);
    await store.save({ screens: { 'screen:x': { name: 'X' } }, aliases: {} }, 'other');
    expect(await store.load()).toEqual(state);
    expect(Object.keys((await store.load('other')).screens)).toEqual(['screen:x']);
    expect(readFileSync(join(dir, 'household', 'media', 'screens.yml'), 'utf8')).toContain('Kitchen tablet');
  });

  test('a malformed file reads as empty rather than throwing', async () => {
    await store.save({ screens: [], aliases: 'nope' });
    expect(await store.load()).toEqual({ screens: {}, aliases: {} });
  });
});
