import { describe, it, expect } from 'vitest';
import { createStreamTransferMeter, PROGRESS_EVERY_MS, MIN_LOGGED_DURATION_MS } from './streamTransferMeter.mjs';

describe('streamTransferMeter', () => {
  it('reports overall kbps and the share of time the client held the upstream back', () => {
    let t = 0;
    const m = createStreamTransferMeter({ now: () => t });
    m.data(1_000_000); t = 10_000;
    m.pause(); t = 30_000; m.resume();   // client could not take more for 20 s
    m.data(500_000); t = 40_000;
    const s = m.summary({ completed: true });
    expect(s).toEqual({ bytes: 1_500_000, durationMs: 40_000, kbps: 300, backpressurePct: 50, completed: true });
  });

  it('emits windowed progress every PROGRESS_EVERY_MS, counting a pause still open', () => {
    let t = 0;
    const m = createStreamTransferMeter({ now: () => t });
    m.data(3_000_000);
    t = PROGRESS_EVERY_MS - 1;
    expect(m.progressIfDue()).toBeNull();
    m.pause();
    t = PROGRESS_EVERY_MS + 15_000 - 1; // hmm: progress due once t - last >= 30s
    const row = m.progressIfDue();
    expect(row.windowKbps).toBe(Math.round((3_000_000 * 8) / t));
    expect(row.windowBackpressurePct).toBe(Math.round(((t - (PROGRESS_EVERY_MS - 1)) / t) * 100));
    // The next window starts empty.
    t += PROGRESS_EVERY_MS;
    expect(m.progressIfDue().windowKbps).toBe(0);
  });

  it('a short, small transfer (seek probe) is not worth a row', () => {
    let t = 0;
    const m = createStreamTransferMeter({ now: () => t });
    m.data(200_000); t = MIN_LOGGED_DURATION_MS - 1;
    expect(m.summary({ completed: false })).toBeNull();
  });
});
