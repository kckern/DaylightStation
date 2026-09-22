import { describe, expect, it, vi } from 'vitest';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { createMoveRequest } from './movePlayback.js';
import { createRemoteMoveDestination } from './remoteMoveDestination.js';
import { fingerprintHandoffSnapshot } from '@shared-contracts/media/handoff.mjs';

function request() {
  const source = createLocalSessionController({ clientId: 'browser-a', ownerInstanceId: 'source-owner' });
  source.queue.playNow({ contentId: 'plex:7', title: 'Episode 7', duration: 120, format: 'video' });
  return createMoveRequest({ operationId: 'move-1', destinationId: 'office-tv', snapshot: source.portability.capture().snapshot, keepSource: false });
}

describe('remote move adoption evidence', () => {
  it('does not accept a generic HTTP/command acknowledgement as adoption', async () => {
    const http = vi.fn().mockResolvedValue({ ok: true });
    await expect(createRemoteMoveDestination({ deviceId: 'office-tv', http }).adopt(request()))
      .resolves.toEqual({ status: 'uncertain', reason: 'capture-not-confirmed' });
  });

  it('returns rejected for a typed terminal receiver rejection', async () => {
    const http = vi.fn().mockResolvedValue({
      ok: false,
      handoff: { transferId: 'move-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    });
    await expect(createRemoteMoveDestination({ deviceId: 'office-tv', http }).adopt(request()))
      .resolves.toEqual({ status: 'rejected', reason: 'HANDOFF_UNSUPPORTED' });
  });

  it('requires a started receipt bound to operation, queue item, and destination revision', async () => {
    const move = request();
    const destinationIdentity = {
      ownerInstanceId: 'office-owner', playbackRevision: 2, queueRevision: 3,
      sessionId: 'office-session', contentId: move.snapshot.currentItem.contentId,
      queueItemId: move.snapshot.queue.items[move.snapshot.queue.currentIndex].queueItemId,
    };
    const adoptedIdentity = {
      ownerInstanceId: 'office-owner', playbackRevision: 4, queueRevision: 5,
      sessionId: 'office-session', contentId: move.snapshot.currentItem.contentId,
      queueItemId: move.snapshot.queue.items[move.snapshot.queue.currentIndex].queueItemId,
    };
    const http = vi.fn()
      .mockResolvedValueOnce({
        ok: true, commandId: 'move-1:capture',
        handoff: { transferId: 'move-1', phase: 'captured', capture: {
          snapshot: { ...move.snapshot, sessionId: 'office-session', meta: { ...move.snapshot.meta, playbackOwner: destinationIdentity } },
          identity: destinationIdentity,
          capabilities: { handoffV1: true, seekable: true, liveEdge: false },
        } },
      })
      .mockResolvedValueOnce({
        ok: true, commandId: 'move-1:start',
        handoff: { transferId: 'move-1', phase: 'started', receipt: {
          transferId: 'move-1', phase: 'started',
          destination: { kind: 'device', id: 'office-tv', ownerInstanceId: 'office-owner' },
          identity: adoptedIdentity,
          snapshotFingerprint: fingerprintHandoffSnapshot(move.snapshot),
          actualPosition: move.snapshot.position,
          liveEdge: false,
          receiptId: 'receipt-1',
        } },
      });

    await expect(createRemoteMoveDestination({ deviceId: 'office-tv', http }).adopt(move))
      .resolves.toEqual({ status: 'adopted', destinationRevision: 4 });
    expect(http).toHaveBeenNthCalledWith(2, 'api/v1/device/office-tv/session/handoff', expect.objectContaining({
      commandId: 'move-1:start',
      params: expect.objectContaining({ transferId: 'move-1', op: 'start', snapshot: move.snapshot }),
    }), 'POST');
  });
});
