// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { createCheckpointClient } from './checkpointClient.js';
const key = { system: 'gb', gameId: 'example-quest', user: 'user_5' };
const provenance = { romHash: 'a'.repeat(64), core: { name: 'gambatte', bundleHash: 'b'.repeat(64), format: 1, variant: 'wasm' } };
const descriptor = bytes => ({ hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
function head({ snapshot = Buffer.from('state-one'), battery = Buffer.from('battery-one'), ...extra } = {}) {
  return { schema: 1, revision: 'revision-one', key, parent: null, kind: 'save', captureId: 'capture-one', sessionId: 'session-one', sequence: 1, provenance,
    artifacts: { snapshot: snapshot ? descriptor(snapshot) : null, battery: battery ? descriptor(battery) : null },
    snapshot: snapshot?.toString('base64') ?? null, battery: battery?.toString('base64') ?? null, ...extra };
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const capture = () => ({ expectedRevision: null, captureId: 'capture-one', sessionId: 'session-one', sequence: 1,
  provenance, snapshot: new Uint8Array(Buffer.from('state-one')), battery: new Uint8Array(Buffer.from('battery-one')) });
describe('protected checkpoint client', () => {
  it('loads and verifies both artifacts without using cached responses', async () => {
    const fetchImpl = vi.fn(async () => response({ head: head(), provenance, saveMode: 'battery', compatible: true }));
    const result = await createCheckpointClient({ fetchImpl }).getCheckpoint(key);
    expect(result.status).toBe('ok');
    expect(Buffer.from(result.data.head.snapshot).toString()).toBe('state-one');
    expect(Buffer.from(result.data.head.battery).toString()).toBe('battery-one');
    expect(fetchImpl.mock.calls[0][1].cache).toBe('no-store');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/emulator/checkpoint/gb/example-quest?user=user_5');
  });
  it('treats only a valid absent description as new progress, never a 404/503', async () => {
    const absent = createCheckpointClient({ fetchImpl: async () => response({ head: null, provenance, saveMode: 'battery', compatible: true }) });
    expect((await absent.getCheckpoint(key)).data.head).toBeNull();
    for (const status of [404, 503]) {
      const result = await createCheckpointClient({ fetchImpl: async () => response({ error: 'unavailable' }, status) }).getCheckpoint(key);
      expect(result.status).toBe('error'); expect(result.httpStatus).toBe(status);
    }
  });
  it('rejects byte corruption and identity mixups before exposing a usable checkpoint', async () => {
    for (const record of [head({ snapshot: Buffer.from('state-one') }), head({ key: { ...key, user: 'user_4' } })]) {
      if (record.key.user === key.user) record.snapshot = Buffer.from('corrupt').toString('base64');
      const result = await createCheckpointClient({ fetchImpl: async () => response({ head: record, provenance, saveMode: 'battery', compatible: true }) }).getCheckpoint(key);
      expect(result.status).toBe('error'); expect(result.code).toBe('ECHECKPOINTCORRUPT');
      expect(result).not.toHaveProperty('data');
    }
  });
  it('sends one atomic bundle with its original parent and validates the acknowledged capture', async () => {
    const fetchImpl = vi.fn(async () => response({ head: head() }));
    const result = await createCheckpointClient({ fetchImpl }).putCheckpoint(key, capture());
    expect(result.status).toBe('ok');
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain('/checkpoint/'); expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toMatchObject({ expectedRevision: null, captureId: 'capture-one', snapshot: Buffer.from('state-one').toString('base64'), battery: Buffer.from('battery-one').toString('base64') });
    const wrong = await createCheckpointClient({ fetchImpl: async () => response({ head: head({ captureId: 'another-capture' }) }) }).putCheckpoint(key, capture());
    expect(wrong.status).toBe('error');
  });
  it('does not retry or rebase a conflict response onto a different revision', async () => {
    const fetchImpl = vi.fn(async () => response({ error: 'Progress changed', code: 'ECHECKPOINTCONFLICT' }, 409));
    const result = await createCheckpointClient({ fetchImpl }).putCheckpoint(key, capture());
    expect(result).toMatchObject({ status: 'error', httpStatus: 409, code: 'ECHECKPOINTCONFLICT' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('times out an unresponsive request and leaves it unacknowledged', async () => {
    const result = await createCheckpointClient({ fetchImpl: () => new Promise(() => {}), timeoutMs: 5 }).putCheckpoint(key, capture());
    expect(result.status).toBe('error'); expect(result.code).toBe('ECHECKPOINTTIMEOUT');
  });
  it('cannot accept different bytes as acknowledgment of the same capture', async () => {
    const result = await createCheckpointClient({ fetchImpl: async () => response({ head: head({ snapshot: Buffer.from('old-state') }) }) }).putCheckpoint(key, capture());
    expect(result.status).toBe('error'); expect(result.code).toBe('ECHECKPOINTCORRUPT');
  });
  it('rejects a different revision from the one explicitly selected for recovery', async () => {
    const result = await createCheckpointClient({ fetchImpl: async () => response({ head: head() }) }).getCheckpointRevision(key, 'another-revision');
    expect(result.status).toBe('error');
  });
  it('rejects a falsely compatible description with mismatched ROM or core identity', async () => {
    const result = await createCheckpointClient({ fetchImpl: async () => response({ head: head(), provenance: { ...provenance, romHash: 'c'.repeat(64) }, saveMode: 'battery', compatible: true }) }).getCheckpoint(key);
    expect(result.status).toBe('error');
  });

});
