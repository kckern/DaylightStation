import { describe, expect, it, vi } from 'vitest';
import { createMoveRequest, executeMove } from './movePlayback.js';

const snapshot = {
  sessionId: 'session-1',
  currentItem: { id: 'episode-7', title: 'Episode 7' },
  queue: [{ id: 'episode-7' }, { id: 'episode-8' }],
  meta: { playbackOwner: { ownerInstanceId: 'browser-a', playbackRevision: 12 } },
};

describe('failure-safe MoveRequest / MoveResult', () => {
  it('builds the exact source identity and explicit keep-source choice', () => {
    expect(createMoveRequest({
      operationId: 'move-1', destinationId: 'office-tv', snapshot, keepSource: false,
    })).toEqual({
      operationId: 'move-1',
      sourceOwnerId: 'browser-a',
      sourceRevision: 12,
      destinationId: 'office-tv',
      snapshot,
      keepSource: false,
    });
  });

  it.each(['rejected', 'uncertain'])('does not stop the source when adoption is %s', async (status) => {
    const source = { stopIfCurrent: vi.fn() };
    const destination = { adopt: vi.fn().mockResolvedValue({ status, reason: 'not-confirmed' }) };
    const request = createMoveRequest({ operationId: 'move-1', destinationId: 'office-tv', snapshot, keepSource: false });

    const result = await executeMove(request, { source, destination });

    expect(result.status).toBe(status);
    expect(source.stopIfCurrent).not.toHaveBeenCalled();
  });

  it('does not stop a source whose revision advanced during destination adoption', async () => {
    let revision = 12;
    const source = {
      getIdentity: () => ({ sourceOwnerId: 'browser-a', sourceRevision: revision }),
      stopIfCurrent: vi.fn(),
    };
    const destination = { adopt: vi.fn().mockImplementation(async () => {
      revision += 1;
      return { status: 'adopted', destinationRevision: 4 };
    }) };
    const request = createMoveRequest({ operationId: 'move-1', destinationId: 'office-tv', snapshot, keepSource: false });

    const result = await executeMove(request, { source, destination });

    expect(result).toMatchObject({ status: 'adopted', sourceStopped: false, reason: 'source-changed' });
    expect(source.stopIfCurrent).not.toHaveBeenCalled();
  });

  it('keeps the source when requested even after confirmed adoption', async () => {
    const source = {
      getIdentity: () => ({ sourceOwnerId: 'browser-a', sourceRevision: 12 }),
      stopIfCurrent: vi.fn(),
    };
    const destination = { adopt: vi.fn().mockResolvedValue({ status: 'adopted', destinationRevision: 4 }) };
    const request = createMoveRequest({ operationId: 'move-1', destinationId: 'office-tv', snapshot, keepSource: true });

    const result = await executeMove(request, { source, destination });

    expect(result).toMatchObject({ status: 'adopted', sourceStopped: false });
    expect(source.stopIfCurrent).not.toHaveBeenCalled();
  });

  it('stops only the unchanged source after confirmed adoption', async () => {
    const source = {
      getIdentity: () => ({ sourceOwnerId: 'browser-a', sourceRevision: 12 }),
      stopIfCurrent: vi.fn().mockResolvedValue(true),
    };
    const destination = { adopt: vi.fn().mockResolvedValue({ status: 'adopted', destinationRevision: 4 }) };
    const request = createMoveRequest({ operationId: 'move-1', destinationId: 'office-tv', snapshot, keepSource: false });

    const result = await executeMove(request, { source, destination });

    expect(source.stopIfCurrent).toHaveBeenCalledWith({ sourceOwnerId: 'browser-a', sourceRevision: 12 });
    expect(result).toMatchObject({ status: 'adopted', sourceStopped: true });
  });
});
