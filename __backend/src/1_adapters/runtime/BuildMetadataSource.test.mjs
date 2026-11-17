// @vitest-environment node
import { it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BuildMetadataSource } from './BuildMetadataSource.mjs';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('reports bounded baked build metadata as declared rather than verified deployment identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'build-identity-')); roots.push(root);
  const file = path.join(root, 'build.txt'); const commit = 'a'.repeat(40);
  const content = `Build Time: 2026-11-16T18:00:00Z\nCommit: https://github.com/example/repo/commit/${commit}\n`;
  await writeFile(file, content);
  const source = new BuildMetadataSource({ bakedFile: file });
  expect(source.read()).toEqual({ kind: 'file', path: file });
  expect(source.diagnosticIdentity?.()).toEqual({ source: 'baked-build-metadata', verification: 'declared-unverified', commit, metadataSha256: createHash('sha256').update(content).digest('hex') });
});
it('labels development checkout and rejects malformed or oversized build declarations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'build-identity-')); roots.push(root);
  const file = path.join(root, 'build.txt');
  const dev = new BuildMetadataSource({ bakedFile: file, checkoutDirectory: process.cwd() });
  expect(dev.diagnosticIdentity?.()).toMatchObject({ source: 'development-checkout', verification: 'declared-unverified', commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
  await writeFile(file, 'Commit: not-a-sha\n');
  expect(dev.diagnosticIdentity?.()).toMatchObject({ source: 'baked-build-metadata', commit: null });
  await writeFile(file, 'x'.repeat(8193));
  expect(dev.diagnosticIdentity?.()).toEqual({ source: 'unavailable', verification: 'unavailable', commit: null, metadataSha256: null });
});
