import { createItemActionOwner } from '../../modules/Media/actions/itemActionOwner.js';

export function createScreenItemActions({ source, targetId }) {
  if (!source?.capture || !source?.applyQueue) {
    const unsupported = () => ({ ok: false, code: 'ITEM_ACTION_UNSUPPORTED', reason: 'This screen has no playback owner supporting item actions.' });
    return { execute: unsupported, undo: unsupported };
  }
  let pendingCommit = null;
  const owner = createItemActionOwner({
    targetId,
    capture: () => source.capture().snapshot,
    revision: () => {
      const identity = source.getActionOwner?.() ?? source.capture()?.identity;
      return { ownerInstanceId: identity?.ownerInstanceId, queueRevision: identity?.queueRevision, stopRevision: identity?.stopRevision };
    },
    apply: (snapshot, { playbackChanged, restore, operationId } = {}) => {
      // A prior capture's playback identity describes the OLD visit. The
      // owner must mint the next identity; never present old proof as if it
      // described the newly constructed queue.
      snapshot.meta = { ...snapshot.meta };
      delete snapshot.meta.playbackOwner;
      delete snapshot.meta.queueOwner;
      // The native renderer requires a format even before content metadata
      // resolves. Search items carry type/mediaType; preserve explicit audio.
      snapshot.queue.items = snapshot.queue.items.map(item => ({ ...item,
        format: item.format ?? (['audio', 'track', 'song'].includes(item.mediaType ?? item.type) ? 'audio' : 'video'),
      }));
      if (snapshot.currentItem) snapshot.currentItem.format ??= snapshot.queue.items[snapshot.queue.currentIndex]?.format ?? 'video';
      const result = playbackChanged || restore
        ? source.adopt(snapshot, { operationId: operationId ?? globalThis.crypto.randomUUID(), autoplay: !restore || snapshot.state !== 'paused' })
        : source.applyQueue(snapshot.queue);
      if (result?.ok === false) return result;
      // React setters issue an owner revision immediately; ACK must wait for
      // the matching queue to be readable from the owner after commit.
      const signature = queue => JSON.stringify([queue?.items?.map(item => item.queueItemId), queue?.currentIndex]);
      const expected = signature(snapshot.queue);
      const deadline = Date.now() + 3000;
      const commit = new Promise(resolve => {
        const check = () => {
          if (signature(source.capture()?.snapshot?.queue) === expected) resolve({ ok: true });
          else if (Date.now() >= deadline) resolve({ ok: false, code: 'QUEUE_APPLY_TIMEOUT' });
          else setTimeout(check, 20);
        };
        check();
      });
      pendingCommit = commit;
      return commit.finally(() => { if (pendingCommit === commit) pendingCommit = null; });
    },
  });
  // React setters issue a revision before the new queue is readable. Wait
  // only for that commit, not for content expansion or native playback, so
  // a newer Play can still supersede an unresolved older collection.
  const execute = command => pendingCommit
    ? pendingCommit.then(() => execute(command))
    : owner.execute(command);
  return { ...owner, execute };
}
