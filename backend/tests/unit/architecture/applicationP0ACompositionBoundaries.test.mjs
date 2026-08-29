import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const scoped = [
  'backend/src/3_applications/devices/services/DeviceFactory.mjs',
  'backend/src/3_applications/camera/cameraArchiveJobHandler.mjs',
  'backend/src/3_applications/camera/cameraLedgerJobHandler.mjs',
  'backend/src/3_applications/eink/EinkPanelService.mjs',
  'backend/src/3_applications/school/documents/RenderPrintDocument.mjs',
  'backend/src/3_applications/sheets/SheetService.mjs',
];

test('P0-A application files import no concrete adapter or rendering implementation', () => {
  for (const relative of scoped) {
    const source = readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.doesNotMatch(source, /from ['"]#adapters\//, relative);
    assert.doesNotMatch(source, /from ['"]#rendering\//, relative);
  }
});

test('device and camera applications contain no concrete construction bundle', () => {
  const files = scoped.slice(0, 3);
  for (const relative of files) {
    const source = readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.doesNotMatch(source, /\b(?:cameraAdapters|adapterFactories)\b/, relative);
    assert.doesNotMatch(
      source,
      /new\s+(?:ReolinkClient|ArchiveEncoder|ArchiveManifestStore|Filesystem\w+Artifacts|\w+Adapter)\b/,
      relative,
    );
  }
});

test('camera endpoint deployment resolution no longer lives in applications', () => {
  assert.equal(
    existsSync(path.join(repoRoot, 'backend/src/3_applications/camera/resolveCameraEndpoint.mjs')),
    false,
  );
});
