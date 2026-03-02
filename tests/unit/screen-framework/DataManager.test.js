import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

vi.mock('../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => mockLogger,
  getLogger: () => mockLogger,
}));

import { DataManager } from '../../../frontend/src/screen-framework/data/DataManager.js';

describe('DataManager logging', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DataManager();
  });

  afterEach(() => {
    manager.destroy();
    vi.restoreAllMocks();
  });

  it('logs fetch failure via structured logger (not console.error)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    const cb = vi.fn();
    manager.subscribe('/api/test', cb);

    // Wait for async fetch to complete
    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        'datamanager.fetch-failed',
        expect.objectContaining({ source: '/api/test' })
      );
    });

    expect(consoleSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('logs successful fetch at debug level', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    }));

    const cb = vi.fn();
    manager.subscribe('/api/test', cb);

    await vi.waitFor(() => {
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'datamanager.fetched',
        expect.objectContaining({ source: '/api/test' })
      );
    });

    vi.unstubAllGlobals();
  });
});
