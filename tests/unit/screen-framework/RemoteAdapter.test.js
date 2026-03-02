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

import { RemoteAdapter } from '../../../frontend/src/screen-framework/input/adapters/RemoteAdapter.js';

describe('RemoteAdapter logging', () => {
  let adapter;
  let mockBus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    vi.clearAllMocks();
    mockBus = { emit: vi.fn() };
  });

  it('logs attach with keyboardId at info level', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ Enter: { function: 'escape' } });
    adapter = new RemoteAdapter(mockBus, { keyboardId: 'test-kb', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'remote.attach',
      expect.objectContaining({ keyboardId: 'test-kb' })
    );
    adapter.destroy();
  });

  it('logs keymap fetch failure with warn (not console.warn)', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    adapter = new RemoteAdapter(mockBus, { keyboardId: 'broken', fetchFn: fakeFetch });
    await adapter.attach();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'remote.keymap-fetch-failed',
      expect.objectContaining({ keyboardId: 'broken' })
    );
    // Must NOT use console.warn
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    adapter.destroy();
  });

  it('logs mapped key dispatch at debug level', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({});
    adapter = new RemoteAdapter(mockBus, { keyboardId: 'kb1', fetchFn: fakeFetch });
    await adapter.attach();

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    window.dispatchEvent(event);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'remote.key',
      expect.objectContaining({ key: 'ArrowUp', action: 'navigate' })
    );
    adapter.destroy();
  });
});
