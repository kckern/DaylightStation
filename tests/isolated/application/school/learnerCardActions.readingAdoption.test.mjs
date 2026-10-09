/**
 * A card scanned while the child's book is already playing ADOPTS the story.
 *
 * 2026-09-30: the child's session died to a cold TV, his re-tapped book played with
 * nobody's name on it, and his card at 0:12 tore the story down and made him
 * pick it again — from 0:00. The card should have claimed the running story.
 *
 * The server's half is small and these tests pin it: when content is playing
 * AND the last thing dispatched at this reader was an unclaimed book, the card
 * asks the TV to adopt it instead of refusing (D2) or taking the room (the
 * reclaim exemption). The TV proves the rest.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ReadingSessionService as ProductionReadingSessionService, ADOPTABLE_PLAY_MS,
} from '#apps/school/ReadingSessionService.mjs';
import { makeReadingSessionHandler } from '#apps/school/workflows/LearnerCardActions.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const TEST_SCHEDULER = { withDeadline: (work) => work, every: () => () => {}, wait: async () => {} };
class ReadingSessionService extends ProductionReadingSessionService {
  constructor(config = {}) { super({ scheduler: TEST_SCHEDULER, ...config }); }
}

function rig({ playing = true, scheduler = TEST_SCHEDULER, repeatCheck = null } = {}) {
  const state = { now: Date.parse('2026-09-30T18:31:36Z') };
  const clock = () => new Date(state.now);
  const sent = [];
  const logs = [];
  const logger = {
    info: (event, data) => logs.push({ level: 'info', event, data }),
    warn: (event, data) => logs.push({ level: 'warn', event, data }),
    error: (event, data) => logs.push({ level: 'error', event, data }),
    debug() {},
  };
  const realtime = {
    readingRoomChanged: (location, { kind, ...payload }) => sent.push({ event: kind, location, ...payload }),
  };
  const sessions = new ReadingSessionService({ realtime, logger: silent, clock, scheduler });
  const woke = [];
  const handler = makeReadingSessionHandler({
    sessions,
    isPlaying: typeof playing === 'function' ? playing : () => playing,
    wakeScreen: async (args) => { woke.push(args); return { ok: true }; },
    studyDay: () => '2026-09-30',
    repeatCheck,
    realtime, clock, logger,
  });
  return {
    sessions, handler, sent, logs, woke,
    tick: (ms) => { state.now += ms; },
    bookPlayed: (contentId = 'plex:674736') => sessions.noteUnclaimedPlay('livingroom', { contentId, target: 'livingroom-tv' }),
    tap: (learnerId = 'user_7') => handler({ learnerId, location: 'livingroom', target: 'livingroom-tv' }),
  };
}

describe('a learner card while their book is already playing', () => {
  it('offers adoption instead of refusing — the field case, 17s after the book', async () => {
    const r = rig();
    r.bookPlayed();
    r.tick(17_000);
    const result = await r.tap();
    expect(result).toMatchObject({ status: 'reading_session_adopting', learnerId: 'user_7', contentId: 'plex:674736' });
    const present = r.sent.find((m) => m.event === 'session-present');
    expect(present).toMatchObject({ reason: 'adopt', adopt: { contentId: 'plex:674736', studyDay: '2026-09-30' } });
    expect(r.sent.some((m) => m.event === 'session-refused')).toBe(false);
  });

  it('does not wake or foreground the TV — it is on and playing the story', async () => {
    const r = rig();
    r.bookPlayed();
    await r.tap();
    expect(r.woke).toEqual([]);
  });

  it('D2 is unchanged when nothing unclaimed was dispatched here — a movie is a movie', async () => {
    const r = rig();
    const result = await r.tap();
    expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
    expect(r.sessions.current('livingroom')).toBeNull();
  });

  it('does not adopt a book dispatched longer ago than ADOPTABLE_PLAY_MS', async () => {
    const r = rig();
    r.bookPlayed();
    r.tick(ADOPTABLE_PLAY_MS + 1);
    const result = await r.tap();
    expect(result.status).toBe('reading_session_refused');
  });

  it('does not offer adoption when nothing is playing — an ordinary session opens', async () => {
    const r = rig({ playing: false });
    r.bookPlayed();
    const result = await r.tap();
    expect(result.status).toBe('reading_session_presenting');
    expect(r.sent.find((m) => m.event === 'session-present')?.reason).toBe('initial');
  });

  it('the TV ACK commits confirm with the adopted, server-minted pick', async () => {
    const r = rig();
    r.bookPlayed();
    await r.tap();
    const pending = r.sessions.current('livingroom').pendingPresentation;
    r.sessions.acknowledge('livingroom', pending);
    expect(r.sessions.current('livingroom')).toMatchObject({
      state: 'confirm', pick: { pickId: pending.adopt.pickId, learnerId: 'user_7', adopted: true },
    });
  });

  it('a second child s card while the adoption is pending is refused and changes nothing', async () => {
    const r = rig();
    r.bookPlayed();
    await r.tap('user_7');
    const before = r.sessions.current('livingroom');
    const result = await r.tap('user_3');
    expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'not-at-launch-card' });
    expect(r.sessions.current('livingroom').pendingPresentation.presentationId).toBe(before.pendingPresentation.presentationId);
  });

  it('an unacknowledged adoption closes as adopt-unacknowledged, and a re-tap offers it again', async () => {
    const scheduler = { withDeadline: async () => { throw new Error('deadline'); }, every: () => () => {}, wait: async () => {} };
    const r = rig({ scheduler });
    r.bookPlayed();
    await r.tap();
    await vi.waitFor(() => expect(r.sessions.current('livingroom')).toBeNull());
    expect(r.sessions.recentlyClosed('livingroom')).toMatchObject({ reason: 'adopt-unacknowledged' });
    expect(r.logs.some((l) => l.event === 'school.reading.adoption-unacknowledged')).toBe(true);
    const again = await r.tap();
    expect(again.status).toBe('reading_session_adopting');
  });
});

describe('a failed adoption does not cost the child the room (review I1, M1)', () => {
  it('after a declined adoption, the child who lost the room to a cold TV is let back in, not refused', async () => {
    const r = rig();
    r.sessions.open({ location: 'livingroom', learnerId: 'user_7', target: 'livingroom-tv' });
    r.sessions.close('livingroom', { reason: 'presentation-unacknowledged' });
    r.bookPlayed();
    await r.tap();
    const pending = r.sessions.current('livingroom').pendingPresentation;
    r.sessions.declineAdoption('livingroom', pending.presentationId, 'content-mismatch');
    const again = await r.tap();
    expect(again.status).not.toBe('reading_session_refused');
    expect(r.logs.some((l) => l.event === 'school.reading.refusal-exempted')).toBe(true);
  });

  it('a declined adoption stops the ACK loop quietly — no adoption-unacknowledged error', async () => {
    // First wait: resolves when the decline's close releases the waiter.
    // Every later wait: an immediate deadline. The old loop replayed into the
    // closed room and then logged an ERROR for an adoption declined correctly.
    let calls = 0;
    const scheduler = {
      withDeadline: async (work) => { calls += 1; if (calls === 1) return work; throw new Error('deadline'); },
      every: () => () => {}, wait: async () => {},
    };
    const r = rig({ scheduler });
    r.bookPlayed();
    await r.tap();
    const pending = r.sessions.current('livingroom').pendingPresentation;
    r.sessions.declineAdoption('livingroom', pending.presentationId, 'content-mismatch');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.logs.some((l) => l.event === 'school.reading.adoption-unacknowledged')).toBe(false);
    expect(r.sent.filter((m) => m.event === 'session-present')).toHaveLength(1);
  });
});


describe('a learner card while a RECENTLY READ book is playing', () => {
  it('does not adopt it: the book is refused read-recently and nothing is credited', async () => {
    const r = rig({ repeatCheck: async () => ({ refuse: true, lastReadOn: '2026-09-28', today: '2026-09-30', noRepeatDays: 4 }) });
    r.bookPlayed();
    const result = await r.tap();
    expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'read-recently' });
    expect(r.sessions.current('livingroom')).toBeNull();
    expect(r.sent.find((m) => m.event === 'book-refused')).toMatchObject({ reason: 'read-recently', lastReadOn: '2026-09-28' });
    expect(r.logs.some((l) => l.event === 'school.reading.adoption-skipped')).toBe(true);
  });
  it('adopts normally when the check allows or throws (fail open)', async () => {
    const ok = rig({ repeatCheck: async () => ({ refuse: false }) });
    ok.bookPlayed();
    expect(await ok.tap()).toMatchObject({ status: 'reading_session_adopting' });
    const boom = rig({ repeatCheck: async () => { throw new Error('x'); } });
    boom.bookPlayed();
    expect(await boom.tap()).toMatchObject({ status: 'reading_session_adopting' });
  });
});
