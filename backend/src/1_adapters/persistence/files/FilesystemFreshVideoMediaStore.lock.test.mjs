// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  closeFileDescriptor: vi.fn(),
  deleteFile: vi.fn(),
  ensureDir: vi.fn(),
  fileExists: vi.fn(() => false),
  getStats: vi.fn(),
  listEntries: vi.fn(() => []),
  openFileExclusive: vi.fn(() => 41),
  writeToFileDescriptor: vi.fn(),
}));

vi.mock('#system/utils/FileIO.mjs', () => io);

import { FilesystemFreshVideoMediaStore } from './FilesystemFreshVideoMediaStore.mjs';

describe('FilesystemFreshVideoMediaStore run lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    io.fileExists.mockReturnValue(false);
    io.openFileExclusive.mockReturnValue(41);
  });

  it('preserves the lock path and JSON record shape', () => {
    const store = new FilesystemFreshVideoMediaStore({ mediaRoot: '/media' });
    const release = store.acquireRunLock('worker-7', 60_000, '2026-08-28T20:00:00.000Z');

    expect(io.openFileExclusive).toHaveBeenCalledWith('/media/freshvideo.lock');
    expect(io.writeToFileDescriptor).toHaveBeenCalledWith(41, JSON.stringify({
      pid: 'worker-7',
      ts: '2026-08-28T20:00:00.000Z',
    }));
    expect(io.closeFileDescriptor).toHaveBeenCalledWith(41);
    expect(release).toBeTypeOf('function');
    release();
    expect(io.deleteFile).toHaveBeenCalledWith('/media/freshvideo.lock');
  });

  it('closes the descriptor when writing the lock record fails', () => {
    io.writeToFileDescriptor.mockImplementation(() => { throw new Error('disk write failed'); });
    const store = new FilesystemFreshVideoMediaStore({ mediaRoot: '/media' });

    expect(store.acquireRunLock('worker-7', 60_000, '2026-08-28T20:00:00.000Z')).toBeNull();
    expect(io.closeFileDescriptor).toHaveBeenCalledTimes(1);
    expect(io.closeFileDescriptor).toHaveBeenCalledWith(41);
  });
});
