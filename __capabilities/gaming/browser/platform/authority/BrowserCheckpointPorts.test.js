import { describe, expect, it, vi } from 'vitest';
import {
  BrowserSessionJournal, BrowserSnapshotRepository, isQuotaError, reclaimCheckpoints,
} from "./BrowserCheckpointPorts.js";

function storage({ quotaBytes = Infinity } = {}) {
  const values = new Map();
  const used = () => [...values].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    get length() { return values.size; },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      const next = used() - (values.has(key) ? key.length + values.get(key).length : 0) + key.length + value.length;
      if (next > quotaBytes) { const e = new Error('exceeded the quota'); e.name = 'QuotaExceededError'; throw e; }
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
    keys: () => [...values.keys()],
  };
}

function ports(local, onReclaim) {
  return {
    snapshots: new BrowserSnapshotRepository({ storage: local, namespace: 'ns', onReclaim }),
    journal: new BrowserSessionJournal({ storage: local, namespace: 'ns', onReclaim }),
  };
}

describe('browser checkpoint ports', () => {
  it('persists snapshots and append-only journals independently', async () => {
    const local = storage(); const snapshots = new BrowserSnapshotRepository({ storage: local, namespace: 'test' }); const journal = new BrowserSessionJournal({ storage: local, namespace: 'test' });
    const session = { header: { session_id: 's1', revision: 0 }, state: {} }; await snapshots.put(session, { expectedRevision: null }); await journal.create('s1', { header: session.header }); await journal.append('s1', { command: { command_id: 'c1' }, events: [] }, { expectedRevision: 0 });
    expect((await snapshots.get('s1')).header.revision).toBe(0); expect(await journal.read('s1')).toHaveLength(2);
  });
});

describe('reclaimCheckpoints', () => {
  it('keeps every indexed session and any id passed in keep, and removes the rest of the namespace', () => {
    const local = storage();
    for (const key of ['ns:snapshot:a', 'ns:journal:a', 'ns:snapshot:b', 'ns:journal:b', 'ns:snapshot:c', 'other:snapshot:z']) local.setItem(key, '{}');
    local.setItem('ns:active:learner-a', 'a');
    local.setItem('ns:active:learner-b', 'b');

    const first = reclaimCheckpoints({ storage: local, namespace: 'ns', keep: ['c'] });
    expect(first.removed).toEqual([]);
    expect(new Set(first.kept)).toEqual(new Set(['a', 'b', 'c']));
    expect(local.keys()).toHaveLength(8);

    const second = reclaimCheckpoints({ storage: local, namespace: 'ns' });
    expect(second.removed).toEqual(['c']);
    expect(new Set(second.kept)).toEqual(new Set(['a', 'b']));
    expect(local.getItem('ns:snapshot:c')).toBe(null);
    for (const key of ['ns:snapshot:a', 'ns:journal:a', 'ns:snapshot:b', 'ns:journal:b', 'other:snapshot:z']) expect(local.getItem(key)).toBe('{}');
    expect(local.getItem('ns:active:learner-a')).toBe('a');
    expect(local.getItem('ns:active:learner-b')).toBe('b');
  });

  it('reports a session once even when both its snapshot and journal go', () => {
    const local = storage();
    local.setItem('ns:snapshot:d', '{}'); local.setItem('ns:journal:d', '[]');
    expect(reclaimCheckpoints({ storage: local, namespace: 'ns' }).removed).toEqual(['d']);
    expect(local.keys()).toEqual([]);
  });
});

describe('isQuotaError', () => {
  it('recognises the quota errors browsers throw and nothing else', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });
});

describe('writes into a full store', () => {
  it('reclaims dead sessions and retries a journal append once', async () => {
    const local = storage({ quotaBytes: 2000 });
    local.setItem('ns:snapshot:dead', 'x'.repeat(1000));
    const onReclaim = vi.fn();
    const { snapshots, journal } = ports(local, onReclaim);
    const session = { header: { session_id: 's1', revision: 0 }, state: {} };
    await journal.create('s1', { header: session.header });
    await snapshots.put(session, { expectedRevision: null });
    local.setItem('ns:active:learner-b', 's1');

    await expect(journal.append('s1', { command: { command_id: 'c1', payload: 'p'.repeat(900) }, events: [] }, { expectedRevision: 0 })).resolves.toBeUndefined();
    expect(local.getItem('ns:snapshot:dead')).toBe(null);
    expect(await journal.read('s1')).toHaveLength(2);
    expect(onReclaim).toHaveBeenCalledTimes(1);
    expect(onReclaim).toHaveBeenCalledWith(expect.objectContaining({ removed: ['dead'] }), 'quota');
  });

  it('never reclaims the session being written, even before it is indexed', async () => {
    const local = storage({ quotaBytes: 2000 });
    local.setItem('ns:snapshot:dead', 'x'.repeat(1000));
    const onReclaim = vi.fn();
    const { snapshots, journal } = ports(local, onReclaim);
    const session = { header: { session_id: 's2', revision: 0 }, state: { pad: 'p'.repeat(900) } };
    await journal.create('s2', { header: session.header });
    await snapshots.put(session, { expectedRevision: null });
    expect(onReclaim).toHaveBeenCalledTimes(1);
    expect(local.getItem('ns:snapshot:dead')).toBe(null);
    expect(local.getItem('ns:journal:s2')).not.toBe(null);
    expect((await snapshots.get('s2')).state.pad).toHaveLength(900);
  });

  it('rethrows the quota error when reclaiming did not free enough', async () => {
    const local = storage({ quotaBytes: 500 });
    const onReclaim = vi.fn();
    const { snapshots } = ports(local, onReclaim);
    const session = { header: { session_id: 's3', revision: 0 }, state: { pad: 'p'.repeat(1000) } };
    await expect(snapshots.put(session, { expectedRevision: null })).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(onReclaim).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other storage error without reclaiming', async () => {
    const local = storage();
    local.setItem('ns:snapshot:dead', '{}');
    local.setItem = () => { throw new Error('storage disabled'); };
    const onReclaim = vi.fn();
    const { journal } = ports(local, onReclaim);
    await expect(journal.create('s4', { header: {} })).rejects.toThrow('storage disabled');
    expect(onReclaim).not.toHaveBeenCalled();
    expect(local.getItem('ns:snapshot:dead')).toBe('{}');
  });
});
