import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { YamlWorksheetInstanceStore } from './YamlWorksheetInstanceStore.mjs';

describe('YamlWorksheetInstanceStore', () => {
  it('is append-only and resolves by issuing session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'worksheet-instance-'));
    try {
      const store = new YamlWorksheetInstanceStore({
        configService: { getHouseholdPath: (suffix) => path.join(root, suffix) },
      });
      const instance = { schema: 'school.worksheet-instance/v1', id: 'civilization/atlas/ws-one', sessionId: 'ses-one' };
      await store.put(instance);
      expect(await store.findBySession('ses-one')).toEqual(instance);
      await expect(store.put({ ...instance, learnerId: 'other' })).rejects.toThrow(/immutable/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
