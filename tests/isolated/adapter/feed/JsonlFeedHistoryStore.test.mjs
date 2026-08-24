import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { JsonlFeedHistoryStore } from '#adapters/persistence/feed/JsonlFeedHistoryStore.mjs';

describe('JsonlFeedHistoryStore', () => {
  let root;
  let values;
  let dataService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-history-'));
    values = new Map();
    dataService = {
      user: {
        read: (key, username) => values.get(`${username}:${key}`) || null,
        write: (key, value, username) => { values.set(`${username}:${key}`, structuredClone(value)); return true; },
        resolveDir: (key, username) => path.join(root, username, key),
      },
    };
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('indexes, filters, and paginates normalized history', () => {
    const store = new JsonlFeedHistoryStore({ dataService, logger: { warn() {} } });
    store.record('alice', Array.from({ length: 40 }, (_, index) => ({
      id: `item-${index}`,
      stateKey: `state-${index}`,
      title: `Coastal storm report ${index}`,
      summary: 'Weather coverage',
      publishedAt: new Date(Date.now() - index * 60_000).toISOString(),
      origins: [index % 2 ? 'reader' : 'headlines'],
      source: 'wire',
      sourceInfo: { type: 'wire', id: 'wire', label: 'Wire Service' },
    })));
    const page = store.search('alice', { query: 'coast', mode: 'reader', source: 'service', limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.total).toBe(20);
    expect(page.nextOffset).toBe(10);
  });

  test('physically prunes expired shards while retaining saved snapshots', () => {
    const historyDir = dataService.user.resolveDir('feed/history', 'alice');
    fs.mkdirSync(historyDir, { recursive: true });
    const expiredPath = path.join(historyDir, '2000-01.jsonl');
    fs.writeFileSync(expiredPath, `${JSON.stringify({ id: 'expired', stateKey: 'expired', title: 'Expired' })}\n`);
    const saved = { id: 'saved-old', stateKey: 'saved-old', title: 'Saved forever', origins: ['reader'], publishedAt: '2000-01-01T00:00:00.000Z' };
    const store = new JsonlFeedHistoryStore({ dataService, logger: { warn() {} } });
    store.setSaved('alice', [saved], true);
    const result = store.search('alice', { state: 'saved', states: new Map([['saved-old', { isSaved: true }]]) });
    expect(result.items.map(item => item.id)).toContain('saved-old');
    expect(fs.existsSync(expiredPath)).toBe(false);
  });
});
