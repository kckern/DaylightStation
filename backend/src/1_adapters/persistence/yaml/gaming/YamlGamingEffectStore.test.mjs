import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlGamingEffectStore } from './YamlGamingEffectStore.mjs';

const roots = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gaming-effects-'));
  roots.push(root);
  return new YamlGamingEffectStore({ effectsDir: root });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('YamlGamingEffectStore', () => {
  it('creates a receipt once and returns the original receipt on replay', async () => {
    const store = await fixture();
    const original = { score: 100, award: 'badge' };

    await expect(store.put('game:session-1', original)).resolves.toEqual(original);
    await expect(store.put('game:session-1', { score: 0 })).resolves.toEqual(original);
    await expect(store.get('game:session-1')).resolves.toEqual(original);
  });

  it('appends and lists session effects in insertion order', async () => {
    const store = await fixture();

    await store.appendEffect('session-1', { kind: 'grant', amount: 3 });
    await store.appendEffect('session-1', { kind: 'unlock', id: 'map-2' });

    await expect(store.listEffects('session-1')).resolves.toEqual([
      { kind: 'grant', amount: 3 }, { kind: 'unlock', id: 'map-2' },
    ]);
  });
});
