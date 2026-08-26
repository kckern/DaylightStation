/**
 * The reading-session content interceptor — the one place the assignment /
 * browsing split actually lands in code.
 *
 * Two modes, one differing cell: a book tapped MID-STORY. Assignment claims it
 * and refuses it ("finish this one first"); browsing does not claim it at all,
 * and the existing preempt / on-deck queue applies unchanged.
 */
import { describe, it, expect } from 'vitest';
import { ReadingSessionService } from '#apps/school/ReadingSessionService.mjs';
import { ReadingSessionInterceptor } from '#apps/school/readingSessionInterceptor.mjs';
// Through the REAL seam, not a stand-in for it: the two halves shipped in
// separate commits and only this pair proves they meet.
import { responseHandlers } from '#apps/trigger/responseHandlers.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

const bookTap = (over = {}) => ({
  kind: 'content',
  target: 'livingroom-tv',
  location: 'livingroom',
  expression: { action: 'play-next', contentId: 'plex:620681', options: {} },
  posture: 'authoritative',
  ...over,
});

/** Enrolled, one of two stories read → assignment mode. */
const owing = { status: async () => ({ error: false, count: 1, target: 2, doneToday: false }) };
/** Enrolled and finished → browsing mode. */
const finished = { status: async () => ({ error: false, count: 2, target: 2, doneToday: true }) };
/** No story-time enrollment at all → browsing mode. A NORMAL answer, not an error (D1). */
const notEnrolled = {
  status: async () => ({ error: false, enrolled: false, count: null, target: null, doneToday: false }),
};
/** The enrollment or the log could not be READ. Not the same thing as not enrolled. */
const unreadable = {
  status: async () => ({ error: true, enrolled: null, count: null, target: null, doneToday: false }),
};

function build({ storyTime = owing, sessions = new ReadingSessionService({ logger: silent }) } = {}) {
  const sent = [];
  const interceptor = new ReadingSessionInterceptor({
    sessions,
    storyTime,
    eventBus: { broadcast: (topic, payload) => sent.push({ topic, payload }) },
    logger: silent,
  });
  return { interceptor, sessions, sent };
}

describe('ReadingSessionInterceptor — no session', () => {
  it('does NOT claim when no session is open — a book tapped by a grown-up still just plays', async () => {
    const { interceptor } = build();
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('does NOT claim a tap at a different location', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'study', learnerId: 'learner-c' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('does NOT claim a response carrying no location at all', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(await interceptor.claim(bookTap({ location: undefined }))).toBeNull();
  });

  it('does NOT claim a non-content response', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(await interceptor.claim({ kind: 'device', target: 't', location: 'livingroom' })).toBeNull();
  });
});

describe('ReadingSessionInterceptor — a book at the prompt', () => {
  it('claims a book tap when a session is open and nothing is playing', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(await interceptor.claim(bookTap())).toMatchObject({ claimed: true, by: 'reading-session' });
  });

  it('carries the learner and the content id in the broadcast', async () => {
    const { interceptor, sessions, sent } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    await interceptor.claim(bookTap());
    const selected = sent.find((m) => m.payload.event === 'book-selected');
    expect(selected).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:620681' },
    });
  });

  it('moves the session to confirm and records the pick', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    await interceptor.claim(bookTap());
    expect(sessions.current('livingroom')).toMatchObject({
      state: 'confirm', pick: { contentId: 'plex:620681' },
    });
  });

  // Browsing is only relaxed MID-STORY. At the prompt the session still owns
  // the screen, or a child who tapped their card would get no countdown.
  it('claims at the prompt in browsing mode too', async () => {
    const { interceptor, sessions } = build({ storyTime: finished });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(await interceptor.claim(bookTap())).toMatchObject({ claimed: true });
  });

  it('claims a second, different book during the countdown — swapping the pick', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    await interceptor.claim(bookTap());
    const swap = await interceptor.claim(bookTap({ expression: { action: 'play-next', contentId: 'plex:999', options: {} } }));
    expect(swap).toMatchObject({ claimed: true });
    expect(sessions.current('livingroom').pick.contentId).toBe('plex:999');
  });
});

describe('ReadingSessionInterceptor — a book mid-story', () => {
  it('claims AND refuses a mid-story tap in assignment mode', async () => {
    const { interceptor, sessions, sent } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    const claim = await interceptor.claim(bookTap());
    // Claiming is what stops it reaching the queue; refusing is what the child sees.
    expect(claim).toMatchObject({ claimed: true, by: 'reading-session', refused: true });
    expect(sent.find((m) => m.payload.event === 'book-refused')).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'book-refused', learnerId: 'learner-c', contentId: 'plex:620681' },
    });
  });

  it('a refused tap does not disturb the story or the pick', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading', pick: { contentId: 'plex:111' } });
    await interceptor.claim(bookTap());
    expect(sessions.current('livingroom')).toMatchObject({
      state: 'reading', pick: { contentId: 'plex:111' },
    });
  });

  it('does NOT claim a mid-story tap in browsing mode — the queue still owns it', async () => {
    const { interceptor, sessions } = build({ storyTime: finished });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('a learner with no story-time enrollment is in browsing mode — no special case', async () => {
    const { interceptor, sessions } = build({ storyTime: notEnrolled });
    sessions.open({ location: 'livingroom', learnerId: 'learner-d' });
    sessions.update('livingroom', { state: 'reading' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('says nothing on screen about a learner who is simply not enrolled', async () => {
    const { interceptor, sessions, sent } = build({ storyTime: notEnrolled });
    sessions.open({ location: 'livingroom', learnerId: 'learner-d' });
    sessions.update('livingroom', { state: 'reading' });
    await interceptor.claim(bookTap());
    expect(sent.filter((m) => m.payload.event === 'session-error')).toEqual([]);
  });
});

// AN UNREADABLE OBLIGATION IS NOT AN UNENROLLED ONE. Both used to answer
// `{error: true, target: null}` and both fell to browsing, so a log that had
// gone unreadable RELAXED a child who was mid-assignment with nothing anywhere
// to say the hardening had switched itself off.
describe('ReadingSessionInterceptor — an obligation that cannot be read', () => {
  it('does NOT claim — the failure mode of this seam is still the old behaviour', async () => {
    const { interceptor, sessions } = build({ storyTime: unreadable });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('SURFACES it on the screen rather than downgrading in silence', async () => {
    const { interceptor, sessions, sent } = build({ storyTime: unreadable });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    await interceptor.claim(bookTap());
    expect(sent.find((m) => m.payload.event === 'session-error')).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-error', reason: 'obligation-unreadable', learnerId: 'learner-c' },
    });
  });

  it('surfaces a mode source that THROWS the same way', async () => {
    const { interceptor, sessions, sent } = build({
      storyTime: { status: async () => { throw new Error('log unreadable'); } },
    });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    expect(await interceptor.claim(bookTap())).toBeNull();
    expect(sent.find((m) => m.payload.event === 'session-error')).toBeTruthy();
  });

  // Nothing is wrong: there is no story-time launcher wired at all (a degraded
  // composition). That is browsing, quietly — an error banner on the TV every
  // time a book plays would be a lie about this household's state.
  it('does NOT surface an error when no mode source is wired at all', async () => {
    const { interceptor, sessions, sent } = build({ storyTime: null });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    expect(await interceptor.claim(bookTap())).toBeNull();
    expect(sent.filter((m) => m.payload.event === 'session-error')).toEqual([]);
  });
});

describe('ReadingSessionInterceptor — mode is derived, never stored', () => {
  it('derives mode from the reading log, not from stored session state', async () => {
    // ONE session, opened once, never touched again. The log moves underneath
    // it and the mid-story answer flips by itself — which is the whole reason
    // mode is not a field.
    let count = 1;
    const sessions = new ReadingSessionService({ logger: silent });
    const { interceptor } = build({
      sessions,
      storyTime: { status: async () => ({ error: false, count, target: 2, doneToday: count >= 2 }) },
    });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });

    expect(await interceptor.claim(bookTap())).toMatchObject({ refused: true });
    count = 2;
    expect(await interceptor.claim(bookTap())).toBeNull();
    // Nothing on the session says which mode it is in, in either direction.
    expect(sessions.current('livingroom').mode).toBeUndefined();
  });

  it('asks about the session learner, not about anyone else', async () => {
    const asked = [];
    const sessions = new ReadingSessionService({ logger: silent });
    const { interceptor } = build({
      sessions,
      storyTime: { status: async ({ userId }) => { asked.push(userId); return { error: false, count: 0, target: 2 }; } },
    });
    sessions.open({ location: 'livingroom', learnerId: 'learner-d' });
    sessions.update('livingroom', { state: 'reading' });
    await interceptor.claim(bookTap());
    expect(asked).toEqual(['learner-d']);
  });
});

describe('ReadingSessionInterceptor — failure paths', () => {
  // The seam skips a throwing interceptor, so this would still play the book.
  // But a mode source that throws is a decision the interceptor CAN make
  // safely: the relaxed answer is today's behaviour.
  it('falls back to browsing when the mode source throws', async () => {
    const { interceptor, sessions } = build({
      storyTime: { status: async () => { throw new Error('log unreadable'); } },
    });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('falls back to browsing when there is no mode source wired at all', async () => {
    const { interceptor, sessions } = build({ storyTime: null });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  // A claim is a promise that the screen will handle it. If the broadcast that
  // TELLS the screen cannot be made, claiming would strand the tap in silence —
  // so a dead bus gives the book back to the ordinary dispatch instead.
  it('does NOT claim when the broadcast fails — better the book plays than nothing happens', async () => {
    const sessions = new ReadingSessionService({ logger: silent });
    const interceptor = new ReadingSessionInterceptor({
      sessions,
      storyTime: owing,
      eventBus: { broadcast: () => { throw new Error('bus down'); } },
      logger: silent,
    });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('does NOT claim when no event bus is wired at all', async () => {
    const sessions = new ReadingSessionService({ logger: silent });
    const interceptor = new ReadingSessionInterceptor({ sessions, storyTime: owing, logger: silent });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(await interceptor.claim(bookTap())).toBeNull();
  });

  it('requires a sessions store to construct', () => {
    expect(() => new ReadingSessionInterceptor({})).toThrow();
  });
});

describe('ReadingSessionInterceptor — through the real content seam', () => {
  it('a claimed book never reaches wake-and-load', async () => {
    const { interceptor, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    const loaded = [];
    await responseHandlers.content(bookTap(), {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [interceptor],
      logger: silent,
    });
    expect(loaded).toEqual([]);
  });

  it('an unclaimed book plays exactly as it does today', async () => {
    const { interceptor } = build();  // no session open anywhere
    const loaded = [];
    await responseHandlers.content(bookTap(), {
      wakeAndLoadService: { execute: async (t, q) => { loaded.push({ t, q }); } },
      contentInterceptors: [interceptor],
      logger: silent,
    });
    expect(loaded).toEqual([{ t: 'livingroom-tv', q: { 'play-next': 'plex:620681', op: 'play-next' } }]);
  });

  it('a mid-story book in BROWSING mode reaches the queue unchanged', async () => {
    const { interceptor, sessions } = build({ storyTime: finished });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading' });
    const loaded = [];
    await responseHandlers.content(bookTap(), {
      wakeAndLoadService: { execute: async () => { loaded.push(1); } },
      contentInterceptors: [interceptor],
      logger: silent,
    });
    expect(loaded).toHaveLength(1);
  });
});
