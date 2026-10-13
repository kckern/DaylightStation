import { describe, expect, it, vi } from 'vitest';
import { LibbyIdentityRenewalService, startIdentityRenewal } from './LibbyIdentityRenewalService.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function fixture({ remainingMs = 7 * DAY, renewIdentity } = {}) {
  const snapshot = { token: 'current-token', chipId: 'chip-id', expiresAt: NOW + remainingMs };
  const credentials = {
    getSnapshot: vi.fn(() => snapshot),
    persist: vi.fn(async () => {}),
  };
  const client = {
    renewIdentity: renewIdentity
      ?? vi.fn(async () => ({ identity: 'renewed-token', expiresAt: NOW + 7 * DAY })),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new LibbyIdentityRenewalService({
    credentials, client, logger, now: () => NOW,
  });
  return { service, credentials, client, logger };
}

describe('LibbyIdentityRenewalService', () => {
  it('leaves a freshly issued identity alone and reports when it next falls due', async () => {
    const { service, client, credentials } = fixture({ remainingMs: 7 * DAY });

    const result = await service.renewIfDue();

    expect(result.status).toBe('skipped');
    expect(client.renewIdentity).not.toHaveBeenCalled();
    expect(credentials.persist).not.toHaveBeenCalled();
    expect(service.msUntilDue()).toBe(DAY);
  });

  it('renews and persists once remaining life falls below the threshold', async () => {
    const { service, client, credentials } = fixture({ remainingMs: 5 * DAY });

    const result = await service.renewIfDue();

    expect(result.status).toBe('renewed');
    expect(client.renewIdentity).toHaveBeenCalledTimes(1);
    expect(credentials.persist).toHaveBeenCalledWith('renewed-token');
    expect(service.msUntilDue()).toBe(0);
  });

  it('collapses concurrent triggers into a single provider renewal', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const renewIdentity = vi.fn(async () => {
      await gate;
      return { identity: 'renewed-token', expiresAt: NOW + 7 * DAY };
    });
    const { service, credentials } = fixture({ remainingMs: 5 * DAY, renewIdentity });

    const inFlight = [service.renewIfDue(), service.renewIfDue(), service.renewIfDue()];
    release();
    await Promise.all(inFlight);

    expect(renewIdentity).toHaveBeenCalledTimes(1);
    expect(credentials.persist).toHaveBeenCalledTimes(1);
  });

  it('reports a provider failure without throwing and leaves the credential untouched', async () => {
    const renewIdentity = vi.fn(async () => { throw new Error('provider exploded'); });
    const { service, credentials, logger } = fixture({ remainingMs: 5 * DAY, renewIdentity });

    const result = await service.renewIfDue();

    expect(result.status).toBe('failed');
    expect(credentials.persist).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('never writes token material into its logs', async () => {
    const { service, logger } = fixture({ remainingMs: 5 * DAY });

    await service.renewIfDue();

    const emitted = JSON.stringify([logger.info.mock.calls, logger.debug.mock.calls, logger.warn.mock.calls]);
    expect(emitted).not.toContain('renewed-token');
    expect(emitted).not.toContain('current-token');
  });
});

describe('startIdentityRenewal', () => {
  function scheduler() {
    const armed = [];
    return {
      armed,
      setTimeout: vi.fn((fn, delay) => { armed.push({ fn, delay }); return { unref() {} }; }),
      clearTimeout: vi.fn(),
      async fireLast() { await armed[armed.length - 1].fn(); },
    };
  }

  it('arms from the service deadline and re-arms after renewing', async () => {
    const clock = scheduler();
    const service = {
      msUntilDue: vi.fn().mockReturnValueOnce(5_000).mockReturnValue(90_000),
      renewIfDue: vi.fn(async () => ({ status: 'renewed' })),
    };

    startIdentityRenewal({ service, scheduler: clock });
    expect(clock.armed[0].delay).toBe(5_000);

    await clock.fireLast();
    expect(service.renewIfDue).toHaveBeenCalledTimes(1);
    expect(clock.armed[1].delay).toBe(90_000);
  });

  it('backs off instead of hot-looping when renewal keeps failing', async () => {
    const clock = scheduler();
    const service = {
      msUntilDue: vi.fn(() => 0), // permanently overdue, e.g. provider rejecting us
      renewIfDue: vi.fn(async () => ({ status: 'failed' })),
    };

    startIdentityRenewal({ service, scheduler: clock, retryFloorMs: 60_000 });
    expect(clock.armed[0].delay).toBe(0);

    await clock.fireLast();
    expect(clock.armed[1].delay).toBe(60_000);
  });

  it('caps a long sleep so an externally replaced token is still noticed', () => {
    const clock = scheduler();
    const service = { msUntilDue: () => 30 * 24 * 60 * 60 * 1000, renewIfDue: vi.fn() };

    startIdentityRenewal({ service, scheduler: clock, maxDelayMs: 6 * 60 * 60 * 1000 });

    expect(clock.armed[0].delay).toBe(6 * 60 * 60 * 1000);
  });

  it('stops re-arming once disposed', async () => {
    const clock = scheduler();
    const service = { msUntilDue: () => 1_000, renewIfDue: vi.fn(async () => ({ status: 'renewed' })) };

    const stop = startIdentityRenewal({ service, scheduler: clock });
    stop();
    await clock.fireLast();

    expect(clock.clearTimeout).toHaveBeenCalled();
    expect(clock.armed).toHaveLength(1);
  });
});
