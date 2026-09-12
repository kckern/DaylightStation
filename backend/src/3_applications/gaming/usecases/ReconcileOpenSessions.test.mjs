import { describe, it, expect, beforeEach } from 'vitest';
import { ReconcileOpenSessions } from './ReconcileOpenSessions.mjs';
import { PlaySession } from '#domains/gaming/entities/PlaySession.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const quiet = { info() {}, warn() {} };

class FakeSessions {
  constructor() { this.open = new Map(); }
  async findOpenForDevice(d) { const s = this.open.get(d); return s && !s.isEnded() ? s : null; }
  async save(s) { this.open.set(s.deviceId, s); }
  seed(deviceId, lastObservedSec) {
    const s = PlaySession.open({ id: `ps_${deviceId}`, deviceId, surface: 'console-emulator', content: { contentId: 'g' }, trustedGapMs: 25_000 });
    s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
    s.observe({ state: PlayState.PLAYING, observedAt: at(lastObservedSec) });
    this.open.set(deviceId, s);
    return s;
  }
}

let sessions, useCase;
beforeEach(() => {
  sessions = new FakeSessions();
  useCase = new ReconcileOpenSessions({ sessions, logger: quiet });
});

describe('ReconcileOpenSessions', () => {
  it('resumes a session that is still fresh — a quick restart must not orphan play', async () => {
    const s = sessions.seed('livingroom-tv', 20);
    const r = await useCase.execute({ deviceIds: ['livingroom-tv'], now: at(45), staleAfterMs: 60_000 });
    expect(r.resumed).toEqual(['ps_livingroom-tv']);
    expect(r.lost).toEqual([]);
    expect(s.isEnded()).toBe(false);
    expect(s.playedMs).toBe(20_000);   // accumulated time survives the restart
  });

  it('closes a stale session as lost', async () => {
    const s = sessions.seed('livingroom-tv', 20);
    const r = await useCase.execute({ deviceIds: ['livingroom-tv'], now: at(3600), staleAfterMs: 60_000 });
    expect(r.lost).toEqual(['ps_livingroom-tv']);
    expect(s.isEnded()).toBe(true);
    expect(s.endReason).toBe('lost');
    expect(s.playedMs).toBe(20_000);   // settles with what was actually witnessed
  });

  it('does nothing for devices with no open session', async () => {
    const r = await useCase.execute({ deviceIds: ['art-panel'], now: at(10), staleAfterMs: 60_000 });
    expect(r).toEqual({ resumed: [], lost: [] });
  });

  it('a broken read on one device does not stop the others', async () => {
    sessions.seed('other-tv', 20);
    const original = sessions.findOpenForDevice.bind(sessions);
    sessions.findOpenForDevice = async (d) => {
      if (d === 'bad-tv') throw new Error('corrupt');
      return original(d);
    };
    const r = await useCase.execute({ deviceIds: ['bad-tv', 'other-tv'], now: at(3600), staleAfterMs: 60_000 });
    expect(r.lost).toEqual(['ps_other-tv']);
  });

  it('announces the ending so consumers see the settlement', async () => {
    const calls = [];
    const uc = new ReconcileOpenSessions({ sessions, announcer: { ended: async (s) => calls.push(s.id) }, logger: quiet });
    sessions.seed('livingroom-tv', 20);
    await uc.execute({ deviceIds: ['livingroom-tv'], now: at(3600), staleAfterMs: 60_000 });
    expect(calls).toEqual(['ps_livingroom-tv']);
  });

  it('a failing announcer never blocks the settlement', async () => {
    const uc = new ReconcileOpenSessions({ sessions, announcer: { ended: async () => { throw new Error('bus down'); } }, logger: quiet });
    const s = sessions.seed('livingroom-tv', 20);
    await uc.execute({ deviceIds: ['livingroom-tv'], now: at(3600), staleAfterMs: 60_000 });
    expect(s.isEnded()).toBe(true);
  });
});
