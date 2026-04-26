import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';

describe('YamlNutriListDatastore date guard', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrilist-test-'));
    const userDataService = {
      getUserPath: jest.fn().mockImplementation((userId, subpath) => {
        return path.join(tmpDir, 'users', userId, subpath);
      }),
    };
    store = new YamlNutriListDatastore({
      userDataService,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when any item has no date field', async () => {
    const items = [
      { userId: 'u1', item: 'Peas', date: '2026-04-16', calories: 50 },
      { userId: 'u1', item: 'Banana', calories: 90 }, // missing date
    ];
    await expect(store.saveMany(items)).rejects.toThrow(/missing date/i);
  });

  it('throws when any item has a malformed date', async () => {
    const items = [
      { userId: 'u1', item: 'Peas', date: '2026/04/16', calories: 50 },
    ];
    await expect(store.saveMany(items)).rejects.toThrow(/malformed date/i);
  });

  it('succeeds when all items have valid YYYY-MM-DD dates', async () => {
    const items = [
      { userId: 'u1', item: 'Peas', date: '2026-04-16', calories: 50 },
      { userId: 'u1', item: 'Banana', date: '2026-04-17', calories: 90 },
    ];
    await expect(store.saveMany(items)).resolves.not.toThrow();
  });
});
