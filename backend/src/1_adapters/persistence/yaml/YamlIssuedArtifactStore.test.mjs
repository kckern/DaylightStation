import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
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
  it('stores a digest-verifiable worksheet recipe without a PDF payload', async () => {
    const bytes = Buffer.from('%PDF-1.4\nexact issued bytes\n');
    const sourceDocument = { schema: 'school.document/v2', id: 'math/course/ws', rev: 'rev1', blocks: [] };
    const saved = await store.put({ artifactId: 'math/course/ws-ses_1', bytes, pageCount: 2,
      issuedAt: '2026-08-24T10:00:00.000Z', sessionId: 'ses_1', learnerId: 'kid', unitId: 'u1',
      sourceDocument, renderContext: { learnerId: 'kid' } });
    expect(saved.manifest).toMatchObject({ schema: 'school.session-artifact/v4',
      artifactId: 'math/course/ws-ses_1', captureKind: 'original', sourceDocument,
      representation: { mediaType: 'application/pdf', generated: true } });
    expect(saved.manifest.renderInputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await store.get('math/course/ws-ses_1')).bytes).toBeNull();
    await expect(stat(path.join(root, 'school/artifacts/issued/math/course/ws-ses_1.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is first-wins by semantic render input, not disposable PDF bytes', async () => {
    const base = { artifactId: 'art_1', bytes: Buffer.from('one'), issuedAt: '2026-08-24T10:00:00.000Z', sessionId: 'ses_1',
      sourceDocument: { schema: 'school.document/v2', id: 'doc', rev: 'one', blocks: [] }, renderContext: { learnerId: 'kid' } };
    await store.put(base);
    await expect(store.put({ ...base, bytes: Buffer.from('different renderer output') }))
      .resolves.toMatchObject({ manifest: { artifactId: 'art_1' } });
    await expect(store.put({ ...base, sourceDocument: { ...base.sourceDocument, rev: 'two' } }))
      .rejects.toMatchObject({ code: 'ARTIFACT_IMMUTABLE' });
    expect((await store.get('art_1')).bytes).toBeNull();
  });

  it('detects a modified generated-PDF recipe by its input digest', async () => {
    const artifactId = 'math/course/ws-tampered';
    await store.put({ artifactId, bytes: Buffer.from('%PDF disposable'),
      sourceDocument: { schema: 'school.document/v2', id: 'doc', rev: 'one', blocks: [] },
      renderContext: { learnerId: 'kid' } });
    const manifestPath = path.join(root, 'school/artifacts/issued/math/course/ws-tampered.yml');
    const manifest = yaml.load(await readFile(manifestPath, 'utf8'));
    manifest.sourceDocument.rev = 'tampered';
    await writeFile(manifestPath, yaml.dump(manifest));

    await expect(store.get(artifactId)).rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' });
  });

  it('retains a receipt PNG with its frozen source document and typed representation', async () => {
    const bytes = Buffer.from('png bytes');
    await store.put({ artifactId: 'receipt/ses_1/out_ses_1', bytes,
      issuedAt: '2026-08-24T10:00:00.000Z', sessionId: 'ses_1', learnerId: 'kid', kind: 'result-receipt',
      representation: { mediaType: 'image/png', extension: 'png', width: 384, height: 640 },
      sourceDocument: { schema: 'school.document-source/v1', id: 'result-ses-1', target: ['receipt'], blocks: [] } });
    const retained = await store.get('receipt/ses_1/out_ses_1');
    expect(retained.manifest).toMatchObject({ schema: 'school.session-artifact/v3', kind: 'result-receipt',
      representation: { mediaType: 'image/png', extension: 'png', width: 384, height: 640 },
      sourceDocument: { id: 'result-ses-1' } });
    expect(retained.bytes.equals(bytes)).toBe(true);
  });

  it('refuses traversal and incomplete records', async () => {
    expect(await store.get('../outside')).toBe(null);
    await expect(store.put({ artifactId: '', bytes: Buffer.from('x') })).rejects.toThrow(/requires artifactId/);
  });
});

/**
 * Id -> path mapping, and the legacy tail.
 *
 * `#stem` was `encodeURIComponent(wholeId)`, which flattened a hierarchical id
 * into ONE filename — `receipt%2Fses_hmSsHlJR%2Fout%3Ases_hmSsHlJR.yml` — with
 * every artifact in a single directory. Per-segment mapping fixes new writes;
 * DUAL-READ is what makes shipping it safe with nothing migrated yet.
 */
describe('YamlIssuedArtifactStore path mapping', () => {
  const issuedRoot = () => path.join(root, 'school/artifacts/issued');

  it('writes a hierarchical path with no percent-encoded separators', async () => {
    await store.put({
      artifactId: 'receipt/ses_abc/original',
      kind: 'result-receipt',
      bytes: Buffer.from('%PDF-1.4\nnew\n'),
      issuedAt: '2026-08-26T00:00:00.000Z',
    });
    await expect(stat(path.join(issuedRoot(), 'receipt', 'ses_abc', 'original.yml'))).resolves.toBeTruthy();
    expect((await readdir(issuedRoot())).some((name) => name.includes('%2F'))).toBe(false);
  });

  // The safety property: everything already on disk keeps resolving, so this
  // ships without a migration and no teacher link 404s.
  it('still reads an artifact written under the legacy flat name', async () => {
    const id = 'receipt/ses_hmSsHlJR/out:ses_hmSsHlJR';
    const bytes = Buffer.from('%PDF-1.4\nlegacy\n');
    await mkdir(issuedRoot(), { recursive: true });
    await writeFile(path.join(issuedRoot(), `${encodeURIComponent(id)}.pdf`), bytes);
    await writeFile(path.join(issuedRoot(), `${encodeURIComponent(id)}.yml`), yaml.dump({
      artifactId: id,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
      kind: 'result-receipt',
    }));
    const got = await store.get(id);
    expect(got?.manifest?.artifactId).toBe(id);
    expect(got.bytes.equals(bytes)).toBe(true);
  });

  it('keeps legacy worksheet YAML readable when its redundant PDF is absent', async () => {
    const id = 'math/course/ws-yaml-only-legacy';
    const manifestPath = path.join(issuedRoot(), 'math', 'course', 'ws-yaml-only-legacy.yml');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, yaml.dump({
      schema: 'school.session-artifact/v2', artifactId: id, kind: 'worksheet',
      document: { id: 'math/course/ws', revision: 'rev1' },
      allocation: { cardId: '8684155', rowRange: { start: 28, end: 32 } },
    }));

    await expect(store.get(id)).resolves.toMatchObject({
      manifest: { artifactId: id, kind: 'worksheet' }, bytes: null,
    });
  });

  it('keeps a colon inside its own segment rather than splitting the path', async () => {
    await store.put({
      artifactId: 'receipt/ses_x/out:ses_x',
      kind: 'result-receipt',
      bytes: Buffer.from('%PDF-1.4\ncolon\n'),
      issuedAt: '2026-08-26T00:00:00.000Z',
    });
    await expect(stat(path.join(issuedRoot(), 'receipt', 'ses_x', 'out%3Ases_x.yml'))).resolves.toBeTruthy();
  });
});
