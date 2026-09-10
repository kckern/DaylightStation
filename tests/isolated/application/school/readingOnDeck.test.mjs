/**
 * The on-deck scope: a second book queued mid-story in browsing mode belongs
 * to somebody. Queued → scoped to the current learner; a card while it waits
 * re-scopes it; the moment it takes the stage it is frozen into the pick.
 */
import { describe, it, expect } from 'vitest';
import { ReadingSessionService as ProductionReadingSessionService } from '#apps/school/ReadingSessionService.mjs';
import { ReadingSessionInterceptor } from '#apps/school/readingSessionInterceptor.mjs';
import { makeReadingSessionHandler } from '#apps/school/workflows/LearnerCardActions.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const TEST_SCHEDULER = { withDeadline: (work) => work, every: () => () => {}, wait: async () => {} };
class ReadingSessionService extends ProductionReadingSessionService {
  constructor(config = {}) { super({ scheduler: TEST_SCHEDULER, ...config }); }
}
const realtimeFor = (sent) => ({
  readingRoomChanged: (location, { kind, ...payload }) => sent.push({ event: kind, ...payload }),
});
const finished = { status: async () => ({ error: false, count: 2, target: 2, doneToday: true }) };
const bookTap = (contentId = 'plex:2') => ({
  kind: 'content', dispatchId: 'd', target: 'livingroom-tv', location: 'livingroom',
  expression: { action: 'play-next', contentId, options: {} }, posture: 'authoritative',
});

function midStory({ storyTime = finished } = {}) {
  const sent = [];
  const sessions = new ReadingSessionService({ realtime: realtimeFor(sent), logger: silent, clock: () => new Date('2026-09-09T20:00:00Z') });
  sessions.open({ location: 'livingroom', learnerId: 'user_5' });
  sessions.update('livingroom', { state: 'reading', pick: { pickId: 'pk_1', learnerId: 'user_5', contentId: 'plex:1', studyDay: '2026-09-09' } });
  const interceptor = new ReadingSessionInterceptor({ sessions, storyTime, realtime: realtimeFor(sent), logger: silent });
  return { sessions, interceptor, sent };
}

describe('the on-deck scope', () => {
  it('a browsing-mode second book is not claimed, but the session records whose it is: the current learner', async () => {
    const { sessions, interceptor, sent } = midStory();
    expect(await interceptor.claim(bookTap('plex:2'))).toBeNull();
    const { onDeck } = sessions.current('livingroom');
    expect(onDeck).toMatchObject({ contentId: 'plex:2', learnerId: 'user_5' });
    expect(onDeck.pickId).toMatch(/^pk_/);
    expect(sent.find((m) => m.event === 'on-deck')).toMatchObject({ contentId: 'plex:2', learnerId: 'user_5', pickId: onDeck.pickId });
    // The playing story is untouched (D4).
    expect(sessions.current('livingroom').pick).toMatchObject({ pickId: 'pk_1', learnerId: 'user_5', contentId: 'plex:1' });
  });

  it('a card tapped while a book waits re-scopes the waiting book — and only that', async () => {
    const { sessions, interceptor, sent } = midStory();
    await interceptor.claim(bookTap('plex:2'));
    const before = sessions.current('livingroom').onDeck;
    const handler = makeReadingSessionHandler({ sessions, realtime: realtimeFor(sent), logger: silent });
    const result = await handler({ learnerId: 'user_3', location: 'livingroom' });
    expect(result).toMatchObject({ status: 'reading_on_deck_rescoped', learnerId: 'user_3', contentId: 'plex:2' });
    const after = sessions.current('livingroom');
    expect(after.onDeck).toMatchObject({ contentId: 'plex:2', learnerId: 'user_3', pickId: before.pickId });
    expect(after.learnerId).toBe('user_5');
    expect(after.pick).toMatchObject({ pickId: 'pk_1', learnerId: 'user_5' });
    expect(after.state).toBe('reading');
    expect(sent.find((m) => m.event === 'on-deck-rescoped')).toMatchObject({ learnerId: 'user_3', contentId: 'plex:2' });
    expect(sent.find((m) => m.event === 'session-switch-refused')).toBeUndefined();
  });

  it('a card mid-story with NOTHING on deck is still refused (D4)', async () => {
    const { sessions, sent } = midStory();
    const handler = makeReadingSessionHandler({ sessions, realtime: realtimeFor(sent), logger: silent });
    const result = await handler({ learnerId: 'user_3', location: 'livingroom' });
    expect(result.status).toBe('reading_session_refused');
    expect(sessions.current('livingroom').learnerId).toBe('user_5');
  });

  it('when the waiting book takes the stage it becomes the pick, frozen, and the session does not return to the card', async () => {
    const { sessions, interceptor, sent } = midStory();
    await interceptor.claim(bookTap('plex:2'));
    sessions.rescopeOnDeck('livingroom', 'user_3');
    const pick = sessions.advanceToOnDeck('livingroom');
    expect(pick).toMatchObject({ contentId: 'plex:2', learnerId: 'user_3', studyDay: '2026-09-09' });
    const now = sessions.current('livingroom');
    expect(now).toMatchObject({ state: 'confirm', onDeck: null, playing: null });
    expect(now.pick).toMatchObject({ pickId: pick.pickId, learnerId: 'user_3', contentId: 'plex:2' });
    expect(sent.find((m) => m.event === 'on-deck-advanced')).toMatchObject({ learnerId: 'user_3', contentId: 'plex:2', pickId: pick.pickId });
    // Frozen: a card now is refused, and a re-scope has nothing to act on.
    expect(sessions.rescopeOnDeck('livingroom', 'user_4')).toBeNull();
    expect(sessions.advanceToOnDeck('livingroom')).toBeNull();
  });

  it('in assignment mode a second book is refused and nothing goes on deck', async () => {
    const owing = { status: async () => ({ error: false, count: 1, target: 2, doneToday: false }) };
    const { sessions, interceptor } = midStory({ storyTime: owing });
    const claim = await interceptor.claim(bookTap('plex:2'));
    expect(claim).toMatchObject({ claimed: true, refused: true });
    expect(sessions.current('livingroom').onDeck).toBeUndefined();
  });
});
