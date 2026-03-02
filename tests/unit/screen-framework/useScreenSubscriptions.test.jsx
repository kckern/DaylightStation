import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

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

// Mock useWebSocketSubscription to capture the handler
let capturedHandler = null;
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: vi.fn((topics, handler) => {
    capturedHandler = handler;
  }),
}));

import { useScreenSubscriptions } from '../../../frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js';

describe('useScreenSubscriptions logging', () => {
  let showOverlay;
  let dismissOverlay;
  let widgetRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    showOverlay = vi.fn();
    dismissOverlay = vi.fn();
    widgetRegistry = new Map();
  });

  it('logs when WS message topic does not match any subscription', () => {
    const subscriptions = {
      midi: { on: { event: 'start' }, response: { overlay: 'piano' } },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'unknown-topic', event: 'start' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'subscription.no-match',
      expect.objectContaining({ messageTopic: 'unknown-topic' })
    );
  });

  it('logs when overlay widget is not found in registry', () => {
    const subscriptions = {
      midi: { on: { event: 'start' }, response: { overlay: 'missing-widget' } },
    };
    // Don't register 'missing-widget' in widgetRegistry

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'midi', event: 'start' });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'subscription.widget-not-found',
      expect.objectContaining({ overlay: 'missing-widget', topic: 'midi' })
    );
  });

  it('logs successful overlay show', () => {
    const FakeWidget = () => null;
    widgetRegistry.set('piano', FakeWidget);
    const subscriptions = {
      midi: { on: { event: 'start' }, response: { overlay: 'piano', mode: 'fullscreen' } },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'midi', event: 'start' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'subscription.show-overlay',
      expect.objectContaining({ topic: 'midi', overlay: 'piano', mode: 'fullscreen' })
    );
  });

  it('logs dismiss event', () => {
    const subscriptions = {
      midi: {
        on: { event: 'start' },
        response: { overlay: 'piano' },
        dismiss: { event: 'stop' },
      },
    };

    renderHook(() => useScreenSubscriptions(subscriptions, showOverlay, dismissOverlay, widgetRegistry));

    capturedHandler({ topic: 'midi', event: 'stop' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'subscription.dismiss',
      expect.objectContaining({ topic: 'midi', dismissEvent: 'stop' })
    );
  });
});
