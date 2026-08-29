import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CameraLedgerStore } from '#adapters/camera/CameraLedgerStore.mjs';

describe('CameraLedgerStore', () => {
  it('writes and reads the established per-camera JSONL shape', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'camera-ledger-'));
    try {
      const store = new CameraLedgerStore({ resolveDestinations: () => [root] });
      const records = [{ ts: '2026-08-28T12:00:00.000Z', camera: 'driveway', labels: ['person'] }];
      const written = store.write({ records, camera: 'driveway', day: '2026-08-28' });

      expect(written).toEqual({ copies: 1 });
      expect(store.read({ camera: 'driveway', day: '2026-08-28' })).toEqual(records);
      expect(store.read({ camera: 'driveway', day: '2026-08-29' })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
