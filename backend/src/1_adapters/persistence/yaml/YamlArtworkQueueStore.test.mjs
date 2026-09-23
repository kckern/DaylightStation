import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { YamlArtworkQueueStore } from './YamlArtworkQueueStore.mjs';

const makeStore = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artwork-queue-'));
  const store = new YamlArtworkQueueStore({ dataService: { user: { resolveDir: (rel, userId) => path.join(root, userId, rel) } } });
  return { store, root };
};

describe('YamlArtworkQueueStore', () => {
  it('starts empty, persists items per user next to the nutrition files, and bumps the version', () => {
    const { store, root } = makeStore();
    expect(store.load('kc')).toEqual({ version: 0, items: {} });
    const result = store.update('kc', state => { state.items['food:f1'] = { key: 'food:f1', attempts: 0 }; return 'ok'; });
    expect(result).toBe('ok');
    const file = path.join(root, 'kc', 'lifelog/nutrition/artwork-queue.yml');
    expect(yaml.load(fs.readFileSync(file, 'utf8'))).toEqual({ version: 1, items: { 'food:f1': { key: 'food:f1', attempts: 0 } } });
    expect(store.load('kc').items['food:f1'].attempts).toBe(0);
    expect(store.load('other').items).toEqual({});
  });

  it('refuses async changes and unsafe owners', () => {
    const { store } = makeStore();
    expect(() => store.update('kc', async () => {})).toThrow(/synchronous/);
    expect(() => store.load('../etc')).toThrow(/owner/);
  });
});
