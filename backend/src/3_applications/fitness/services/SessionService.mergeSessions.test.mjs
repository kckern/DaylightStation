// Regression test for SessionService.mergeSessions timestamp handling.
//
// Bug guarded: mergeSessions updated only the numeric startTime/durationMs, not
// the human-readable `session.start`/`session.end` strings. Because the store
// re-derives startTime/endTime from those strings on the next load, the merge
// silently reverted on reload — and CHAINED merges (>2 fragments) corrupted the
// span, each later fragment re-reading the target's stale original start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionService } from './SessionService.mjs';

const parseTs = (s) => Date.parse(String(s).replace(' ', 'T'));
const TZ = 'America/Los_Angeles';

function mkSession(id, startStr, endStr) {
  return {
    id,
    sessionId: id,
    version: 3,
    timezone: TZ,
    session: {
      id,
      date: startStr.slice(0, 10),
      start: startStr,
      end: endStr,
      duration_seconds: Math.round((parseTs(endStr) - parseTs(startStr)) / 1000),
    },
    timeline: { series: {}, events: [], interval_seconds: 5 },
    participants: { [`u_${id}`]: { display_name: id } },
  };
}

// Fake store that mimics the prod mapper: on read it RE-DERIVES the numeric
// startTime/endTime from the session.start/end strings (this is what makes the
// stale-string bug observable). On save it persists the entity's session block.
function makeStore(seed) {
  const db = new Map(seed.map((s) => [s.id, s]));
  return {
    _db: db,
    async findById(id) {
      const raw = db.get(String(id));
      if (!raw) return null;
      return {
        ...raw,
        startTime: parseTs(raw.session.start),
        endTime: parseTs(raw.session.end),
      };
    },
    async save(session) {
      const id = session.sessionId.toString();
      db.set(id, {
        id,
        sessionId: id,
        version: 3,
        timezone: session.timezone,
        session: { ...session.session },
        timeline: session.timeline,
        participants: session.participants,
      });
    },
    async delete(id) { db.delete(String(id)); },
  };
}

test('mergeSessions rewrites session.start/end strings to the merged span', async () => {
  const store = makeStore([
    mkSession('20260616182610', '2026-06-16 18:26:10', '2026-06-16 18:35:25'),
    mkSession('20260616185313', '2026-06-16 19:09:30', '2026-06-16 19:15:56'),
  ]);
  const svc = new SessionService({ sessionStore: store, defaultHouseholdId: 'test' });

  await svc.mergeSessions('20260616182610', '20260616185313', 'test');

  const saved = store._db.get('20260616185313');
  assert.equal(saved.session.start, '2026-06-16 18:26:10', 'start = earliest fragment');
  assert.equal(saved.session.end, '2026-06-16 19:15:56', 'end = latest fragment');
  // span 18:26:10 -> 19:15:56 = 2986s
  assert.equal(saved.session.duration_seconds, 2986);
  assert.equal(store._db.has('20260616182610'), false, 'source deleted');
});

test('chained merges (3 fragments) span earliest start to latest end', async () => {
  const store = makeStore([
    mkSession('20260616182610', '2026-06-16 18:26:10', '2026-06-16 18:35:25'),
    mkSession('20260616184005', '2026-06-16 18:46:49', '2026-06-16 18:53:24'),
    mkSession('20260616185313', '2026-06-16 19:09:30', '2026-06-16 19:15:56'),
  ]);
  const svc = new SessionService({ sessionStore: store, defaultHouseholdId: 'test' });

  // Merge the two earlier fragments into the latest-ending target, one at a time.
  await svc.mergeSessions('20260616182610', '20260616185313', 'test');
  await svc.mergeSessions('20260616184005', '20260616185313', 'test');

  const saved = store._db.get('20260616185313');
  // The regression made this revert to a later start (e.g. 18:46:49); the fix
  // keeps the earliest start across the chain.
  assert.equal(saved.session.start, '2026-06-16 18:26:10', 'start stays earliest across chain');
  assert.equal(saved.session.end, '2026-06-16 19:15:56', 'end stays latest');
  assert.equal(saved.session.duration_seconds, 2986);
  assert.equal(store._db.size, 1, 'both sources deleted, one merged session remains');
});

test('participants are unioned into the target', async () => {
  const store = makeStore([
    mkSession('20260616182610', '2026-06-16 18:26:10', '2026-06-16 18:35:25'),
    mkSession('20260616185313', '2026-06-16 19:09:30', '2026-06-16 19:15:56'),
  ]);
  const svc = new SessionService({ sessionStore: store, defaultHouseholdId: 'test' });
  await svc.mergeSessions('20260616182610', '20260616185313', 'test');
  const saved = store._db.get('20260616185313');
  assert.deepEqual(
    Object.keys(saved.participants).sort(),
    ['u_20260616182610', 'u_20260616185313']
  );
});
