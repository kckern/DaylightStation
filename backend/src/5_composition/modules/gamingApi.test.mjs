import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCharadesClueHistory } from '#adapters/persistence/yaml/gaming/YamlCharadesClueHistory.mjs';
import { createGamingApiModule } from './gamingApi.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('gaming API composition', () => {
  it('wires one durable Charades clue history into the application', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gaming-api-'));
    roots.push(root);
    const module = createGamingApiModule({
      definitionStore: {}, manifestStore: {},
      snapshotsDir: path.join(root, 'snapshots'), journalsDir: path.join(root, 'journals'),
      effectsDir: path.join(root, 'effects'), drawingCheckpointsDir: path.join(root, 'drawings'),
      historyDir: path.join(root, 'history'),
    });
    expect(module.clueHistory).toBeInstanceOf(YamlCharadesClueHistory);
    expect(module.gamingApplication.clueHistory).toBe(module.clueHistory);
  });
});
