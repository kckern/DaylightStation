import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const logged = [];
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({
    info: (e, d) => logged.push(['info', e, d]),
    warn: (e, d) => logged.push(['warn', e, d]),
    debug: (e, d) => logged.push(['debug', e, d]),
    sampled: (e, d) => logged.push(['sampled', e, d]),
  }) }),
}));

import { useScoreTelemetry } from './useScoreTelemetry.js';

beforeEach(() => { logged.length = 0; });

describe('useScoreTelemetry', () => {
  it('emits score.load with phase breakdown', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logLoad({ fetchMs: 10, parseMs: 5, engraveMs: 200, extractMs: 80, totalMs: 300, steps: 40, measures: 12, staves: 2, osmdWarm: true }));
    const ev = logged.find(([, e]) => e === 'score.load');
    expect(ev[2]).toMatchObject({ id: 'x', engraveMs: 200, totalMs: 300 });
  });

  it('emits a stall warn when a fire drifts past threshold, and a stats rollup', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => { result.current.recordFire({ step: 3 }, 200, 60, 90); });
    expect(logged.some(([lvl, e]) => lvl === 'warn' && e === 'score.playback.stall')).toBe(true);
    act(() => result.current.flushPlayback('play'));
    const stats = logged.find(([, e]) => e === 'score.playback.stats');
    expect(stats[2]).toMatchObject({ mode: 'play', maxDriftMs: 200, stalls: 1 });
  });
});
