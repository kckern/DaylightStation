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
        events: session.events,
        treasureBox: session.treasureBox,
        strava: session.strava,
        strava_notes: session.strava_notes,
        summary: session.summary,
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

test('folds the SOURCE\'s participants + strava in even when the source starts LATER than the target', async () => {
  // Regression: the union previously used `earlier` not `source`. When the target
  // is the earlier-starting session, earlier===target and the (later) source's
  // participants/strava were dropped.
  const store = makeStore([
    mkSession('20260616182610', '2026-06-16 18:26:10', '2026-06-16 19:15:56'), // target, earliest start, latest end
    mkSession('20260616184005', '2026-06-16 18:46:49', '2026-06-16 18:53:24'), // source, starts later
  ]);
  // Give the later source a unique participant + strava payload.
  store._db.get('20260616184005').participants.user_4 = { display_name: 'User_4' };
  store._db.get('20260616184005').strava = { name: 'Evening Ride', type: 'Ride' };

  const svc = new SessionService({ sessionStore: store, defaultHouseholdId: 'test' });
  await svc.mergeSessions('20260616184005', '20260616182610', 'test'); // source starts later than target

  const saved = store._db.get('20260616182610');
  assert.ok(saved.participants.user_4, 'later source participant (user_4) preserved');
  assert.equal(saved.strava?.name, 'Evening Ride', 'later source strava preserved');
  assert.equal(saved.session.start, '2026-06-16 18:26:10');
  assert.equal(saved.session.end, '2026-06-16 19:15:56');
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

test('fills source-only participant sub-fields when both sides share a participant id (preserves strava link)', async () => {
  // Regression: a shallow "skip if key exists" participant union dropped
  // source-only sub-blocks (e.g. the participant's `strava` link with activityId)
  // whenever the SAME participant existed on both sides — silently severing the
  // merged session's Strava linkage.
  const store = makeStore([
    mkSession('20260617131853', '2026-06-17 13:18:53', '2026-06-17 13:44:43'), // source: has participant strava
    mkSession('20260617134452', '2026-06-17 13:44:52', '2026-06-17 14:05:29'), // target: same participant, NO strava
  ]);
  store._db.get('20260617131853').participants = {
    user_1: { display_name: 'User_1', hr_device: '40475', strava: { activityId: 18963555842, type: 'WeightTraining' } },
  };
  store._db.get('20260617134452').participants = {
    user_1: { display_name: 'User_1', hr_device: '40475' }, // same id, no strava sub-block
  };

  const svc = new SessionService({ sessionStore: store, defaultHouseholdId: 'test' });
  await svc.mergeSessions('20260617131853', '20260617134452', 'test');

  const saved = store._db.get('20260617134452');
  assert.equal(saved.participants.kckern.strava?.activityId, 18963555842, 'source-only participant strava preserved');
  assert.equal(saved.participants.kckern.display_name, 'User_1', 'target sub-field retained');
});

test('joins voice memos from both sessions, chronologically, deduped by timestamp', async () => {
  // Regression: mergeSessions never merged summary.voiceMemos, so every memo
  // recorded in the source fragment was silently lost on merge.
  const store = makeStore([
    mkSession('20260617131853', '2026-06-17 13:18:53', '2026-06-17 13:44:43'), // earlier
    mkSession('20260617134452', '2026-06-17 13:44:52', '2026-06-17 14:05:29'), // later (target)
  ]);
  store._db.get('20260617131853').summary = {
    voiceMemos: [{ transcript: 'block 1', durationSeconds: 83, timestamp: 1781728448876 }],
  };
  store._db.get('20260617134452').summary = {
    voiceMemos: [{ transcript: 'block 2', durationSeconds: 135, timestamp: 1781729166305 }],
  };

  const svc = new SessionService({ sessionStore: store, defaultHouseholdId: 'test' });
  await svc.mergeSessions('20260617131853', '20260617134452', 'test');

  const memos = store._db.get('20260617134452').summary.voiceMemos;
  assert.equal(memos.length, 2, 'both memos present');
  assert.deepEqual(memos.map((m) => m.transcript), ['block 1', 'block 2'], 'sorted by timestamp ascending');

  // Re-merging the same source content must not duplicate (idempotent on timestamp).
  const store2 = makeStore([
    mkSession('20260617131853', '2026-06-17 13:18:53', '2026-06-17 13:44:43'),
    mkSession('20260617134452', '2026-06-17 13:44:52', '2026-06-17 14:05:29'),
  ]);
  const shared = { transcript: 'dup', durationSeconds: 10, timestamp: 1781728448876 };
  store2._db.get('20260617131853').summary = { voiceMemos: [shared] };
  store2._db.get('20260617134452').summary = { voiceMemos: [{ ...shared }] };
  const svc2 = new SessionService({ sessionStore: store2, defaultHouseholdId: 'test' });
  await svc2.mergeSessions('20260617131853', '20260617134452', 'test');
  assert.equal(store2._db.get('20260617134452').summary.voiceMemos.length, 1, 'same-timestamp memo not duplicated');
});
