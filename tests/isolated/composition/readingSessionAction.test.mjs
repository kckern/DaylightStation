/**
 * The `reading-session` learner action — what a preschooler's card DOES at the
 * living-room reader.
 *
 * The decision this file exists for is D2: **a reading session never seizes the
 * TV from whoever is already watching it.** A family movie is on, a four-year-old
 * wanders in and taps their card — the movie keeps playing, the child gets a
 * brief on-screen acknowledgement, and no session opens. Both halves matter:
 * seizing the TV is the loud failure, and doing nothing visible is the quiet one
 * (invariant 5 — a child who taps and sees nothing taps harder).
 *
 * `FOREIGN_PLAY` is a state of its own and not a flavour of `READING`, and this
 * handler is where that distinction is actually made: the question is
 * *did a reading session start this?*, which is exactly "is a session open at
 * this reader?". Collapsing the two is how a family movie gets logged as
 * somebody's homework.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReadingSessionService as ProductionReadingSessionService } from '#apps/school/ReadingSessionService.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';
import { makeReadingSessionHandler, makeReadingTimeoutHandler } from '#composition/modules/learnerCardActions.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const TEST_SCHEDULER = { withDeadline: (work) => work, every: () => () => {}, wait: async () => {} };
class ReadingSessionService extends ProductionReadingSessionService {
  constructor(config = {}) { super({ scheduler: TEST_SCHEDULER, ...config }); }
}

function build({
  playing = false,
  wake = async () => ({ ok: true }),
  scheduler = TEST_SCHEDULER,
  logger = silent,
  alertAdult = null,
  ackTimeoutMs = 8_000,
  maxDeliveryAttempts = 3,
} = {}) {
  const sent = [];
  // ONE bus, shared by the store and the handler, exactly as composition wires
  // it: `session-open` is the store's own broadcast and `session-refused` is
  // the handler's, and the screen hears both on the same topic.
  const bus = { broadcast: (topic, payload) => sent.push({ topic, payload }) };
  const store = new ReadingSessionService({ realtime: new EventBusSchoolRealtimeAdapter({ eventBus: bus }), logger, scheduler });
  const woke = [];
  const handler = makeReadingSessionHandler({
    sessions: store,
    isPlaying: typeof playing === 'function' ? playing : () => playing,
    wakeScreen: async (args) => { woke.push(args); return wake(args); },
    alertAdult,
    ackTimeoutMs,
    maxDeliveryAttempts,
    eventBus: bus,
    logger,
  });
  return { handler, sessions: store, sent, woke };
}

const tap = (over = {}) => ({ learnerId: 'learner-c', location: 'livingroom', target: 'livingroom-tv', ...over });

describe('reading-session — an ordinary card tap opens a session', () => {
  it('opens a session for the learner at that reader', async () => {
    const { handler, sessions } = build();
    const result = await handler(tap());
    expect(sessions.current('livingroom')).toMatchObject({ learnerId: 'learner-c', state: 'prompt' });
    expect(result).toMatchObject({ status: 'reading_session_open', learnerId: 'learner-c' });
  });

  it('wakes the reader s screen, naming the target the reader declared', async () => {
    const { handler, woke } = build();
    await handler(tap());
    expect(woke).toEqual([{ target: 'livingroom-tv', location: 'livingroom' }]);
  });

  it('tells the screen who is standing there', async () => {
    const { handler, sent } = build();
    await handler(tap());
    expect(sent.find((entry) => entry.payload?.event === 'session-open')).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-open', learnerId: 'learner-c' },
    });
  });

  it('a second card at the same reader swaps the learner — last tap wins', async () => {
    const { handler, sessions } = build();
    await handler(tap());
    await handler(tap({ learnerId: 'learner-d' }));
    expect(sessions.current('livingroom').learnerId).toBe('learner-d');
  });

  // §9: a card tap must always answer. A TV that will not wake is worth saying
  // out loud, and is NOT worth refusing the session over — the child is still
  // standing there and the screen may well be on already.
  it('still opens the session when the TV refuses to wake, and says so', async () => {
    const { handler, sessions } = build({ wake: async () => { throw new Error('tv unreachable'); } });
    const result = await handler(tap());
    expect(sessions.current('livingroom')).not.toBeNull();
    expect(result).toMatchObject({ status: 'reading_session_open', woke: false });
  });

  it('never rejects, whatever the wake does', async () => {
    for (const wake of [async () => { throw new Error('boom'); }, async () => ({ ok: false })]) {
      const { handler } = build({ wake });
      await expect(handler(tap())).resolves.toMatchObject({ status: 'reading_session_open' });
    }
  });

  it('with no wakeScreen wired at all it still opens the session', async () => {
    const sessions = new ReadingSessionService({ logger: silent });
    const handler = makeReadingSessionHandler({ sessions, logger: silent });
    await expect(handler(tap())).resolves.toMatchObject({ status: 'reading_session_open' });
    expect(sessions.current('livingroom')).not.toBeNull();
  });

  it('refuses a tap with no reader location rather than opening a session nowhere', async () => {
    const { handler, sessions } = build();
    const result = await handler(tap({ location: null }));
    expect(result).toMatchObject({ status: 'reading_session_failed' });
    expect(sessions.list()).toEqual([]);
  });

  it('replays the exact intent and re-foregrounds after an acknowledgement timeout', async () => {
    const deadlines = [];
    const scheduler = {
      withDeadline: (work) => Promise.race([
        work,
        new Promise((_, reject) => deadlines.push(() => reject(new Error('deadline')))),
      ]),
      every: () => () => {},
      wait: async () => {},
    };
    const logger = { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = build({ scheduler, logger });

    await r.handler(tap());
    expect(deadlines).toHaveLength(1);

    deadlines.shift()();
    await vi.waitFor(() => expect(r.woke).toHaveLength(2));
    const active = r.sessions.current('livingroom');
    r.sessions.acknowledge('livingroom', active.sessionId);

    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith(
      'school.reading.delivery-acknowledged',
      expect.objectContaining({ sessionId: active.sessionId, attempt: 2 }),
    ));
    expect(r.woke[1]).toMatchObject({ target: 'livingroom-tv', location: 'livingroom', prepareOnly: true });
    expect(r.sent.filter((entry) => entry.payload?.event === 'session-open')).toHaveLength(2);
  });

  it('alerts an adult only after every bounded delivery recovery attempt fails', async () => {
    const scheduler = {
      withDeadline: async () => { throw new Error('deadline'); },
      every: () => () => {},
      wait: async () => {},
    };
    const alertAdult = vi.fn(async () => {});
    const logger = { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = build({ scheduler, logger, alertAdult, maxDeliveryAttempts: 3 });

    await r.handler(tap());

    await vi.waitFor(() => expect(alertAdult).toHaveBeenCalledTimes(1));
    expect(r.woke).toEqual([
      { target: 'livingroom-tv', location: 'livingroom' },
      { target: 'livingroom-tv', location: 'livingroom', prepareOnly: true },
      { target: 'livingroom-tv', location: 'livingroom', prepareOnly: true },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      'school.reading.delivery-unacknowledged',
      expect.objectContaining({ attempts: 3 }),
    );
  });
});

describe('reading-session timeout composition', () => {
  it('uses the configured end_location for tv-off', async () => {
    const turns = [];
    const timeout = makeReadingTimeoutHandler({
      locations: () => ({ livingroom: { end: 'tv-off', end_location: 'living_room' } }),
      tv: { turnOff: async (location) => turns.push(location) }, logger: silent,
    });
    await expect(timeout({ location: 'livingroom' })).resolves.toEqual({ action: 'tv-off', location: 'living_room' });
    expect(turns).toEqual(['living_room']);
  });

  it('leaves the TV alone so a non-tv-off source returns to its idle/art surface', async () => {
    const turnOff = () => { throw new Error('must not power off'); };
    const timeout = makeReadingTimeoutHandler({ locations: () => ({ livingroom: {} }), tv: { turnOff }, logger: silent });
    await expect(timeout({ location: 'livingroom' })).resolves.toEqual({ action: 'idle' });
  });
});

describe('reading-session — a card tapped while unrelated content plays (D2)', () => {
  it('does NOT open a session', async () => {
    const { handler, sessions } = build({ playing: true });
    await handler(tap());
    expect(sessions.current('livingroom')).toBeNull();
  });

  it('does NOT touch the TV — the movie keeps playing', async () => {
    const { handler, woke } = build({ playing: true });
    await handler(tap());
    expect(woke).toEqual([]);
  });

  it('acknowledges the tap on screen anyway — the refusal is visible, not silent', async () => {
    const { handler, sent } = build({ playing: true });
    await handler(tap());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-refused', reason: 'content-playing', learnerId: 'learner-c' },
    });
  });

  it('reports the refusal by name rather than pretending it opened', async () => {
    const { handler } = build({ playing: true });
    expect(await handler(tap())).toMatchObject({
      status: 'reading_session_refused', reason: 'content-playing', learnerId: 'learner-c',
    });
  });

  it('asks about the READER S OWN target, not some other room s TV', async () => {
    const asked = [];
    const { handler } = build({ playing: (id) => { asked.push(id); return false; } });
    await handler(tap());
    expect(asked).toEqual(['livingroom-tv']);
  });

  /**
   * The distinction the whole state is for. A story the SESSION started is
   * `READING`, not `FOREIGN_PLAY` — so a sibling wandering past mid-story swaps
   * the context (D4) instead of being refused, and the story keeps playing and
   * keeps the credit it was picked with.
   */
  it('a session s OWN story is not foreign play — a mid-story card still swaps the context', async () => {
    const { handler, sessions } = build({ playing: true });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading', playing: { learnerId: 'learner-c', pickId: 'pick_1' } });

    const result = await handler(tap({ learnerId: 'learner-d' }));

    expect(result.status).toBe('reading_session_open');
    expect(sessions.current('livingroom').learnerId).toBe('learner-d');
  });

  it('and that swap leaves the state mid-story, so the next book is still refused (D5)', async () => {
    // `open` resets a fresh session to `prompt`. Mid-story it must NOT: a
    // session sitting at `prompt` while a story plays would hand the next book
    // tap a countdown on top of the running story, in assignment mode too.
    const { handler, sessions } = build({ playing: true });
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    sessions.update('livingroom', { state: 'reading', playing: { learnerId: 'learner-c', pickId: 'pick_1' } });

    await handler(tap({ learnerId: 'learner-d' }));

    const now = sessions.current('livingroom');
    expect(now.state).toBe('reading');
    // Attribution is decided at PICK time and never re-read: the running story
    // still belongs to the child who chose it.
    expect(now.playing).toMatchObject({ learnerId: 'learner-c', pickId: 'pick_1' });
  });

  it('with no isPlaying source wired, a tap opens a session rather than being refused on a guess', async () => {
    const sessions = new ReadingSessionService({ logger: silent });
    const handler = makeReadingSessionHandler({ sessions, logger: silent });
    await expect(handler(tap())).resolves.toMatchObject({ status: 'reading_session_open' });
  });

  it('a THROWING isPlaying opens the session too — it must not become a refusal', async () => {
    const { handler, sessions } = build({ playing: () => { throw new Error('tracker down'); } });
    await expect(handler(tap())).resolves.toMatchObject({ status: 'reading_session_open' });
    expect(sessions.current('livingroom')).not.toBeNull();
  });

  it('a dead bus cannot turn a refusal into a crash, or into a seized TV', async () => {
    const sessions = new ReadingSessionService({ logger: silent });
    const handler = makeReadingSessionHandler({
      sessions,
      isPlaying: () => true,
      eventBus: { broadcast() { throw new Error('bus is gone'); } },
      logger: silent,
    });
    await expect(handler(tap())).resolves.toMatchObject({ status: 'reading_session_refused' });
    expect(sessions.current('livingroom')).toBeNull();
  });

  it('a throwing logger cannot break the tap either', async () => {
    const sessions = new ReadingSessionService({ logger: silent });
    const handler = makeReadingSessionHandler({
      sessions,
      isPlaying: () => true,
      eventBus: { broadcast() {} },
      logger: { info() { throw new Error('log transport down'); }, warn() { throw new Error('log transport down'); } },
    });
    await expect(handler(tap())).resolves.toMatchObject({ status: 'reading_session_refused' });
  });
});
