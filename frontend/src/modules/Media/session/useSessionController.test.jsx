import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PeekContext } from '../peek/PeekProvider.jsx';
import { useSessionController } from './useSessionController.js';

function makeAdapter() {
  let snap = { state: 'idle', config: { volume: 50 } };
  const subs = new Set();
  return {
    getSnapshot: () => snap,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    transport: { play: () => {}, pause: () => {}, stop: () => {}, seekAbs: () => {}, seekRel: () => {}, skipNext: () => {}, skipPrev: () => {} },
    queue: { playNow: () => {}, playNext: () => {}, addUpNext: () => {}, add: () => {}, clear: () => {}, remove: () => {}, jump: () => {}, reorder: () => {} },
    config: { setShuffle: () => {}, setRepeat: () => {}, setShader: () => {}, setVolume: (v) => { snap = { ...snap, config: { ...snap.config, volume: v } }; subs.forEach(f => f(snap)); } },
    lifecycle: { reset: () => {}, adoptSnapshot: () => {} },
    portability: { snapshotForHandoff: () => ({}), receiveClaim: () => {} },
  };
}

describe('useSessionController', () => {
  it('returns snapshot + methods for target="local"', () => {
    const adapter = makeAdapter();
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ adapter }}>{children}</LocalSessionContext.Provider>
    );
    const { result } = renderHook(() => useSessionController('local'), { wrapper });
    expect(result.current.snapshot.state).toBe('idle');
    expect(typeof result.current.transport.play).toBe('function');
    expect(typeof result.current.queue.playNow).toBe('function');
  });

  it('re-renders with a fresh snapshot when adapter notifies', () => {
    const adapter = makeAdapter();
    const wrapper = ({ children }) => (
      <LocalSessionContext.Provider value={{ adapter }}>{children}</LocalSessionContext.Provider>
    );
    const { result } = renderHook(() => useSessionController('local'), { wrapper });
    expect(result.current.snapshot.config.volume).toBe(50);
    act(() => { result.current.config.setVolume(77); });
    expect(result.current.snapshot.config.volume).toBe(77);
  });

  it('routes {deviceId} targets through PeekProvider getAdapter', () => {
    const fakeAdapter = {
      getSnapshot: () => ({ state: 'playing', config: { volume: 60 } }),
      transport: { play: vi.fn() },
      queue: {}, config: {}, lifecycle: {}, portability: {},
    };
    const wrapper = ({ children }) => (
      <PeekContext.Provider value={{ getAdapter: () => fakeAdapter, activePeeks: new Map(), enterPeek: vi.fn(), exitPeek: vi.fn() }}>
        {children}
      </PeekContext.Provider>
    );
    const { result } = renderHook(() => useSessionController({ deviceId: 'lr' }), { wrapper });
    expect(result.current.snapshot.state).toBe('playing');
    expect(typeof result.current.transport.play).toBe('function');
  });

  it('returns null snapshot when remote adapter is not yet known', () => {
    const wrapper = ({ children }) => (
      <PeekContext.Provider value={{ getAdapter: () => null, activePeeks: new Map(), enterPeek: vi.fn(), exitPeek: vi.fn() }}>
        {children}
      </PeekContext.Provider>
    );
    const { result } = renderHook(() => useSessionController({ deviceId: 'ghost' }), { wrapper });
    expect(result.current.snapshot).toBeNull();
  });
});
