import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilesystemTimelapseArtifactStore } from '#adapters/fitness/FilesystemTimelapseArtifactStore.mjs';
import { ITimelapseArtifactStore } from '#apps/fitness/ports/ITimelapseArtifactStore.mjs';

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test('owns frame workspace, durable artifact, Plex copy, and cleanup behind opaque handles', async () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timelapse-artifacts-'));
  roots.push(mediaDir);
  let encodeRequest;
  const store = new FilesystemTimelapseArtifactStore({
    mediaDir,
    videoEncoder: {
      async encodeSequence(request) {
        encodeRequest = request;
        assert.equal(fs.readFileSync(path.join(request.framesDir, 'frame_00000.jpg')).toString(), 'frame');
        fs.writeFileSync(request.outputPath, Buffer.from('mp4'));
      },
    },
    logger: { debug() {} },
  });

  assert.ok(store instanceof ITimelapseArtifactStore);
  const workspace = await store.createWorkspace('session-1');
  assert.deepEqual(Object.keys(workspace), ['kind']);
  await store.writeFrame(workspace, { index: 0, bytes: Buffer.from('frame') });
  const encoded = await store.encode(workspace, {
    slug: 'session-1_recap', fps: 10, crf: 20, metadata: { title: 'Recap' },
  });

  assert.equal(encodeRequest.pattern, 'frame_%05d.jpg');
  assert.equal(encoded.videoPath, 'media/video/fitness/session-1_recap.mp4');
  assert.equal(encoded.sizeBytes, 3);
  assert.deepEqual(Object.keys(encoded.artifact), ['kind']);
  const plexResource = await store.publishPlexCopy(encoded.artifact, { plexFileBase: 'Family Fitness - S01E01 - Recap' });
  assert.equal(plexResource, 'media/video/fitness/plex/Family Fitness - S01E01 - Recap.mp4');
  assert.equal(fs.readFileSync(path.join(mediaDir, plexResource.slice('media/'.length))).toString(), 'mp4');

  await store.discardWorkspace(workspace);
  assert.equal(fs.existsSync(encodeRequest.framesDir), false);
});

test('reports a zero-sized/missing encoder artifact without inventing success', async () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timelapse-artifacts-'));
  roots.push(mediaDir);
  const store = new FilesystemTimelapseArtifactStore({
    mediaDir,
    videoEncoder: { async encodeSequence() {} },
  });
  const workspace = await store.createWorkspace('session-2');
  const encoded = await store.encode(workspace, { slug: 'missing', fps: 10 });
  assert.equal(encoded.sizeBytes, null);
  await store.discardWorkspace(workspace);
});
