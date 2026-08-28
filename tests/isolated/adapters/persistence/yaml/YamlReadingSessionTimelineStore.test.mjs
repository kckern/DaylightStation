import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { describe, it, expect } from 'vitest';
import { YamlReadingSessionTimelineStore } from '#adapters/persistence/yaml/YamlReadingSessionTimelineStore.mjs';

describe('YamlReadingSessionTimelineStore', () => {
  it('preserves a reading timeline across a new store instance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reading-timeline-'));
    const configService = { getHouseholdPath: (relative) => path.join(root, relative) };
    try {
      const first = new YamlReadingSessionTimelineStore({ configService, logger: { warn() {} } });
      await first.append({ at: '2026-08-28T20:00:00.000Z', type: 'acknowledged', location: 'livingroom', sessionId: 'rs_1' });
      const afterRestart = new YamlReadingSessionTimelineStore({ configService, logger: { warn() {} } });
      await expect(afterRestart.list('livingroom')).resolves.toEqual([
        expect.objectContaining({ type: 'acknowledged', sessionId: 'rs_1' }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
