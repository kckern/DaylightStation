import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlPlaySessionDatastore } from './YamlPlaySessionDatastore.mjs';
import { PlaySession } from '#domains/gaming/entities/PlaySession.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function storeAt(root) {
  return new YamlPlaySessionDatastore({
    configService: { getHouseholdPath: (relative) => path.join(root, relative) },
    logger: { warn() {} },
  });
}

describe('YamlPlaySessionDatastore reconciliation evidence', () => {
  it('remembers a reported device log across repository instances', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-play-session-'));
    roots.push(root);
    const evidence = {
      evidenceId: 'retroarch__2026_09_11__19_00_00.log',
      startedAt: '2026-09-11T19:00:00', contentPath: '/Games/Test.gb',
    };

    await storeAt(root).markReconciliationEvidence('livingroom-tv', evidence);

    await expect(storeAt(root).hasReconciliationEvidence(
      'livingroom-tv', evidence.evidenceId,
    )).resolves.toBe(true);
  });
});

describe('YamlPlaySessionDatastore open-session index', () => {
  it('lists every open device session and excludes ended current records', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-play-session-'));
    roots.push(root);
    const store = storeAt(root);
    const session = (id, deviceId, at) => {
      const value = PlaySession.open({ id, deviceId, surface: 'browser-emulator', trustedGapMs: 25_000 });
      value.observe({ state: PlayState.PLAYING, observedAt: at });
      return value;
    };
    const open = session('ps_open', 'garage-tv', '2026-09-12T20:00:00.000Z');
    const ended = session('ps_ended', 'livingroom-tv', '2026-09-12T19:00:00.000Z');
    ended.end({ endedAt: '2026-09-12T19:10:00.000Z', reason: 'quit' });
    await store.save(open);
    await store.save(ended);

    await expect(storeAt(root).listOpen()).resolves.toMatchObject([
      { id: 'ps_open', deviceId: 'garage-tv' },
    ]);
  });
});
