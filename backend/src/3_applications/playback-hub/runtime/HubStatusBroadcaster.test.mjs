import { describe, expect, it, vi } from 'vitest';
import { HubStatusBroadcaster } from './HubStatusBroadcaster.mjs';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSleeper() {
  const waits = [];
  return {
    wait: vi.fn(() => new Promise((resolve) => waits.push(resolve))),
    release() {
      const resolve = waits.shift();
      if (!resolve) throw new Error('No pending broadcaster sleep');
      resolve();
    },
  };
}

describe('HubStatusBroadcaster outage reporting', () => {
  it('warns once for an outage, probes quietly, and reports recovery', async () => {
    const sleeper = makeSleeper();
    const gateway = {
      getStatus: vi.fn()
        .mockRejectedValueOnce(new Error('hub offline'))
        .mockRejectedValueOnce(new Error('hub offline'))
        .mockResolvedValueOnce([]),
    };
    const logger = { warn: vi.fn(), debug: vi.fn(), info: vi.fn() };
    const broadcaster = new HubStatusBroadcaster({
      gateway,
      eventPublisher: { publish: vi.fn() },
      logger,
      intervalMs: 10,
      maxBackoffMs: 100,
      sleepFn: sleeper.wait,
    });

    broadcaster.start();
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('playback-hub.broadcaster.offline', expect.objectContaining({ nextProbeMs: 20 }));
    expect(sleeper.wait).toHaveBeenCalledWith(20);

    sleeper.release();
    await flush();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith('playback-hub.broadcaster.recovery_probe_failed', expect.objectContaining({ consecutiveFailures: 2, nextProbeMs: 40 }));

    sleeper.release();
    await flush();
    expect(logger.info).toHaveBeenCalledWith('playback-hub.broadcaster.recovered', { consecutiveFailures: 2, deviceCount: 0 });

    const stopping = broadcaster.stop();
    sleeper.release();
    await stopping;
  });
});
