import { describe, it, expect } from 'vitest';
import { InMemoryPushDeviceRegistry } from './InMemoryPushDeviceRegistry.mjs';

describe('InMemoryPushDeviceRegistry', () => {
  it('keeps the newest hello for a user', () => {
    const r = new InMemoryPushDeviceRegistry();
    r.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c1', atMs: 1 });
    r.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c2', atMs: 2 });
    expect(r.currentFor('u')).toEqual({ deviceId: 'phone', connectionId: 'c2', lastSeenMs: 2 });
  });
  it('forgetting the current connection does not fall back to a stale one', () => {
    const r = new InMemoryPushDeviceRegistry();
    r.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c1', atMs: 1 });
    r.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c2', atMs: 2 });
    r.forget('c2');
    expect(r.currentFor('u')).toBeNull();
  });
  it('forgetting an older connection keeps the current one', () => {
    const r = new InMemoryPushDeviceRegistry();
    r.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c1', atMs: 1 });
    r.recordHello({ username: 'u', deviceId: 'phone', connectionId: 'c2', atMs: 2 });
    r.forget('c1');
    expect(r.currentFor('u').connectionId).toBe('c2');
  });
  it('knows nobody by default', () => {
    expect(new InMemoryPushDeviceRegistry().currentFor('u')).toBeNull();
  });
});
