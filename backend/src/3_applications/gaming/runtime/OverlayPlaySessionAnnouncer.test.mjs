import { describe, it, expect, beforeEach } from 'vitest';
import { OverlayPlaySessionAnnouncer } from './OverlayPlaySessionAnnouncer.mjs';

let calls;
const overlay = {
  arm: async (d, url) => { calls.push(['arm', d, url]); return true; },
  disarm: async (d) => { calls.push(['disarm', d]); return true; },
};
const session = { deviceId: 'tv', id: 'ps_1' };
const build = () => new OverlayPlaySessionAnnouncer({
  overlay, buildUrl: (d) => `https://host/arcade-film.html?device=${d}`, logger: { warn() {} },
});

beforeEach(() => { calls = []; });

describe('OverlayPlaySessionAnnouncer', () => {
  it('arms only once play is confirmed', async () => {
    await build().started(session);
    expect(calls).toEqual([['arm', 'tv', 'https://host/arcade-film.html?device=tv']]);
  });

  it('passes the device so one film cannot render another room', async () => {
    await build().started({ deviceId: 'garage-tv' });
    expect(calls[0][2]).toContain('device=garage-tv');
  });

  it('does nothing on progress — the film gets its data over the bus', async () => {
    await build().progress(session, { state: 'playing' });
    expect(calls).toEqual([]);
  });

  it('tears the overlay down when the session ends', async () => {
    await build().ended(session);
    expect(calls).toEqual([['disarm', 'tv']]);
  });

  it('re-asserts disarmed for idle devices at startup', async () => {
    await build().disarmIdle(['tv', 'other']);
    expect(calls).toEqual([['disarm', 'tv'], ['disarm', 'other']]);
  });

  it('one failing disarm does not stop the rest of the sweep', async () => {
    const flaky = {
      arm: async () => true,
      disarm: async (d) => { if (d === 'bad') throw new Error('offline'); calls.push(['disarm', d]); },
    };
    const a = new OverlayPlaySessionAnnouncer({ overlay: flaky, buildUrl: () => 'u', logger: { warn() {} } });
    await a.disarmIdle(['bad', 'good']);
    expect(calls).toEqual([['disarm', 'good']]);
  });

  it('requires its dependencies', () => {
    expect(() => new OverlayPlaySessionAnnouncer({ buildUrl: () => '' })).toThrow(/overlay/);
    expect(() => new OverlayPlaySessionAnnouncer({ overlay })).toThrow(/buildUrl/);
  });
});
