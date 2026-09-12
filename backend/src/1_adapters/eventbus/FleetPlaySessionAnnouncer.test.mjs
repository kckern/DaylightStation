import { describe, it, expect, beforeEach } from 'vitest';
import { FleetPlaySessionAnnouncer } from './FleetPlaySessionAnnouncer.mjs';
import { CompositePlaySessionAnnouncer } from './CompositePlaySessionAnnouncer.mjs';
import { validateSessionSnapshot } from '#shared-contracts/media/shapes.mjs';
import { PlaySession } from '#domains/gaming/entities/PlaySession.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

function playing(playedSec = 0) {
  const s = PlaySession.open({
    id: 'ps_1', deviceId: 'livingroom-tv', surface: 'console-emulator', userId: 'test-learner',
    content: { contentId: 'retroarch:gb/test', title: 'Test Game' }, trustedGapMs: 25_000,
  });
  s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
  if (playedSec) s.observe({ state: PlayState.PLAYING, observedAt: at(playedSec) });
  return s;
}

let published;
const bus = { broadcast: (topic, payload) => published.push([topic, payload]) };
const announcer = () => new FleetPlaySessionAnnouncer({ eventBus: bus, logger: { warn() {} } });
beforeEach(() => { published = []; });

describe('FleetPlaySessionAnnouncer', () => {
  it('publishes on the same device-state topic the fleet already renders', async () => {
    await announcer().started(playing());
    expect(published[0][0]).toBe('device-state:livingroom-tv');
  });

  it('emits a snapshot the shared media contract accepts', async () => {
    await announcer().started(playing(30));
    // Asserted unconditionally: a hedged check here would pass even if the
    // projection stopped being renderable, which is the one thing it is for.
    expect(typeof validateSessionSnapshot).toBe('function');
    expect(validateSessionSnapshot(published[0][1])).toEqual({ valid: true, errors: [] });
    expect(published[0][1]).toMatchObject({
      sessionId: 'ps_1', state: 'playing',
      currentItem: { contentId: 'retroarch:gb/test', format: 'game', title: 'Test Game' },
    });
  });

  it('reports position as seconds of ACTUAL play, not wall clock', async () => {
    const session = playing(0);
    session.observe({ state: PlayState.PAUSED, observedAt: at(10) });
    session.observe({ state: PlayState.PLAYING, observedAt: at(600) });
    session.observe({ state: PlayState.PLAYING, observedAt: at(615) });
    await announcer().progress(session, { state: 'playing' });
    // 615s of wall clock, 15s actually played.
    expect(published[0][1].position).toBe(15);
  });

  it('maps a paused observation to paused', async () => {
    await announcer().progress(playing(10), { state: 'paused' });
    expect(published[0][1].state).toBe('paused');
  });

  it('validates in every state the fleet will see, not just the first', async () => {
    const a = announcer();
    const s = playing(10);
    await a.progress(s, { state: 'paused' });
    s.end({ endedAt: at(20), reason: 'quit' });
    await a.ended(s);
    for (const [, snapshot] of published) {
      expect(validateSessionSnapshot(snapshot)).toEqual({ valid: true, errors: [] });
    }
  });

  it('goes idle with no current item when the session ends', async () => {
    const s = playing(10);
    s.end({ endedAt: at(20), reason: 'quit' });
    await announcer().ended(s);
    expect(published[0][1]).toMatchObject({ state: 'idle', currentItem: null });
  });

  it('never throws when the bus rejects a broadcast', async () => {
    const a = new FleetPlaySessionAnnouncer({
      eventBus: { broadcast: () => { throw new Error('bus down'); } }, logger: { warn() {} },
    });
    await expect(a.started(playing())).resolves.toBeUndefined();
  });
});

describe('CompositePlaySessionAnnouncer', () => {
  it('fans one fact out to every announcer', async () => {
    const calls = [];
    const mk = (n) => ({ started: async () => calls.push(n), progress: async () => {}, ended: async () => {} });
    await new CompositePlaySessionAnnouncer({ announcers: [mk('a'), mk('b')] }).started(playing());
    expect(calls).toEqual(['a', 'b']);
  });

  it('one failing announcer does not stop the others', async () => {
    const calls = [];
    const broken = { started: async () => { throw new Error('down'); } };
    const good = { started: async () => calls.push('good') };
    await new CompositePlaySessionAnnouncer({ announcers: [broken, good], logger: { warn() {} } }).started(playing());
    expect(calls).toEqual(['good']);
  });
});
