// backend/src/3_applications/school/companions/LessonCompanionHandlers.test.mjs
// @vitest-environment node
//
// THE COMPANION ANSWERS WITH A VERDICT, NOT AN ACKNOWLEDGEMENT.
//
// `{ok: true, tracked: true}` says "I wrote that down". It does not say whether
// the child may have the finish code, and the child cannot proceed without one.
// So every progress report comes back with the verdict: satisfied or not, the
// code or null, and how many parts are still outstanding.
//
// WHY THE STORES ARE REAL. Both traps this task exists to avoid live in
// `YamlCompanionCodeStore`, not in the application: `update` REFUSES a mutator
// that returns anything but the record (a concise arrow returns the value it
// assigned, and writing that once bricked a household's code), and its
// read-modify-write is indivisible only because nothing inside it awaits. A
// double would fake both away and the test would pass over a bug that ships.
//
// The 2026-08-26 incident these guards commemorate is written up in
// `YamlLessonCompanionStore`'s header: two saves 1ms apart interleaved and
// locked a child out of their own read-along. Two siblings on one lesson are
// exactly two concurrent writers, which is why the sharing test below runs two
// learners over ONE code record rather than two doubles.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LessonCompanionHandlers, ReadalongLessonCompanionHandler } from './LessonCompanionHandlers.mjs';
import { RecordLessonCompanionProgress } from '../usecases/RecordLessonCompanionProgress.mjs';
import { YamlCompanionCodeStore } from '#adapters/persistence/yaml/YamlCompanionCodeStore.mjs';
import { YamlLessonCompanionStore } from '#adapters/persistence/yaml/YamlLessonCompanionStore.mjs';
import { silentLogger } from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

const HOUSEHOLD = 'hh1';
const LESSON = 'cfm-w35-d1-psalms-70-72-77';
const LESSON_DAY = '2026-08-24';
const CODE = ['A', 'C', 'E'];
const NOW = '2026-08-28T17:00:00.000Z';

/** Psalms 70–72; 77 — four chapters, which is why `require_parts` exists at all. */
const PARTS = [
  { id: 'scripture:ot:nirv:15494', contentId: 'readalong:scripture/ot/nirv/15494', title: 'Psalms 70' },
  { id: 'scripture:ot:nirv:15500', contentId: 'readalong:scripture/ot/nirv/15500', title: 'Psalms 71' },
  { id: 'scripture:ot:nirv:15524', contentId: 'readalong:scripture/ot/nirv/15524', title: 'Psalms 72' },
  { id: 'scripture:ot:nirv:15600', contentId: 'readalong:scripture/ot/nirv/15600', title: 'Psalms 77' },
];

let dir; let companions; let companionCodes; let clock;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-handler-'));
  const configService = { getHouseholdPath: (rel) => path.join(dir, rel) };
  companions = new YamlLessonCompanionStore({ configService, logger: silentLogger });
  companionCodes = new YamlCompanionCodeStore({ configService, logger: silentLogger });
  clock = () => new Date(NOW);
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const handler = () => new ReadalongLessonCompanionHandler({ companions, companionCodes, clock });

/**
 * A code record shaped exactly as `IssueDocument.#prepareCompanion` writes it.
 * `requireParts` is a COUNT, which is how both authored settings arrive here:
 * `require_parts: 1` is 1, `require_parts: all` is the playlist's length.
 */
async function seedCode({ requireParts = PARTS.length } = {}) {
  const key = companionCodes.keyFor({ householdId: HOUSEHOLD, lessonId: LESSON, lessonDay: LESSON_DAY });
  await companionCodes.findOrCreate({
    key,
    create: () => ({
      schema: 'school.companion-code/v1',
      id: key,
      householdId: HOUSEHOLD,
      lessonId: LESSON,
      lessonDay: LESSON_DAY,
      code: [...CODE],
      requireParts,
      createdAt: NOW,
      satisfiedAt: null,
      satisfiedBy: null,
      satisfiedVia: null,
      coverage: {},
    }),
  });
  return key;
}

/** A per-learner offer. The letters are NOT copied here — only the scope key is. */
async function seedOffer({
  id = 'ral_learner1', learnerId = 'test-user', participation = 'required', codeRef = null,
  parts = PARTS,
} = {}) {
  return companions.put({
    schema: 'school.lesson-companion/v1',
    id,
    createdAt: NOW,
    learnerId,
    sessionId: `ses_${learnerId}`,
    worksheetInstanceId: `wsi_${learnerId}`,
    lessonId: LESSON,
    ...(codeRef ? { codeRef } : {}),
    companion: {
      handler: 'readalong',
      label: 'Read along',
      payload: { playlist: { title: 'Psalms 70–72; 77', parts } },
    },
    participation,
    state: {},
  });
}

const report = (offer, payload) => handler().recordProgress({ offer, payload });

describe('ReadalongLessonCompanionHandler.recordProgress — the verdict', () => {
  it('banks coverage across calls, so two half-plays add up to a satisfied whole', async () => {
    // The reload case: the tab is closed at the halfway mark and reopened later.
    // Neither report covers enough on its own; the union of them does.
    const codeRef = await seedCode({ requireParts: 1 });
    const offer = await seedOffer({ codeRef });

    const first = await report(offer, {
      partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[0, 50]],
    });
    expect(first).toMatchObject({ ok: true, tracked: true, satisfied: false, code: null, remainingParts: 1 });

    const second = await report(offer, {
      partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[50, 100]],
    });
    expect(second).toMatchObject({ ok: true, tracked: true, satisfied: true, remainingParts: 0 });
    expect(second.code).toEqual(CODE);
  });

  it('refuses a dead stream: completed:true over 1% coverage does NOT satisfy', async () => {
    // `Player.handleResilienceExhausted` calls the SAME `clear()` callback as a
    // real ending, so a child who pulls the network five seconds in reports
    // `completed: true` exactly like one who listened to the whole thing. This
    // is the assertion that separates them, and it is the point of the task.
    const codeRef = await seedCode({ requireParts: 1 });
    const offer = await seedOffer({ codeRef });

    const result = await report(offer, {
      partId: PARTS[0].id, durationSeconds: 100, positionSeconds: 100,
      completed: true, playedRanges: [[0, 1]],
    });

    expect(result).toMatchObject({ ok: true, tracked: true, satisfied: false, code: null });
    expect(result.remainingParts).toBe(1);
  });

  it('refuses a double-speed play at full coverage, and a later 1x report does not launder it', async () => {
    // The rate persisted is the running MAXIMUM, not the instantaneous one:
    // otherwise a child sets 2x, plays through, sets it back to 1x before the
    // final sample, and passes. Refreshing the page must not launder it either.
    const codeRef = await seedCode({ requireParts: 1 });
    const offer = await seedOffer({ codeRef });

    const fast = await report(offer, {
      partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[0, 100]], maxRate: 2,
    });
    expect(fast).toMatchObject({ satisfied: false, code: null });

    const slow = await report(offer, {
      partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[0, 100]], maxRate: 1,
    });
    expect(slow).toMatchObject({ satisfied: false, code: null, remainingParts: 1 });
  });

  it('require_parts: 1 — the first part to clear releases the code, and satisfiedVia names it', async () => {
    // Psalms 70–72; 77 is four chapters and only one has to be done. The rest
    // stay as enrichment and never gate.
    const codeRef = await seedCode({ requireParts: 1 });
    const offer = await seedOffer({ codeRef });

    const result = await report(offer, {
      partId: PARTS[1].id, durationSeconds: 200, playedRanges: [[0, 200]],
    });

    expect(result).toMatchObject({ satisfied: true, remainingParts: 0 });
    expect(result.code).toEqual(CODE);
    const record = await companionCodes.get(codeRef);
    expect(record.satisfiedVia).toBe(PARTS[1].contentId);
    expect(record.satisfiedBy).toBe('test-user');
    expect(record.satisfiedAt).toBe(NOW);
  });

  it('require_parts: all — every part must clear before the code is released', async () => {
    const codeRef = await seedCode({ requireParts: PARTS.length });
    const offer = await seedOffer({ codeRef });

    const remaining = [];
    for (const part of PARTS.slice(0, PARTS.length - 1)) {
      // Sequential by design: each report must land before the next, exactly as
      // a child working through the chapters would send them.
      const step = await report(offer, { partId: part.id, durationSeconds: 100, playedRanges: [[0, 100]] });
      expect(step).toMatchObject({ satisfied: false, code: null });
      remaining.push(step.remainingParts);
    }
    expect(remaining).toEqual([3, 2, 1]);

    const last = await report(offer, {
      partId: PARTS[PARTS.length - 1].id, durationSeconds: 100, playedRanges: [[0, 100]],
    });
    expect(last).toMatchObject({ satisfied: true, remainingParts: 0 });
    expect(last.code).toEqual(CODE);
  });

  it('hands a sibling the code on the FIRST call, with no playback of their own', async () => {
    // Household-wide satisfaction, by design: the code scope drops the learner,
    // and the assumption is the second child was in the room when the first
    // played it. The second child's first progress ping answers with the code.
    const codeRef = await seedCode({ requireParts: 1 });
    const firstChild = await seedOffer({ id: 'ral_learner1', learnerId: 'test-user', codeRef });
    await report(firstChild, { partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[0, 100]] });

    const sibling = await seedOffer({ id: 'ral_learner2', learnerId: 'sibling-user', codeRef });
    const result = await report(sibling, { partId: PARTS[0].id });

    expect(result).toMatchObject({ ok: true, tracked: true, satisfied: true, remainingParts: 0 });
    expect(result.code).toEqual(CODE);
    // The first satisfier keeps the credit; a later reader does not overwrite it.
    const record = await companionCodes.get(codeRef);
    expect(record.satisfiedBy).toBe('test-user');
  });

  it('never returns a code for an OPTIONAL companion, however much of it was played', async () => {
    const offer = await seedOffer({ participation: 'optional', codeRef: null });

    const result = await report(offer, {
      partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[0, 100]], completed: true,
    });

    expect(result).toMatchObject({ ok: true, tracked: true, satisfied: false, code: null });
  });

  it('keeps writing the per-learner part telemetry the frontend already sends', async () => {
    // position/duration/completed are not evidence, but they are still the
    // record of where a child got to and the player resumes from them.
    const codeRef = await seedCode({ requireParts: 1 });
    const offer = await seedOffer({ codeRef });

    await report(offer, {
      partId: PARTS[0].id, positionSeconds: 42, durationSeconds: 100,
      completed: true, playedRanges: [[0, 42]],
    });

    const stored = await companions.get(offer.id);
    expect(stored.state.parts[PARTS[0].id]).toMatchObject({
      lastPositionSeconds: 42, durationSeconds: 100, completedAt: NOW,
    });
  });
});

describe('LessonCompanionHandlers registry', () => {
  it('answers {ok: true, tracked: false} for a handler with no recordProgress', async () => {
    const registry = new LessonCompanionHandlers([{ name: 'poster', async open() { return {}; } }]);
    const result = await registry.recordProgress({
      offer: { id: 'ral_poster1', companion: { handler: 'poster' } }, payload: {},
    });
    expect(result).toEqual({ ok: true, tracked: false });
  });

  it('passes the coverage payload through to the handler that owns it', async () => {
    const codeRef = await seedCode({ requireParts: 1 });
    const offer = await seedOffer({ codeRef });
    const registry = new LessonCompanionHandlers([handler()]);

    const result = await registry.recordProgress({
      offer, payload: { partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[0, 100]] },
    });

    expect(result).toMatchObject({ ok: true, tracked: true, satisfied: true, remainingParts: 0 });
    expect(result.code).toEqual(CODE);
  });
});

describe('RecordLessonCompanionProgress', () => {
  const useCase = () => new RecordLessonCompanionProgress({
    companions, handlers: new LessonCompanionHandlers([handler()]),
  });

  it('carries the coverage evidence through to the verdict', async () => {
    const codeRef = await seedCode({ requireParts: 1 });
    const offer = await seedOffer({ codeRef });

    const result = await useCase().execute({
      id: offer.id, partId: PARTS[0].id, durationSeconds: 100, playedRanges: [[0, 100]], maxRate: 1,
    });

    expect(result).toMatchObject({ ok: true, tracked: true, satisfied: true, remainingParts: 0 });
    expect(result.code).toEqual(CODE);
  });

  it('answers ok:false for an offer that no longer exists', async () => {
    expect(await useCase().execute({ id: 'ral_missing1', partId: PARTS[0].id }))
      .toEqual({ ok: false, tracked: false });
  });
});
