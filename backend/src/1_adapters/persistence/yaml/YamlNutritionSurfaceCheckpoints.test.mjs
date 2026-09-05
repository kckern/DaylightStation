import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlNutritionSurfaceCheckpoints } from './YamlNutritionSurfaceCheckpoints.mjs';
import { YamlFoodLogDatastore } from './YamlFoodLogDatastore.mjs';
import { createNutriLog } from '#apps/nutribot/nutriLogRecords.mjs';

describe('nutrition surface persistence', () => {
  it('persists delivery checkpoints across instances and isolates users', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-sync-'));
    const dataService = { user: { resolveDir: (relative, userId) => path.join(root, userId, relative) } };
    const first = new YamlNutritionSurfaceCheckpoints({ dataService });
    expect(await first.load('alice')).toBeNull();
    const checkpoint = { destination: 'surface:alice', messages: { '22': 'hash' }, days: {} };
    await first.save('alice', checkpoint);
    const restarted = new YamlNutritionSurfaceCheckpoints({ dataService });
    expect(await restarted.load('alice')).toEqual(checkpoint);
    expect(await restarted.load('bob')).toBeNull();
  });

  it('finds linked messages after their original capture is archived', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-sync-archive-'));
    const store = new YamlFoodLogDatastore({ configService: { getUserDir: userId => path.join(root, userId) },
      logger: { debug() {}, info() {}, warn() {} } });
    const log = createNutriLog({ userId: 'alice', conversationId: 'surface:alice',
      meal: { date: '2020-01-01', time: 'morning' }, metadata: { messageId: '22', source: 'upc' },
      items: [{ label: 'Shake', icon: 'default', grams: 325, unit: 'g', amount: 325, color: 'green', calories: 160 }],
      timezone: 'America/Los_Angeles', timestamp: new Date('2020-01-01T12:00:00Z') });
    await store.save(log.accept(new Date('2020-01-01T12:01:00Z')));
    await store.archiveOldLogs('alice');
    expect(await store.findAll('alice')).toEqual([]);
    expect(await store.findAll('alice', { includeArchives: true })).toEqual([
      expect.objectContaining({ id: log.id, conversationId: 'surface:alice', metadata: expect.objectContaining({ messageId: '22' }) }),
    ]);
  });
});
