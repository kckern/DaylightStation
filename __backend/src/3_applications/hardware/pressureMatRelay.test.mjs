import { describe, expect, it, vi } from 'vitest';
import { createPressureMatRelay } from './pressureMatRelay.mjs';

function harness() {
  let listener = null;
  const pressureMatGateway = {
    subscribePresence(fn) { listener = fn; return vi.fn(); },
  };
  const dayLog = { append: vi.fn().mockResolvedValue('/tmp/mat.yml') };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const relay = createPressureMatRelay({ pressureMatGateway, dayLog, logger, timezone: 'America/Los_Angeles' });
  return { emit: (payload) => listener(payload), dayLog, logger, relay };
}

describe('pressureMatRelay completed-press observability', () => {
  it('persists and logs authoritative firmware peak metrics on release', async () => {
    const h = harness();
    h.emit({
      id: 'mat1', event: 'pressed', receivedAt: '2026-09-03T03:00:00.000Z',
      occupied: true, steps: 9, stomps: 2, voltage: 2.9, restVoltage: 3.1,
      deltaV: .2, gradientVps: -1.1, deviceTs: 1000,
    });
    h.emit({
      id: 'mat1', event: 'released', receivedAt: '2026-09-03T03:00:00.750Z',
      occupied: false, steps: 9, stomps: 3, voltage: 3.05, restVoltage: 3.1,
      deltaV: 0, gradientVps: .8, deviceTs: 1750,
      peakDeltaV: .82, peakGradientVps: 2.7, pressDurationMs: 750, classifiedStomp: true,
    });
    await h.relay.flush();

    expect(h.dayLog.append).toHaveBeenLastCalledWith('mat1', expect.objectContaining({
      event: 'released',
      peak_delta_v: .82,
      peak_gradient_vps: 2.7,
      press_duration_ms: 750,
      classified_stomp: true,
      metrics_source: 'firmware_summary',
    }));
    expect(h.logger.info).toHaveBeenCalledWith('pressure_mat.press.completed', expect.objectContaining({
      matId: 'mat1',
      peakDeltaV: .82,
      peakGradientVps: 2.7,
      pressDurationMs: 750,
      classifiedStomp: true,
      metricsSource: 'firmware_summary',
    }));
  });

  it('derives an explicitly labeled transition fallback for v1 firmware', async () => {
    const h = harness();
    h.emit({
      id: 'mat1', event: 'pressed', receivedAt: '2026-09-03T03:00:00.000Z',
      occupied: true, steps: 1, stomps: 0, voltage: 2.9, deltaV: .2, gradientVps: -1.1,
    });
    h.emit({
      id: 'mat1', event: 'stomped', receivedAt: '2026-09-03T03:00:00.300Z',
      occupied: true, steps: 1, stomps: 1, voltage: 2.4, deltaV: .7, gradientVps: -2.3,
    });
    h.emit({
      id: 'mat1', event: 'released', receivedAt: '2026-09-03T03:00:00.900Z',
      occupied: false, steps: 1, stomps: 1, voltage: 3.0, deltaV: 0, gradientVps: .9,
    });
    await h.relay.flush();

    expect(h.logger.info).toHaveBeenCalledWith('pressure_mat.press.completed', expect.objectContaining({
      peakDeltaV: .7,
      peakGradientVps: 2.3,
      pressDurationMs: 900,
      classifiedStomp: true,
      metricsSource: 'transition_fallback',
    }));
  });
});
