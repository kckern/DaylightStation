import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => { const l = { info, debug() {}, warn() {}, error() {}, child: () => l }; return { getLogger: () => l, default: () => l }; });

import { useRenderFpsMonitor } from './useRenderFpsMonitor.js';

// Drive requestAnimationFrame by hand: 60 frames per simulated second.
let queue = [];
let now = 0;
beforeEach(() => {
  info.mockClear(); queue = []; now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function runFrames(n) {
  for (let i = 0; i < n; i++) { now += 1000 / 60; const cbs = queue; queue = []; cbs.forEach((cb) => cb(now)); }
}

describe('useRenderFpsMonitor', () => {
  it('reports frames while the element plays', () => {
    const el = { paused: false, ended: false };
    renderHook(() => useRenderFpsMonitor({ enabled: true, telemetryIntervalMs: 1000, getMediaEl: () => el }));
    runFrames(180);
    expect(info).toHaveBeenCalledWith('playback.render_fps', expect.any(Object));
  });

  it('reports nothing while the element is paused, even if the player says it is not', () => {
    const el = { paused: true, ended: false }; // e.g. stuck at 0:00 behind "Tap to Retry"
    renderHook(() => useRenderFpsMonitor({ enabled: true, telemetryIntervalMs: 1000, getMediaEl: () => el }));
    runFrames(180);
    expect(info).not.toHaveBeenCalled();
  });
});
