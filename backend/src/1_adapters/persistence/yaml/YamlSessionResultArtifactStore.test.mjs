import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { YamlSessionResultArtifactStore } from './YamlSessionResultArtifactStore.mjs';

describe('YamlSessionResultArtifactStore', () => {
  it('creates once and never overwrites retained machine bytes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'school-result-artifact-'));
    try {
      const store = new YamlSessionResultArtifactStore({
        configService: { getHouseholdPath: (relative) => path.join(root, relative) },
      });
      expect((await store.putMachineIfAbsent('ses_1', Buffer.from('first'))).created).toBe(true);
      const replay = await store.putMachineIfAbsent('ses_1', Buffer.from('second'));
      expect(replay.created).toBe(false);
      expect((await store.getMachine('ses_1')).toString()).toBe('first');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
