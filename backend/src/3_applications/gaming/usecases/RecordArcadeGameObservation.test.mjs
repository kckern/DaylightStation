import { describe, it, expect, beforeEach } from 'vitest';
import { RecordArcadeGameObservation } from './RecordArcadeGameObservation.mjs';
import { ArcadeGameSessionState } from '#domains/gaming/value-objects/ArcadeGameSessionState.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const GAME_A = { contentId: 'game:a', title: 'Game A' };
const GAME_B = { contentId: 'game:b', title: 'Game B' };

class FakeSessions {
  constructor() { this.saved = []; this.byId = new Map(); }
  async save(session) { this.byId.set(session.id, session); this.saved.push(session.toSnapshot()); }
  async findById(id) { return this.byId.get(id) || null; }
  async findOpenForDevice(deviceId) {
    for (const s of this.byId.values()) if (s.deviceId === deviceId && !s.isEnded()) return s;
    return null;
  }
}

class FakeAnnouncer {
  constructor() { this.calls = []; }
  async started(s) { this.calls.push(['started', s.id]); }
  async progress(s) { this.calls.push(['progress', s.id]); }
  async ended(s) { this.calls.push(['ended', s.id]); }
}

let sessions, announcer, useCase, n;
const observe = (state, secs, content = GAME_A) => useCase.execute({
  deviceId: 'livingroom-tv', surface: 'console-emulator', userId: 'test-learner',
  observation: { state, observedAt: at(secs), confidenceMs: 10_000, content },
});

beforeEach(() => {
  sessions = new FakeSessions();
  announcer = new FakeAnnouncer();
  n = 0;
  useCase = new RecordArcadeGameObservation({
    sessions, announcer, newSessionId: () => `ps_${++n}`, trustedGapMs: 25_000,
  });
});

describe('RecordArcadeGameObservation — opening', () => {
  it('opens nothing while the device is not playing', async () => {
    const r = await observe(ArcadeGameSessionState.PAUSED, 0);
    expect(r.session).toBeNull();
    expect(await sessions.findOpenForDevice('livingroom-tv')).toBeNull();
  });

  it('opens and starts on a confirmed playing observation', async () => {
    const r = await observe(ArcadeGameSessionState.PLAYING, 0);
    expect(r.started).toBe(true);
    expect(r.session.userId).toBe('test-learner');
    expect(r.session.content.contentId).toBe('game:a');
    expect(announcer.calls).toEqual([['started', 'ps_1']]);
  });

  it('opens a loaded hand-started game even before content is identified', async () => {
    const r = await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: {
        state: ArcadeGameSessionState.PLAYING,
        loaded: true,
        loadId: 'retroarch__2026_09_11__20_00_00.log',
        loadedAt: at(-30),
        observedAt: at(0),
        content: null,
      },
    });
    expect(r.started).toBe(true);
    expect(r.session.content).toBeNull();
    expect(r.session.loadId).toBe('retroarch__2026_09_11__20_00_00.log');
    expect(r.session.loadedAt).toBe(at(-30));
    expect(r.session.startedAt).toBe(at(0));
  });

  it('does not turn an explicit unknown load state into loaded just because content is named', async () => {
    const r = await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: {
        state: ArcadeGameSessionState.PLAYING, loaded: null, observedAt: at(0), content: GAME_A,
      },
    });
    expect(r.session).toBeNull();
  });
});

describe('RecordArcadeGameObservation — accruing', () => {
  it('accrues only across observed play', async () => {
    await observe(ArcadeGameSessionState.PLAYING, 0);
    await observe(ArcadeGameSessionState.PLAYING, 10);
    await observe(ArcadeGameSessionState.PAUSED, 20);
    await observe(ArcadeGameSessionState.PLAYING, 30);
    const r = await observe(ArcadeGameSessionState.PLAYING, 40);
    expect(r.session.playedMs).toBe(20_000);
  });
});

describe('RecordArcadeGameObservation — unknown is inert', () => {
  it('neither opens nor bills nor ends on unknown', async () => {
    const none = await observe(ArcadeGameSessionState.UNKNOWN, 0);
    expect(none.session).toBeNull();

    await observe(ArcadeGameSessionState.PLAYING, 10);
    await observe(ArcadeGameSessionState.PLAYING, 20);
    const r = await observe(ArcadeGameSessionState.UNKNOWN, 30);
    expect(r.session.isEnded()).toBe(false);
    expect(r.session.playedMs).toBe(10_000);
    expect(r.accruedMs).toBe(0);
  });

  it('does not end a session just because the watcher went blind', async () => {
    await observe(ArcadeGameSessionState.PLAYING, 0);
    await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: { state: ArcadeGameSessionState.UNKNOWN, observedAt: at(10), content: null },
    });
    expect((await sessions.findOpenForDevice('livingroom-tv'))?.isEnded()).toBe(false);
  });
});

describe('RecordArcadeGameObservation — ending and switching', () => {
  it('ends the session when nothing is loaded any more', async () => {
    await observe(ArcadeGameSessionState.PLAYING, 0);
    await observe(ArcadeGameSessionState.PLAYING, 10);
    const r = await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: { state: ArcadeGameSessionState.PAUSED, loaded: false, observedAt: at(20), content: null },
    });
    expect(r.ended.isEnded()).toBe(true);
    expect(r.ended.playedMs).toBe(10_000);
    expect(announcer.calls).toContainEqual(['ended', 'ps_1']);
  });

  it('ends on a definitive unload even when play-versus-pause is unknown', async () => {
    await observe(ArcadeGameSessionState.PLAYING, 0);
    const r = await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: { state: ArcadeGameSessionState.UNKNOWN, loaded: false, observedAt: at(10), content: null },
    });
    expect(r.ended?.isEnded()).toBe(true);
    expect(await sessions.findOpenForDevice('livingroom-tv')).toBeNull();
  });

  it('switching games ends one session and starts another', async () => {
    await observe(ArcadeGameSessionState.PLAYING, 0);
    await observe(ArcadeGameSessionState.PLAYING, 10);
    const r = await observe(ArcadeGameSessionState.PLAYING, 20, GAME_B);
    expect(r.switched).toBe(true);
    expect(r.ended.content.contentId).toBe('game:a');
    expect(r.ended.playedMs).toBe(10_000);
    expect(r.session.content.contentId).toBe('game:b');
    expect(r.session.playedMs).toBe(0);   // time never carries across titles
    expect(r.started).toBe(true);
  });

  it('keeps an unidentified loaded game open while paused', async () => {
    await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: {
        state: ArcadeGameSessionState.PLAYING, loaded: true, loadId: 'load-a', loadedAt: at(-10),
        observedAt: at(0), content: null,
      },
    });
    const r = await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: {
        state: ArcadeGameSessionState.PAUSED, loaded: true, loadId: 'load-a', loadedAt: at(-10),
        observedAt: at(10), content: null,
      },
    });
    expect(r.ended).toBeNull();
    expect(r.session.isEnded()).toBe(false);
  });

  it('uses load identity to split two unidentified hand-started games', async () => {
    await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: { state: ArcadeGameSessionState.PLAYING, loaded: true, loadId: 'load-a', observedAt: at(0) },
    });
    const r = await useCase.execute({
      deviceId: 'livingroom-tv', surface: 'console-emulator',
      observation: { state: ArcadeGameSessionState.PLAYING, loaded: true, loadId: 'load-b', observedAt: at(10) },
    });
    expect(r.switched).toBe(true);
    expect(r.ended.endReason).toBe('switched');
    expect(r.session.loadId).toBe('load-b');
  });
});

describe('RecordArcadeGameObservation — resilience', () => {
  it('a failing announcer never loses the session', async () => {
    const broken = { started: async () => { throw new Error('bus down'); },
                     progress: async () => { throw new Error('bus down'); },
                     ended: async () => { throw new Error('bus down'); } };
    const uc = new RecordArcadeGameObservation({
      sessions, announcer: broken, newSessionId: () => 'ps_x', trustedGapMs: 25_000, logger: { warn(){}, info(){} },
    });
    const r = await uc.execute({
      deviceId: 'd1', surface: 'console-emulator',
      observation: { state: ArcadeGameSessionState.PLAYING, observedAt: at(0), content: GAME_A },
    });
    expect(r.started).toBe(true);
    expect(await sessions.findOpenForDevice('d1')).not.toBeNull();
  });

  it('credits only the trusted window when the observer goes quiet', async () => {
    await observe(ArcadeGameSessionState.PLAYING, 0);
    const r = await observe(ArcadeGameSessionState.PLAYING, 3600);
    expect(r.accruedMs).toBe(25_000);
    expect(r.session.playedMs).toBe(25_000);
  });
});
