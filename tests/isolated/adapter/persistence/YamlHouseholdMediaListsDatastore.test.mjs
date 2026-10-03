// Household favourites and removed ids live beside the household media queue
// (household[-{id}]/media/favourites.yml, removed.yml).
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { YamlHouseholdMediaListsDatastore } from '#adapters/persistence/yaml/YamlHouseholdMediaListsDatastore.mjs';

describe('YamlHouseholdMediaListsDatastore', () => {
  let dir;
  let store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'household-media-lists-'));
    const configService = { getHouseholdPath: (rel, hid) => join(dir, hid ? `household-${hid}` : 'household', rel) };
    store = new YamlHouseholdMediaListsDatastore({ configService });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('empty household reads empty lists', async () => {
    expect(await store.loadFavourites()).toEqual([]);
    expect(await store.loadRemoved()).toEqual({});
  });

  test('round-trips favourites and removed ids per household', async () => {
    const favs = [{ id: 'plex:1', kind: 'collection', title: 'Cartoons', thumbnail: null, type: 'collection', addedAt: 't' }];
    await store.saveFavourites(favs);
    await store.saveRemoved({ 'plex:2': { removedAt: 't' } });
    await store.saveFavourites([{ id: 'plex:9', kind: 'item', addedAt: 't' }], 'other');
    expect(await store.loadFavourites()).toEqual(favs);
    expect(await store.loadRemoved()).toEqual({ 'plex:2': { removedAt: 't' } });
    expect((await store.loadFavourites('other')).map((f) => f.id)).toEqual(['plex:9']);
    expect(existsSync(join(dir, 'household', 'media', 'favourites.yml'))).toBe(true);
    expect(readFileSync(join(dir, 'household', 'media', 'removed.yml'), 'utf8')).toContain('plex:2');
  });
});
