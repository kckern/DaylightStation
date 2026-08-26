import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { YamlWorkSessionDatastore } from './YamlWorkSessionDatastore.mjs';

describe('YamlWorkSessionDatastore', () => {
  it('keeps one session record per file with no derived day index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'school-session-record-'));
    try {
      const store = new YamlWorkSessionDatastore({
        configService: { getHouseholdPath: (suffix) => path.join(root, suffix) },
      });
      await store.appendEvent('ses-one', {
        type: 'created', at: '2026-08-14T17:00:00.000Z', learnerId: 'learner4', unitId: 'math.01',
      });
      const file = path.join(root, 'school/records/sessions/2026-08/ses-one.yml');
      expect(await store.readEvents('ses-one')).toHaveLength(1);
      expect((await fs.readFile(file, 'utf8'))).toContain('events:');
      await expect(fs.access(path.join(root, 'school/records/sessions/2026-08/index.yml'))).rejects.toThrow();
      expect(await store.listOpenForLearner('learner4')).toMatchObject([{ sessionId: 'ses-one', day: '2026-08-14' }]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
