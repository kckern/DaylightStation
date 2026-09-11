/**
 * The `content-playing` refusal, and the one room it must not apply to.
 *
 * D2 — A READING SESSION NEVER SEIZES THE TV — is right, and it is the reason
 * this refusal exists: a four-year-old's card must not stop the movie somebody
 * else is watching. The refusal is also deliberately NON-RETRYABLE, because the
 * movie will still be playing on the next tap and a released debounce would only
 * let a child tap through it.
 *
 * Both of those turned on a child on 2026-09-11. The sweep closed his session at
 * 17:13:22; his book card landed 1.18s later with no session open and dispatched
 * as ordinary content — story playing, nobody's name on it. He then re-tapped his
 * own card at 17:14:01 and 17:15:02 and was refused both times, BECAUSE THE
 * CONTENT PLAYING WAS HIS OWN BOOK. Non-retryable, so tapping harder did nothing
 * at all. Recovery required an adult.
 *
 * These tests pin both halves: the exemption for the learner whose own room this
 * just was, and the refusal for everybody else — which is the invariant, and
 * which must fail loudly if the exemption is ever widened.
 */
import { describe, it, expect } from 'vitest';
import { ReadingSessionService as ProductionReadingSessionService } from '#apps/school/ReadingSessionService.mjs';
import { makeReadingSessionHandler } from '#apps/school/workflows/LearnerCardActions.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const TEST_SCHEDULER = { withDeadline: (work) => work, every: () => () => {}, wait: async () => {} };
class ReadingSessionService extends ProductionReadingSessionService {
  constructor(config = {}) { super({ scheduler: TEST_SCHEDULER, ...config }); }
}

/**
 * A reader with content up on its TV, and a clock the test drives by hand.
 * `departs` is the teardown the child did not ask for; `tick` is the time they
 * spend standing there tapping.
 */
function rig({ idleTimeoutMs, playing = true } = {}) {
  const state = { now: 1_000_000 };
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
  const sessions = new ReadingSessionService({
    realtime, logger: silent, clock,
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
  });
  const woke = [];
  const handler = makeReadingSessionHandler({
    sessions,
    isPlaying: typeof playing === 'function' ? playing : () => playing,
    wakeScreen: async (args) => { woke.push(args); return { ok: true }; },
    realtime, clock, logger,
  });
  return {
    sessions, handler, sent, logs, woke,
    tick: (ms) => { state.now += ms; },
    departs: (learnerId, reason) => {
      sessions.open({ location: 'livingroom', learnerId, target: 'livingroom-tv' });
      sessions.close('livingroom', reason === undefined ? {} : { reason });
    },
    tap: (learnerId) => handler({ learnerId, location: 'livingroom', target: 'livingroom-tv' }),
    refusals: () => sent.filter((m) => m.event === 'session-refused'),
  };
}

describe('the learner card refused by its own story', () => {
  it('lets the learner back into the room the sweep took from them — 101s later, the field s second re-tap', async () => {
    const r = rig();
    r.departs('user_5', 'timeout');
    r.tick(101_000);

    const result = await r.tap('user_5');
    expect(result.status).not.toBe('reading_session_refused');
    expect(r.sessions.current('livingroom')).toMatchObject({ learnerId: 'user_5' });
  });

  it('gives the child the screen back rather than a notice — no refusal is broadcast, and the reader is woken', async () => {
    const r = rig();
    r.departs('user_5', 'timeout');
    r.tick(39_000); // the field's FIRST re-tap

    await r.tap('user_5');
    expect(r.refusals()).toEqual([]);
    expect(r.woke).toEqual([{ target: 'livingroom-tv', location: 'livingroom' }]);
  });

  it('names the exemption in the log, so the field can tell it from an ordinary refusal', async () => {
    const r = rig();
    r.departs('user_5', 'timeout');
    r.tick(50_000);

    await r.tap('user_5');
    const exempted = r.logs.find((l) => l.event === 'school.reading.refusal-exempted');
    expect(exempted).toBeTruthy();
    expect(exempted.data).toMatchObject({
      location: 'livingroom', learnerId: 'user_5', closeReason: 'timeout', sinceCloseMs: 50_000,
    });
    expect(r.logs.find((l) => l.event === 'school.reading.session-refused')).toBeUndefined();
  });

  // The teardown a failed reopen leaves behind: same child, same lost act, one
  // road further along. The interceptor writes this reason when it could not
  // tell the screen and rolled its own reopen back.
  it('exempts a learner whose reopen was abandoned', async () => {
    const r = rig();
    r.departs('user_5', 'reopen-abandoned');
    r.tick(60_000);
    expect((await r.tap('user_5')).status).not.toBe('reading_session_refused');
  });

  // The screen never painted the launch card, so the handler closed the session
  // as a phantom. The child saw nothing and tapped again; that is the recovery
  // gesture, not a seizure.
  it('exempts a learner whose presentation was never acknowledged', async () => {
    const r = rig();
    r.departs('user_5', 'presentation-unacknowledged');
    r.tick(60_000);
    expect((await r.tap('user_5')).status).not.toBe('reading_session_refused');
  });
});

/**
 * D2 itself. Every one of these must keep failing the tap, and each is the
 * mutation test for a differently-widened exemption.
 */
describe('the refusal that must survive the exemption', () => {
  it('refuses a learner at a reader where no session of anybody s just ended', async () => {
    const r = rig();
    const result = await r.tap('user_5');
    expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
    expect(r.sessions.current('livingroom')).toBeNull();
    expect(r.woke).toEqual([]);
    expect(r.refusals()).toHaveLength(1);
  });

  it('refuses a learner when the room that just emptied was SOMEBODY ELSE s', async () => {
    const r = rig();
    r.departs('user_3', 'timeout');
    r.tick(10_000);
    expect(await r.tap('user_5')).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
    expect(r.sessions.current('livingroom')).toBeNull();
  });

  it('refuses the same learner once the room has stopped being theirs', async () => {
    const r = rig();
    r.departs('user_5', 'timeout');
    r.tick(120_001); // past this room's own idle timeout
    expect(await r.tap('user_5')).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
  });

  // A finished day is the child HANDING THE ROOM BACK, and the reader's end
  // policy has already turned the TV off. Content playing after that is new,
  // and new content in a room nobody is using belongs to whoever started it.
  it('refuses a learner whose day was already wound down', async () => {
    const r = rig();
    r.departs('user_5', 'day-done');
    r.tick(10_000);
    expect(await r.tap('user_5')).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
  });

  // An allow-list, not a deny-list: a teardown with no stated reason has no
  // stated provenance either, and a reason added later must be decided on
  // rather than inherited.
  it('refuses a learner whose session was closed for no stated reason', async () => {
    const r = rig();
    r.departs('user_5');
    r.tick(10_000);
    expect(await r.tap('user_5')).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
  });

  it('refuses a tap carrying no learner at all, whatever the room remembers', async () => {
    const r = rig();
    r.departs('user_5', 'timeout');
    r.tick(10_000);
    const result = await r.handler({ location: 'livingroom', target: 'livingroom-tv' });
    expect(result).toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
  });

  it('says in the log why the exemption did not apply', async () => {
    const r = rig();
    r.departs('user_3', 'timeout');
    r.tick(10_000);
    await r.tap('user_5');
    const refused = r.logs.find((l) => l.event === 'school.reading.session-refused');
    expect(refused.data).toMatchObject({
      learnerId: 'user_5', reason: 'content-playing',
      departedLearnerId: 'user_3', departedReason: 'timeout',
    });
  });

  it('a store too old to answer recentlyDeparted still refuses rather than throwing', async () => {
    const sessions = new ReadingSessionService({ logger: silent });
    sessions.recentlyDeparted = undefined;
    const handler = makeReadingSessionHandler({ sessions, isPlaying: () => true, logger: silent });
    expect(await handler({ learnerId: 'user_5', location: 'livingroom', target: 'livingroom-tv' }))
      .toMatchObject({ status: 'reading_session_refused', reason: 'content-playing' });
  });
});
