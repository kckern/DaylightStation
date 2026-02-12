import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resetActionBus, getActionBus } from './ActionBus.js';
import { useScreenAction } from './useScreenAction.js';

describe('useScreenAction', () => {
  beforeEach(() => { resetActionBus(); });
  afterEach(() => { resetActionBus(); });

  it('should subscribe to the action on mount', () => {
    const handler = vi.fn();
    renderHook(() => useScreenAction('navigate', handler));

    getActionBus().emit('navigate', { direction: 'up' });
    expect(handler).toHaveBeenCalledWith({ direction: 'up' });
  });

  it('should unsubscribe on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useScreenAction('select', handler));
    unmount();

    getActionBus().emit('select', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not subscribe if action is null', () => {
    const handler = vi.fn();
    renderHook(() => useScreenAction(null, handler));

    getActionBus().emit('navigate', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not subscribe if handler is null', () => {
    renderHook(() => useScreenAction('navigate', null));

    // Should not throw
    getActionBus().emit('navigate', {});
  });
});
