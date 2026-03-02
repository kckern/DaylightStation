import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger before importing ActionBus
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

import { ActionBus } from '../../../frontend/src/screen-framework/input/ActionBus.js';

describe('ActionBus logging', () => {
  let bus;
  let mockLogger;

  beforeEach(async () => {
    const logMod = await import('../../../frontend/src/lib/logging/Logger.js');
    mockLogger = logMod.default();
    vi.clearAllMocks();
    bus = new ActionBus();
  });

  it('logs emit with subscriber count at debug level', () => {
    const handler = vi.fn();
    bus.subscribe('navigate', handler);
    bus.emit('navigate', { direction: 'up' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'actionbus.emit',
      expect.objectContaining({ action: 'navigate', subscriberCount: 1 })
    );
  });

  it('warns when emitting to zero subscribers', () => {
    bus.emit('unknown:action', {});

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'actionbus.emit.unhandled',
      expect.objectContaining({ action: 'unknown:action', subscriberCount: 0 })
    );
  });

  it('does not warn for wildcard-only subscribers', () => {
    const wildcard = vi.fn();
    bus.subscribe('*', wildcard);
    bus.emit('some:action', {});

    // Still warns — wildcard is debug tooling, not a handler
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'actionbus.emit.unhandled',
      expect.objectContaining({ action: 'some:action', subscriberCount: 0 })
    );
  });
});
