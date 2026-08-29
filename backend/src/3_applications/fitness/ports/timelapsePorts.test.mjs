import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IRecapSnapshotStore } from './IRecapSnapshotStore.mjs';
import { ITimelapseArtifactStore } from './ITimelapseArtifactStore.mjs';
import { ISessionTrashStore } from './ISessionTrashStore.mjs';
import { IMenuMusicCatalog } from './IMenuMusicCatalog.mjs';

test('ports throw when not implemented', async () => {
  await assert.rejects(() => new IRecapSnapshotStore().listCaptures('x'), /must be implemented/);
  await assert.rejects(() => new IRecapSnapshotStore().readCapture('p'), /must be implemented/);
  await assert.rejects(() => new IRecapSnapshotStore().cleanup('x', 'h', {}), /must be implemented/);
  await assert.rejects(() => new ITimelapseArtifactStore().createWorkspace('x'), /must be implemented/);
  await assert.rejects(() => new ITimelapseArtifactStore().writeFrame({}, {}), /must be implemented/);
  await assert.rejects(() => new ITimelapseArtifactStore().encode({}, {}), /must be implemented/);
  await assert.rejects(() => new ITimelapseArtifactStore().publishPlexCopy({}, {}), /must be implemented/);
  await assert.rejects(() => new ITimelapseArtifactStore().discardWorkspace({}), /must be implemented/);
  await assert.rejects(() => new ISessionTrashStore().listRetentionBatches(), /must be implemented/);
  await assert.rejects(() => new ISessionTrashStore().permanentlyDelete({}), /must be implemented/);
  await assert.rejects(() => new ISessionTrashStore().pruneBatchIfEmpty('x'), /must be implemented/);
  assert.throws(() => new IMenuMusicCatalog().listTracks(), /must be implemented/);
});
