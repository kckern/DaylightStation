import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { YamlFeedItemStateStore } from '#adapters/persistence/yaml/YamlFeedItemStateStore.mjs';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

function createDataService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-state-store-'));
  roots.push(root);
  const resolvePath = (relative, username) => path.join(root, username, `${relative}.yml`);
  return {
    root,
    dataService: {
      user: {
        resolvePath,
        read(relative, username) {
          const file = resolvePath(relative, username);
          return fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) : null;
        },
        write(relative, value, username) {
          const file = resolvePath(relative, username);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, yaml.dump(value));
          return true;
        },
      },
    },
  };
}

describe('YamlFeedItemStateStore', () => {
  it('serializes updates and atomically replaces the state document', async () => {
    const { dataService } = createDataService();
    const store = new YamlFeedItemStateStore({ dataService, logger: { debug: vi.fn() } });
    await Promise.all([
      store.update('alex', async (state) => ({ ...state, items: { first: { isRead: true } } })),
      store.update('alex', async (state) => ({ ...state, aliases: { alternate: 'first' } })),
    ]);
    expect(store.load('alex')).toEqual({ version: 1, items: { first: { isRead: true } }, aliases: { alternate: 'first' } });
  });
});
