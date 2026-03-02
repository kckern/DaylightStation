import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../frontend/src/lib/logging/Logger.js', () => {
  const child = vi.fn(() => mockLogger);
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  };
  return { default: () => mockLogger, getLogger: () => mockLogger };
});

import { NumpadAdapter } from '../../../frontend/src/screen-framework/input/adapters/NumpadAdapter.js';

describe('NumpadAdapter logging', () => {
  let adapter;
  let mockBus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    vi.clearAllMocks();
    mockBus = { emit: vi.fn() };
  });

  it('warns on keymap fetch failure via logger (not console.warn)', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    adapter = new NumpadAdapter(mockBus, { keyboardId: 'broken', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'numpad.keymap-fetch-failed',
      expect.objectContaining({ keyboardId: 'broken' })
    );
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    adapter.destroy();
  });

  it('logs attach with keyboardId', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ '1': { function: 'menu', params: 'main' } });
    adapter = new NumpadAdapter(mockBus, { keyboardId: 'numpad1', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'numpad.attach',
      expect.objectContaining({ keyboardId: 'numpad1' })
    );
    adapter.destroy();
  });
});
