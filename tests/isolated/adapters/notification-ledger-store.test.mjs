// tests/isolated/adapters/notification-ledger-store.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlNotificationLedgerStore } from '#adapters/persistence/yaml/YamlNotificationLedgerStore.mjs';

let dir, store;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'ledger-')); store = new YamlNotificationLedgerStore({ basePath: dir }); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('YamlNotificationLedgerStore', () => {
  it('round-trips lastSent', () => {
    expect(store.getLastSent('kckern', 'ceremony:x')).toBeNull();
    store.recordSent({ username: 'kckern', dedupeKey: 'ceremony:x', category: 'ceremony', atMs: 1000 });
    expect(store.getLastSent('kckern', 'ceremony:x')).toBe(1000);
  });
  it('recordSuppressed does NOT move lastSent', () => {
    store.recordSent({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', atMs: 1000 });
    store.recordSuppressed({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', reason: 'cooldown', atMs: 2000 });
    expect(store.getLastSent('kckern', 'k')).toBe(1000);
  });
  it('recentEvents returns newest-first and includes both kinds', () => {
    store.recordSent({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', atMs: 1000 });
    store.recordSuppressed({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', reason: 'cooldown', atMs: 2000 });
    const ev = store.recentEvents(10);
    expect(ev[0]).toMatchObject({ at: 2000, suppressed: true, reason: 'cooldown' });
    expect(ev[1]).toMatchObject({ at: 1000, delivered: true, reason: 'ok' });
  });
  it('bounds the events log', () => {
    for (let i = 0; i < 250; i++) store.recordSent({ username: 'u', dedupeKey: 'k', category: 'system', atMs: i });
    expect(store.recentEvents(1000).length).toBeLessThanOrEqual(200);
  });
});
