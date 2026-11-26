// Addendum item 1/3: the handle follows a start on a screen, and says what went wrong.
import { describe, it, expect } from 'vitest';
import { pickHandlePlay, handlePlayView } from "./screenHandleModel.js";

const far = (over = {}) => ({
  attemptId: 'a1', targetId: 'tv', distance: 'far', kind: 'play', operation: 'play-now',
  item: { contentId: 'plex:1', title: 'Hospital' }, command: { play: 'plex:1' },
  phase: 'running', status: 'running', createdAt: '2026-11-26T10:00:00.000Z', ...over,
});

describe('pickHandlePlay', () => {
  it('follows the newest play on another screen, never an add or a local record', () => {
    const older = far({ attemptId: 'old', createdAt: '2026-11-26T09:00:00.000Z' });
    const add = far({ attemptId: 'add', kind: 'add', operation: 'add', createdAt: '2026-11-26T11:00:00.000Z' });
    const local = far({ attemptId: 'here', distance: 'here', createdAt: '2026-11-26T12:00:00.000Z' });
    const newest = far({ attemptId: 'new', createdAt: '2026-11-26T10:30:00.000Z' });
    expect(pickHandlePlay([older, add, local, newest])?.attemptId).toBe('new');
    expect(pickHandlePlay([add, local])).toBeNull();
    expect(pickHandlePlay(null)).toBeNull();
  });
});

describe('handlePlayView', () => {
  it('reads Starting while the start is in flight, Playing once confirmed', () => {
    expect(handlePlayView({ record: far() }).status).toBe('starting');
    expect(handlePlayView({ record: far({ phase: 'sent' }) }).status).toBe('starting');
    expect(handlePlayView({ record: far({ phase: 'confirmed' }) }).status).toBe('playing');
  });

  it('follows the screen session: paused when the screen pauses it', () => {
    const entry = { snapshot: { state: 'paused', currentItem: { contentId: 'plex:1' } } };
    expect(handlePlayView({ record: far({ phase: 'confirmed' }), entry }).status).toBe('paused');
  });

  it('a failed, not-sent or unconfirmed start is a failure', () => {
    expect(handlePlayView({ record: far({ phase: 'failed' }) }).status).toBe('failed');
    expect(handlePlayView({ record: far({ phase: 'not-sent' }) }).status).toBe('failed');
    expect(handlePlayView({ record: far({ phase: 'unconfirmed' }) }).status).toBe('failed');
  });

  it('an unconfirmed start the screen reports playing is playing', () => {
    const entry = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1' } } };
    expect(handlePlayView({ record: far({ phase: 'unconfirmed' }), entry }).status).toBe('playing');
  });

  it('says when the screen is now playing something else (a new session)', () => {
    const record = far({ phase: 'confirmed', outcomeIdentity: { sessionId: 's1' } });
    const entry = { snapshot: { state: 'playing', sessionId: 's2', currentItem: { contentId: 'plex:9', title: 'Bluey' } } };
    const view = handlePlayView({ record, entry });
    expect(view.status).toBe('preempted');
    expect(view.other.title).toBe('Bluey');
  });

  it('a collection moving on to its next item is not pre-empted', () => {
    const record = far({ phase: 'confirmed', kind: 'shuffle', command: { play: 'plex:show', shuffle: true } });
    const entry = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:ep2' } } };
    expect(handlePlayView({ record, entry }).status).toBe('playing');
  });

  it('a single item replaced without session ids is pre-empted; one still queued is not', () => {
    const record = far({ phase: 'confirmed' });
    const other = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:9', title: 'Bluey' } } };
    expect(handlePlayView({ record, entry: other }).status).toBe('preempted');
    const queued = { snapshot: { ...other.snapshot, queue: { items: [{ contentId: 'plex:1' }] } } };
    expect(handlePlayView({ record, entry: queued }).status).toBe('playing');
  });

  it('ends once a screen that had reported goes idle', () => {
    const entry = { snapshot: { state: 'idle', currentItem: null } };
    expect(handlePlayView({ record: far({ phase: 'confirmed' }), entry, seenActive: true }).status).toBe('ended');
    expect(handlePlayView({ record: far({ phase: 'confirmed' }), entry, seenActive: false }).status).toBe('playing');
  });
});
