import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useScreenSubscriptions } from './useScreenSubscriptions.js';

// Capture the callback passed to useWebSocketSubscription so tests can invoke it
let capturedFilter = null;
let capturedCallback = null;

vi.mock('../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (filter, callback) => {
    capturedFilter = filter;
    capturedCallback = callback;
  },
}));

describe('useScreenSubscriptions', () => {
  let showOverlay;
  let dismissOverlay;
  let widgetRegistry;
  const FakePiano = () => <div>Piano</div>;

  beforeEach(() => {
    capturedFilter = null;
    capturedCallback = null;
    showOverlay = vi.fn();
    dismissOverlay = vi.fn();
    widgetRegistry = {
      get: vi.fn((name) => {
        if (name === 'piano') return FakePiano;
        return null;
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderSubscriptions(config) {
    return renderHook(() =>
      useScreenSubscriptions(config, showOverlay, dismissOverlay, widgetRegistry)
    );
  }

  it('subscribes to topics declared in config', () => {
    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen' },
      },
    };

    renderSubscriptions(config);

    expect(capturedFilter).toEqual(['midi']);
  });

  it('subscribes to multiple topics', () => {
    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen' },
      },
      fitness: {
        response: { overlay: 'piano', mode: 'pip' },
      },
    };

    renderSubscriptions(config);

    expect(capturedFilter).toEqual(['midi', 'fitness']);
  });

  it('passes null filter when config is empty', () => {
    renderSubscriptions({});

    expect(capturedFilter).toBeNull();
  });

  it('passes null filter when config is undefined', () => {
    renderSubscriptions(undefined);

    expect(capturedFilter).toBeNull();
  });

  it('filters by on.event when present', () => {
    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen', priority: 'high' },
      },
    };

    renderSubscriptions(config);

    // Send a non-matching event
    act(() => {
      capturedCallback({ topic: 'midi', event: 'note_on' });
    });
    expect(showOverlay).not.toHaveBeenCalled();

    // Send the matching event
    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_start' });
    });
    expect(showOverlay).toHaveBeenCalledTimes(1);
    expect(showOverlay).toHaveBeenCalledWith(
      FakePiano,
      { topic: 'midi', event: 'session_start' },
      { mode: 'fullscreen', priority: 'high', timeout: undefined }
    );
  });

  it('triggers on any message when no on.event filter', () => {
    const config = {
      midi: {
        response: { overlay: 'piano', mode: 'fullscreen' },
      },
    };

    renderSubscriptions(config);

    act(() => {
      capturedCallback({ topic: 'midi', event: 'anything' });
    });
    expect(showOverlay).toHaveBeenCalledTimes(1);

    act(() => {
      capturedCallback({ topic: 'midi', event: 'something_else' });
    });
    expect(showOverlay).toHaveBeenCalledTimes(2);
  });

  it('calls dismissOverlay when dismiss event received', () => {
    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen' },
        dismiss: { event: 'session_end' },
      },
    };

    renderSubscriptions(config);

    // Trigger the overlay first
    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_start' });
    });
    expect(showOverlay).toHaveBeenCalledTimes(1);

    // Send dismiss event
    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_end' });
    });
    expect(dismissOverlay).toHaveBeenCalledTimes(1);
    expect(dismissOverlay).toHaveBeenCalledWith('fullscreen');
  });

  it('dismisses with the correct mode', () => {
    const config = {
      midi: {
        response: { overlay: 'piano', mode: 'pip' },
        dismiss: { event: 'session_end' },
      },
    };

    renderSubscriptions(config);

    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_end' });
    });
    expect(dismissOverlay).toHaveBeenCalledWith('pip');
  });

  it('does not show overlay if widget not in registry', () => {
    const config = {
      midi: {
        response: { overlay: 'nonexistent', mode: 'fullscreen' },
      },
    };

    renderSubscriptions(config);

    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_start' });
    });
    expect(showOverlay).not.toHaveBeenCalled();
    expect(widgetRegistry.get).toHaveBeenCalledWith('nonexistent');
  });

  it('ignores messages for topics not in config', () => {
    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen' },
      },
    };

    renderSubscriptions(config);

    act(() => {
      capturedCallback({ topic: 'fitness', event: 'session_start' });
    });
    expect(showOverlay).not.toHaveBeenCalled();
  });

  it('handles inactivity dismiss timer', () => {
    vi.useFakeTimers();

    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen' },
        dismiss: { inactivity: 5 },
      },
    };

    renderSubscriptions(config);

    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_start' });
    });
    expect(showOverlay).toHaveBeenCalledTimes(1);
    expect(dismissOverlay).not.toHaveBeenCalled();

    // Advance time past inactivity threshold
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(dismissOverlay).toHaveBeenCalledTimes(1);
    expect(dismissOverlay).toHaveBeenCalledWith('fullscreen');

    vi.useRealTimers();
  });

  it('resets inactivity timer on new trigger event', () => {
    vi.useFakeTimers();

    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen' },
        dismiss: { inactivity: 5 },
      },
    };

    renderSubscriptions(config);

    // First trigger
    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_start' });
    });

    // Advance 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(dismissOverlay).not.toHaveBeenCalled();

    // Retrigger (resets timer)
    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_start' });
    });

    // Advance another 3 seconds (6 total from first, 3 from second)
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(dismissOverlay).not.toHaveBeenCalled();

    // Advance to 5 seconds from second trigger
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(dismissOverlay).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('clears inactivity timer on dismiss event', () => {
    vi.useFakeTimers();

    const config = {
      midi: {
        on: { event: 'session_start' },
        response: { overlay: 'piano', mode: 'fullscreen' },
        dismiss: { event: 'session_end', inactivity: 5 },
      },
    };

    renderSubscriptions(config);

    // Trigger overlay (starts inactivity timer)
    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_start' });
    });

    // Dismiss via event before inactivity fires
    act(() => {
      capturedCallback({ topic: 'midi', event: 'session_end' });
    });
    expect(dismissOverlay).toHaveBeenCalledTimes(1);

    // Advance past inactivity - should NOT dismiss again
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(dismissOverlay).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('defaults mode to fullscreen when not specified in response', () => {
    const config = {
      midi: {
        response: { overlay: 'piano' },
      },
    };

    renderSubscriptions(config);

    act(() => {
      capturedCallback({ topic: 'midi', event: 'anything' });
    });
    expect(showOverlay).toHaveBeenCalledWith(
      FakePiano,
      { topic: 'midi', event: 'anything' },
      { mode: 'fullscreen', priority: undefined, timeout: undefined }
    );
  });

  it('passes timeout option for toast mode', () => {
    const config = {
      midi: {
        response: { overlay: 'piano', mode: 'toast', timeout: 5000 },
      },
    };

    renderSubscriptions(config);

    act(() => {
      capturedCallback({ topic: 'midi', event: 'note_on' });
    });
    expect(showOverlay).toHaveBeenCalledWith(
      FakePiano,
      { topic: 'midi', event: 'note_on' },
      { mode: 'toast', priority: undefined, timeout: 5000 }
    );
  });
});
