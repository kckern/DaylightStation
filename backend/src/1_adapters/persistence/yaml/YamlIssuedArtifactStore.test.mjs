import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { YamlIssuedArtifactStore } from './YamlIssuedArtifactStore.mjs';

let root;
let store;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'school-issued-artifact-'));
  store = new YamlIssuedArtifactStore({ configService: { getHouseholdPath: (suffix) => path.join(root, suffix) } });
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe('YamlIssuedArtifactStore', () => {
  it('round-trips exact bytes and a digest-verifiable manifest for ids containing slashes', async () => {
    const bytes = Buffer.from('%PDF-1.4\nexact issued bytes\n');
    const saved = await store.put({ artifactId: 'math/course/ws-ses_1', bytes, pageCount: 2,
      issuedAt: '2026-08-24T10:00:00.000Z', sessionId: 'ses_1', learnerId: 'kid', unitId: 'u1' });
    expect(saved.manifest).toMatchObject({ schema: 'school.issued-artifact/v1', byteLength: bytes.length,
      artifactId: 'math/course/ws-ses_1', captureKind: 'original' });
    expect((await store.get('math/course/ws-ses_1')).bytes.equals(bytes)).toBe(true);
  });

  it('is first-wins: same bytes are idempotent and different bytes are refused', async () => {
    const base = { artifactId: 'art_1', bytes: Buffer.from('one'), issuedAt: '2026-08-24T10:00:00.000Z', sessionId: 'ses_1' };
    await store.put(base);
    await expect(store.put(base)).resolves.toMatchObject({ manifest: { artifactId: 'art_1' } });
    await expect(store.put({ ...base, bytes: Buffer.from('two') })).rejects.toMatchObject({ code: 'ARTIFACT_IMMUTABLE' });
    expect((await store.get('art_1')).bytes.toString()).toBe('one');
  });

  it('refuses traversal and incomplete records', async () => {
    expect(await store.get('../outside')).toBe(null);
    await expect(store.put({ artifactId: '', bytes: Buffer.from('x') })).rejects.toThrow(/requires artifactId/);
  });
});
