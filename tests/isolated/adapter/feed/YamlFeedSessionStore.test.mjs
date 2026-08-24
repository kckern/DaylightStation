import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { YamlFeedSessionStore } from '#adapters/persistence/yaml/YamlFeedSessionStore.mjs';

describe('YamlFeedSessionStore', () => {
  let root;

  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  test('prunes expired session files and persists current snapshots', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-sessions-'));
    const values = new Map();
    const sessionsDir = path.join(root, 'alice', 'feed/sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const expired = path.join(sessionsDir, 'expired.yml');
    fs.writeFileSync(expired, 'version: 1\n');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(expired, old, old);
    const dataService = { user: {
      resolveDir: (key, username) => path.join(root, username, key),
      read: (key, username) => values.get(`${username}:${key}`) || null,
      write: (key, value, username) => { values.set(`${username}:${key}`, structuredClone(value)); return true; },
    } };
    const store = new YamlFeedSessionStore({ dataService });
    store.save('alice', 'active', { seenItems: [{ id: 'one' }] });
    expect(fs.existsSync(expired)).toBe(false);
    expect(store.load('alice', 'active')).toMatchObject({ version: 1, snapshot: { seenItems: [{ id: 'one' }] } });
  });
});
