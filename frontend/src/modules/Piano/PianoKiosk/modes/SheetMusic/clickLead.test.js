import { describe, it, expect, vi } from 'vitest';

const info = vi.hoisted(() => vi.fn());
vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info }) }) }));

import { resolveClickLead, logClickAnchored } from './clickLead.js';

const ctx = (extra = {}) => ({ outputLatency: 0.04, baseLatency: 0.01, ...extra });

describe('resolveClickLead', () => {
  it('config wins over everything, and still reports what the browser says', () => {
    expect(resolveClickLead({ timing: { clickLeadMs: 280 } }, ctx())).toEqual({
      leadMs: 280, source: 'config', outputLatencyMs: 40, baseLatencyMs: 10,
    });
  });

  it('a configured 0 is a measurement, not a gap', () => {
    expect(resolveClickLead({ timing: { clickLeadMs: 0 } }, ctx()).source).toBe('config');
  });

  it('browser = (outputLatency + baseLatency) × 1000 when the context has no output timestamp', () => {
    expect(resolveClickLead({ timing: { clickLeadMs: null } }, ctx())).toEqual({
      leadMs: 50, source: 'browser', outputLatencyMs: 40, baseLatencyMs: 10,
    });
  });

  it('no browser lead when getOutputTimestamp exists — the scheduler mapping already applied it', () => {
    const r = resolveClickLead({ timing: { clickLeadMs: null } }, ctx({ getOutputTimestamp: () => ({}) }));
    expect(r).toEqual({ leadMs: 0, source: 'none', outputLatencyMs: 40, baseLatencyMs: 10 });
  });

  it('none when nothing is known', () => {
    expect(resolveClickLead(null, null)).toEqual({ leadMs: 0, source: 'none', outputLatencyMs: null, baseLatencyMs: null });
    expect(resolveClickLead({}, { outputLatency: 0, baseLatency: 0 }).source).toBe('none');
  });
});

describe('logClickAnchored', () => {
  it('emits piano.click.anchored with lead, source, latencies and anchor', () => {
    info.mockClear();
    const data = logClickAnchored({ leadMs: 280, source: 'config', outputLatencyMs: 40, baseLatencyMs: 10 }, { anchorMs: 123, bpm: 120 });
    expect(info).toHaveBeenCalledWith('piano.click.anchored', {
      leadMs: 280, source: 'config', outputLatencyMs: 40, baseLatencyMs: 10, anchorMs: 123, bpm: 120,
    });
    expect(data.anchorMs).toBe(123);
  });
});
