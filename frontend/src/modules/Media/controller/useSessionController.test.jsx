import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { PeekContext } from '../peek/PeekContext.js';
import { useSessionController } from './useSessionController.js';
import { createMockController } from './mockController.js';

describe('useSessionController', () => {
  it('returns snapshot + method groups for target="local"', () => {
    const controller = createMockController({ kind: 'local', id: 'c1' });
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ controller }}>{children}</LocalSessionContext.Provider>
    );
    const { result } = renderHook(() => useSessionController('local'), { wrapper });
    expect(result.current.snapshot.state).toBe('idle');
    expect(typeof result.current.transport.play).toBe('function');
    expect(typeof result.current.queue.playNow).toBe('function');
  });

  it('re-renders with a fresh snapshot when the controller notifies', () => {
    const controller = createMockController({ kind: 'local', id: 'c1' });
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ controller }}>{children}</LocalSessionContext.Provider>
    );
    const { result } = renderHook(() => useSessionController('local'), { wrapper });
    act(() => { result.current.config.setVolume(77); });
    expect(result.current.snapshot.config.volume).toBe(77);
  });

  it('routes {deviceId} targets through PeekContext.getController', () => {
    const remote = createMockController({ kind: 'remote', id: 'lr' });
    remote.queue.playNow({ contentId: 'z:9', title: 'Z' });
    const wrapper = ({ children }) => (
      <PeekContext.Provider value={{ getController: (id) => (id === 'lr' ? remote : null) }}>
        {children}
      </PeekContext.Provider>
    );
    const { result } = renderHook(() => useSessionController({ deviceId: 'lr' }), { wrapper });
    expect(result.current.snapshot.currentItem.contentId).toBe('z:9');
    expect(typeof result.current.transport.play).toBe('function');
  });

  it('returns a null snapshot when the remote controller is not yet known', () => {
    const wrapper = ({ children }) => (
      <PeekContext.Provider value={{ getController: () => null }}>{children}</PeekContext.Provider>
    );
    const { result } = renderHook(() => useSessionController({ deviceId: 'ghost' }), { wrapper });
    expect(result.current.snapshot).toBeNull();
  });

  it('throws for invalid targets', () => {
    const controller = createMockController();
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ controller }}>{children}</LocalSessionContext.Provider>
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSessionController(42), { wrapper })).toThrow();
    spy.mockRestore();
  });
});
