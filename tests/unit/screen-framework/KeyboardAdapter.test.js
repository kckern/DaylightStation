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

import { KeyboardAdapter } from '../../../frontend/src/screen-framework/input/adapters/KeyboardAdapter.js';

describe('KeyboardAdapter logging', () => {
  let adapter;
  let mockBus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    vi.clearAllMocks();
    mockBus = { emit: vi.fn() };
    adapter = new KeyboardAdapter(mockBus);
  });

  it('logs attach at info level', () => {
    adapter.attach();
    expect(mockLogger.info).toHaveBeenCalledWith('keyboard.attach', expect.any(Object));
    adapter.destroy();
  });

  it('logs mapped key at debug level', () => {
    adapter.attach();
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
    window.dispatchEvent(event);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'keyboard.key',
      expect.objectContaining({ key: 'ArrowUp', action: 'navigate' })
    );
    adapter.destroy();
  });

  it('logs unmapped key at debug level', () => {
    adapter.attach();
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    window.dispatchEvent(event);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'keyboard.unmapped',
      expect.objectContaining({ key: 'a' })
    );
    adapter.destroy();
  });

  it('logs destroy', () => {
    adapter.attach();
    adapter.destroy();
    expect(mockLogger.debug).toHaveBeenCalledWith('keyboard.destroy', expect.any(Object));
  });
});
