import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IVideoEncoder } from './IVideoEncoder.mjs';
import { IRecapSnapshotStore } from './IRecapSnapshotStore.mjs';

test('ports throw when not implemented', async () => {
  await assert.rejects(() => new IVideoEncoder().encodeSequence({}), /must be implemented/);
  await assert.rejects(() => new IRecapSnapshotStore().listCaptures('x'), /must be implemented/);
  await assert.rejects(() => new IRecapSnapshotStore().readCapture('p'), /must be implemented/);
  await assert.rejects(() => new IRecapSnapshotStore().cleanup('x', 'h', {}), /must be implemented/);
});
