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
});
