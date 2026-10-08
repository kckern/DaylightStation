import { describe, expect, it, vi } from 'vitest';
import { MediaSourceHealer } from './MediaSourceHealer.mjs';

const PATH = '/data/media/video/fitness/Max Built/Max Built - S01E03 - Back 1.mp4';

function probeSequence(...states) {
  const queue = [...states];
  return {
    probe: vi.fn(async () => {
      const state = queue.length > 1 ? queue.shift() : queue[0];
      return { state, path: PATH, title: 'Back 1', showTitle: 'Max Built' };
    }),
  };
}

function setup({ probe, hostHealer = null, notifier = null, config = {} } = {}) {
  let now = 1_000_000;
  const logger = { info: vi.fn(), warn: vi.fn() };
  const healer = new MediaSourceHealer({
    sourceProbe: probe,
    hostHealer,
    notifier,
    clock: () => now,
    logger,
    config,
  });
  return { healer, logger, advance: (ms) => { now += ms; } };
}

const events = (logger, name) => [...logger.info.mock.calls, ...logger.warn.mock.calls]
  .filter(([event]) => event === name)
  .map(([, data]) => data);

describe('MediaSourceHealer', () => {
  it('answers readable straight from Plex without touching the host', async () => {
    const hostHealer = { heal: vi.fn() };
    const { healer } = setup({ probe: probeSequence('readable'), hostHealer });
    const result = await healer.check('plex:696316');
    expect(result.state).toBe('readable');
    expect(hostHealer.heal).not.toHaveBeenCalled();
  });

  it('does not handle non-Plex content', async () => {
    const probe = probeSequence('readable');
    const { healer } = setup({ probe });
    expect((await healer.check('immich:abc')).state).toBe('unknown');
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('heals on the host, re-checks Plex, and records which rung fixed it', async () => {
    const hostHealer = { heal: vi.fn(async () => ({ ok: true, mode: '0', chmodApplied: true, readable: true, siblingsFixed: 57 })) };
    const { healer, logger } = setup({ probe: probeSequence('unreadable', 'readable'), hostHealer });

    const result = await healer.check('plex:696316', { deviceId: 'garage' });

    expect(hostHealer.heal).toHaveBeenCalledWith(PATH);
    expect(result.state).toBe('readable');
    expect(result.steps.map((s) => s.step)).toEqual(['plex-check', 'host-heal', 'plex-recheck']);
    expect(events(logger, 'media.source.heal.resolved')[0]).toMatchObject({ resolvedBy: 'host-chmod', chmodCount: 1 });
  });

  it('keeps reporting unreadable, rate-limits the host rung, and alerts once after the threshold', async () => {
    const hostHealer = { heal: vi.fn(async () => ({ ok: true, mode: '777', chmodApplied: false, readable: false })) };
    const notifier = { send: vi.fn(async () => ({})) };
    const { healer, advance, logger } = setup({
      probe: probeSequence('unreadable'),
      hostHealer,
      notifier,
      config: { hostHealCooldownMs: 20_000, alertAfterMs: 120_000 },
    });

    const first = await healer.check('plex:696316');
    expect(first.state).toBe('unreadable');
    expect(first.unreadableMs).toBe(0);
    expect(hostHealer.heal).toHaveBeenCalledTimes(1);

    advance(5_000);
    await healer.check('plex:696316');
    expect(hostHealer.heal).toHaveBeenCalledTimes(1); // inside the cooldown

    advance(20_000);
    await healer.check('plex:696316');
    expect(hostHealer.heal).toHaveBeenCalledTimes(2);
    expect(notifier.send).not.toHaveBeenCalled();

    advance(100_000);
    const late = await healer.check('plex:696316');
    expect(late.unreadableMs).toBe(125_000);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send.mock.calls[0][0]).toMatchObject({ title: 'A video won\'t open', category: 'system' });
    expect(notifier.send.mock.calls[0][0].body).toContain('"Back 1" (Max Built)');

    advance(60_000);
    await healer.check('plex:696316');
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(events(logger, 'media.source.heal.opened')).toHaveLength(1);
  });

  it('closes the episode when the file comes back by itself', async () => {
    const { healer, advance, logger } = setup({ probe: probeSequence('unreadable', 'readable') });
    await healer.check('plex:696316');
    advance(30_000);
    const result = await healer.check('plex:696316');
    expect(result.state).toBe('readable');
    expect(events(logger, 'media.source.heal.resolved')[0]).toMatchObject({ resolvedBy: 'plex-check', unreadableMs: 30_000 });
  });

  it('shares one run between concurrent checks of the same file', async () => {
    let release;
    const probe = { probe: vi.fn(() => new Promise((resolve) => { release = () => resolve({ state: 'readable' }); })) };
    const { healer } = setup({ probe });
    const a = healer.check('plex:696316');
    const b = healer.check('696316');
    release();
    await Promise.all([a, b]);
    expect(probe.probe).toHaveBeenCalledTimes(1);
  });

  it('treats a failing Plex probe as unknown without closing an open episode', async () => {
    const probe = { probe: vi.fn() };
    probe.probe
      .mockResolvedValueOnce({ state: 'unreadable', path: PATH, title: 'Back 1' })
      .mockRejectedValueOnce(new Error('Media API request failed'));
    const { healer, logger } = setup({ probe });
    await healer.check('plex:696316');
    const result = await healer.check('plex:696316');
    expect(result.state).toBe('unknown');
    expect(result.unreadableSince).toBeDefined();
    expect(events(logger, 'media.source.heal.resolved')).toHaveLength(0);
  });

  it('skips a host healer that is not configured', async () => {
    const hostHealer = { heal: vi.fn(), isConfigured: () => false };
    const { healer } = setup({ probe: probeSequence('unreadable'), hostHealer });
    await healer.check('plex:696316');
    expect(hostHealer.heal).not.toHaveBeenCalled();
  });
  describe('container ids (2026-10-07: the queue ROOT was asked about)', () => {
    it('passes a no-metadata reason through so screens can tell a deleted item from an outage', async () => {
      const probe = { probe: vi.fn(async () => ({ state: 'unknown', reason: 'no-metadata', path: null })) };
      const { healer } = setup({ probe });
      expect(await healer.check('plex:1', {})).toMatchObject({ state: 'unknown', reason: 'no-metadata' });
    });

    it('answers not-a-leaf and logs heal.not-a-leaf instead of a silent unknown', async () => {
      const probe = { probe: vi.fn(async () => ({ state: 'unknown', reason: 'not-a-leaf', itemType: 'show', title: 'Bluey', path: null })) };
      const hostHealer = { heal: vi.fn() };
      const { healer, logger } = setup({ probe, hostHealer });
      const result = await healer.check('plex:59493');
      expect(result).toMatchObject({ state: 'unknown', reason: 'not-a-leaf' });
      expect(hostHealer.heal).not.toHaveBeenCalled();
      expect(events(logger, 'media.source.heal.not-a-leaf')[0]).toMatchObject({ ratingKey: '59493', itemType: 'show' });
    });
  });

  describe('proxy-observed refusal (origin: proxy)', () => {
    const hostOk = () => ({ heal: vi.fn(async () => ({ ok: true, mode: '777', chmodApplied: false, cacheRefreshed: true, readable: true })) });

    it('runs the host ctime refresh even though Plex says readable, then re-checks', async () => {
      const hostHealer = hostOk();
      const probe = probeSequence('readable');
      const { healer, logger } = setup({ probe, hostHealer });
      const result = await healer.check('plex:59546', { origin: 'proxy' });
      expect(hostHealer.heal).toHaveBeenCalledWith(PATH);
      expect(result.state).toBe('readable');
      expect(result.steps.map((s) => s.step)).toEqual(['plex-check', 'host-heal', 'plex-recheck']);
      expect(events(logger, 'media.source.heal.proxy-refresh')[0]).toMatchObject({ ratingKey: '59546', cacheRefreshed: true });
    });

    it('does not refresh for an ordinary (player) check that reads readable', async () => {
      const hostHealer = hostOk();
      const { healer } = setup({ probe: probeSequence('readable'), hostHealer });
      await healer.check('plex:59546');
      expect(hostHealer.heal).not.toHaveBeenCalled();
    });

    it('rate-limits the proxy refresh per file (60 s), and allows it again after', async () => {
      const hostHealer = hostOk();
      const { healer, advance } = setup({ probe: probeSequence('readable'), hostHealer });
      await healer.check('plex:59546', { origin: 'proxy' });
      advance(30_000);
      await healer.check('plex:59546', { origin: 'proxy' });
      expect(hostHealer.heal).toHaveBeenCalledTimes(1);
      advance(31_000);
      await healer.check('plex:59546', { origin: 'proxy' });
      expect(hostHealer.heal).toHaveBeenCalledTimes(2);
      // a different file is not limited by the first
      await healer.check('plex:11111', { origin: 'proxy' });
      expect(hostHealer.heal).toHaveBeenCalledTimes(3);
    });

    it('a flood of distinct ids cannot evict live cooldowns: a full map refuses new refreshes', async () => {
      const hostHealer = hostOk();
      const { healer } = setup({ probe: probeSequence('readable'), hostHealer });
      for (let i = 1; i <= 500; i += 1) await healer.check(`plex:${i}`, { origin: 'proxy' });
      expect(hostHealer.heal).toHaveBeenCalledTimes(500);
      await healer.check('plex:501', { origin: 'proxy' }); // map full of live cooldowns
      expect(hostHealer.heal).toHaveBeenCalledTimes(500);
      await healer.check('plex:1', { origin: 'proxy' }); // plex:1 was NOT evicted: still cooling down
      expect(hostHealer.heal).toHaveBeenCalledTimes(500);
    });

    it('still answers readable when no host healer is configured', async () => {
      const { healer } = setup({ probe: probeSequence('readable') });
      expect((await healer.check('plex:59546', { origin: 'proxy' })).state).toBe('readable');
    });
  });
});
