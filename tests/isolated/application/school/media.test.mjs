import { describe, it, expect, beforeEach } from 'vitest';
import { DispatchMedia, normaliseTargets } from '#apps/school/usecases/DispatchMedia.mjs';
import { RecordMediaCompletion } from '#apps/school/usecases/RecordMediaCompletion.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakePlayback,
  fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, WORKSHEET_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

/**
 * The video's real running time, read off the manifest the unit points at. The
 * stall window is `duration + grace`, so a hardcoded round number here would
 * test a video that does not exist.
 */
const MEDIA_SEC = rawManifests().find((m) => m.id === fixtureUnit(MEDIA_UNIT).media).durationSec;
const GRACE_SEC = 600;

/**
 * The gated shape, authored on the SAME media unit the rest of this file uses:
 * cp-120 asks one question, cp-300 asks two, and both live inside the 611s
 * video. Ids are `cp-<at>` — derived, never typed.
 */
const CHECKPOINTS = [
  { at: 120, items: ['u1-q1'] },
  { at: 300, items: ['u1-q2', 'u1-q3'] },
];

const SID = 'ses_1';
const TARGETS = [
  { id: 'living-room-tv', label: 'the TV', child_selectable: true },
  { id: 'office-tv', label: 'the office TV', child_selectable: false },
];

let clock, sessions, playback, curriculum, dispatch, completion;

const build = ({ targets = TARGETS, graceSec = GRACE_SEC, checkpoints = null } = {}) => {
  clock = fakeClock();
  const units = checkpoints ? rawUnits({ [MEDIA_UNIT]: { checkpoints } }) : rawUnits();
  const catalog = new FakeCatalog({ units, documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  playback = new FakePlayback();
  dispatch = new DispatchMedia({ curriculum, sessions, playback, targets, clock: clock.now, logger: silentLogger });
  completion = new RecordMediaCompletion({ curriculum, sessions, clock: clock.now, graceSec, logger: silentLogger });
};

const openSession = async (unitId = MEDIA_UNIT, sessionId = SID, learnerId = 'kid1') => {
  await sessions.appendEvent(sessionId, { type: 'created', at: clock.iso(), sessionId, learnerId, unitId });
  return sessionId;
};

/**
 * Clear one checkpoint the way `RecordCheckpointAnswer` does — THROUGH
 * `createEvent`. A hand-built raw event would skip the field whitelist, so a
 * dropped `checkpointId` or `attempts` would pass every assertion here and
 * lose the evidence in production.
 */
const clearCheckpoint = async (checkpointId, { attempts = 1, sessionId = SID } = {}) => {
  const { errors, event } = createEvent({
    type: 'checkpoint_cleared', at: clock.iso(), sessionId, checkpointId, attempts,
  });
  expect(errors).toEqual([]);
  await sessions.appendEvent(sessionId, event);
  return event;
};

beforeEach(() => build());

describe('normaliseTargets', () => {
  it('accepts both spellings of the autonomy flag', () => {
    expect(normaliseTargets([{ id: 'a', child_selectable: true }, { id: 'b', childSelectable: true }, { id: 'c' }]))
      .toEqual([
        { id: 'a', label: 'a', childSelectable: true },
        { id: 'b', label: 'b', childSelectable: true },
        { id: 'c', label: 'c', childSelectable: false },
      ]);
  });

  it('drops entries with no id rather than inventing one', () => {
    expect(normaliseTargets([null, {}, { id: '  ' }, 'tv'])).toEqual([]);
  });
});

describe('DispatchMedia', () => {
  it('sends the manifest locator and duration to the chosen target', async () => {
    await openSession();
    const result = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(result).toMatchObject({ status: 'dispatched', target: 'living-room-tv', contentId: 'plex:481203', durationSec: MEDIA_SEC });
    // `sessionId` is part of the playback port as of the real screen adapter
    // (§8): the screen fetches its lesson BY session id, so a dispatch that
    // does not carry one reaches a widget that can do nothing with it.
    expect(playback.dispatches[0]).toMatchObject({ contentId: 'plex:481203', learnerId: 'kid1', durationSec: MEDIA_SEC, sessionId: SID });
  });

  it('records the dispatch with its correlator', async () => {
    await openSession();
    const result = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(sessions.derive(SID).mediaDispatch).toEqual({
      dispatchId: result.dispatchId, target: 'living-room-tv', contentId: 'plex:481203', status: 'dispatched',
    });
  });

  it('defaults to the one target a child may pick', async () => {
    await openSession();
    expect(await dispatch.execute({ sessionId: SID })).toMatchObject({ status: 'dispatched', target: 'living-room-tv' });
  });

  it('REFUSES a target the child may not pick', async () => {
    await openSession();
    const result = await dispatch.execute({ sessionId: SID, target: 'office-tv' });
    expect(result.status).toBe('unavailable');
    expect(playback.dispatches).toEqual([]);
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('only ever offers the selectable targets', () => {
    expect(dispatch.selectableTargets().map((t) => t.id)).toEqual(['living-room-tv']);
  });

  it('asks which one when several are selectable', async () => {
    build({ targets: [...TARGETS, { id: 'headset-red', label: 'the red headset', child_selectable: true }] });
    await openSession();
    const result = await dispatch.execute({ sessionId: SID });
    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('Pick where');
  });

  it('RE-SCANNING MID-PLAY NEVER DISPATCHES A SECOND TIME', async () => {
    await openSession();
    const first = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    const second = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(second).toMatchObject({ status: 'already_playing', dispatchId: first.dispatchId });
    expect(playback.dispatches).toHaveLength(1);
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
  });

  it('says already_done once the media has been watched', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    await completion.execute({ sessionId: SID });
    const result = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(result.status).toBe('already_done');
    expect(playback.dispatches).toHaveLength(1);
  });

  it('explains a unit with no media instead of dispatching nothing', async () => {
    await openSession(WORKSHEET_UNIT);
    expect(await dispatch.execute({ sessionId: SID })).toMatchObject({ status: 'unavailable' });
  });

  it('records a device that refuses as a retryable failure, not a state change', async () => {
    await openSession();
    playback.dispatch = () => { throw new Error('TV is asleep'); };
    const result = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(result.status).toBe('unavailable');
    expect(sessions.derive(SID)).toMatchObject({ state: 'created', lastFailure: { stage: 'dispatch', reason: 'TV is asleep' } });
  });
});

describe('RecordMediaCompletion', () => {
  const play = async () => {
    await openSession();
    return dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
  };

  it('releases the linked issue action only on completion', async () => {
    await play();
    expect(sessions.derive(SID).nextAction.kind).toBe('await_media_completion');
    const result = await completion.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'completed', released: true });
    expect(result.nextAction).toMatchObject({ kind: 'issue_document', tokenClass: 'issue_document' });
  });

  it('keeps the two confidences apart', async () => {
    await play();
    await completion.execute({ sessionId: SID, verified: 'duration' });
    expect(sessions.derive(SID).mediaDispatch.verified).toBe('duration');
  });

  it('correlates by dispatch id when the caller only knows the learner', async () => {
    const dispatched = await play();
    const result = await completion.execute({ learnerId: 'kid1', dispatchId: dispatched.dispatchId });
    expect(result).toMatchObject({ status: 'completed', sessionId: SID });
  });

  it('stays silent about a completion no session is waiting on', async () => {
    const result = await completion.execute({ learnerId: 'kid1', dispatchId: 'dsp_999' });
    expect(result).toMatchObject({ status: 'uncorrelated', released: false });
  });

  it('is idempotent — a repeated completion signal changes nothing', async () => {
    await play();
    await completion.execute({ sessionId: SID });
    const second = await completion.execute({ sessionId: SID });
    expect(second.status).toBe('already_completed');
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched', 'media_completed']);
  });

  it('ignores a completion for work that is not playing', async () => {
    await openSession();
    expect(await completion.execute({ sessionId: SID })).toMatchObject({ status: 'not_playing', released: false });
    expect(sessions.types(SID)).toEqual(['created']);
  });
});

describe('the stall window', () => {
  it('holds while the media could still be playing', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceMs((MEDIA_SEC + GRACE_SEC) * 1000 - 1000);
    const check = await completion.checkStalled({ sessionId: SID });
    expect(check).toMatchObject({ stalled: false, reason: 'still_within_window' });
    expect(check.secondsRemaining).toBe(1);
  });

  it('stalls once duration plus grace has passed with no signal', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceMs((MEDIA_SEC + GRACE_SEC) * 1000 + 1000);
    expect(await completion.checkStalled({ sessionId: SID })).toMatchObject({ stalled: true });
    expect(sessions.derive(SID).mediaDispatch.status).toBe('stalled');
  });

  it('leaves a replay action rather than a wedged session', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceHours(3);
    const check = await completion.checkStalled({ sessionId: SID });
    expect(check.nextAction).toMatchObject({ kind: 'replay_media', tokenClass: 'media_action' });
  });

  it('lets a stalled session be dispatched again', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceHours(3);
    await completion.checkStalled({ sessionId: SID });
    const again = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(again.status).toBe('dispatched');
    expect(playback.dispatches).toHaveLength(2);
    expect(sessions.derive(SID).errors).toEqual([]);
  });

  it('refuses a late completion for a run already written off', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceHours(3);
    await completion.checkStalled({ sessionId: SID });
    expect(await completion.execute({ sessionId: SID })).toMatchObject({ status: 'not_playing' });
  });

  it('honours a per-call grace override', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceMs((MEDIA_SEC + 1) * 1000);
    expect(await completion.checkStalled({ sessionId: SID, graceSec: 0 })).toMatchObject({ stalled: true });
  });

  it('never stalls something that is not playing', async () => {
    await openSession();
    expect(await completion.checkStalled({ sessionId: SID })).toMatchObject({ stalled: false, reason: 'not_playing' });
  });

  it('sweeps only the learner\'s in-flight media', async () => {
    await openSession(MEDIA_UNIT, 'ses_1');
    await openSession(WORKSHEET_UNIT, 'ses_2');
    await dispatch.execute({ sessionId: 'ses_1', target: 'living-room-tv' });
    clock.advanceHours(3);
    const swept = await completion.sweepStalled({ learnerId: 'kid1' });
    expect(swept.map((s) => s.sessionId)).toEqual(['ses_1']);
    expect(swept[0].stalled).toBe(true);
  });
});

/**
 * The HARD half of the gate.
 *
 * `useCheckpointGate` on the screen deliberately FAILS OPEN when its checkpoint
 * list is unusable — blocking there would freeze a video with no question able
 * to release it. That decision was made on the grounds that the guarantee lives
 * HERE: a client that lost its list, or a child who seeked past a stop, must not
 * be able to claim credit. These are the tests that make that true.
 */
describe('the hard gate — completion with checkpoints outstanding', () => {
  const playGated = async () => {
    build({ checkpoints: CHECKPOINTS });
    await openSession();
    return dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
  };

  it('REFUSES a playhead completion while a checkpoint is outstanding, and writes NOTHING', async () => {
    await playGated();
    const result = await completion.execute({ sessionId: SID, verified: 'playhead' });
    expect(result).toMatchObject({ status: 'checkpoints_outstanding', released: false, sessionId: SID });
    expect(result.message).toContain('2');
    // The whole point: no media_completed on the record.
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
    expect(sessions.derive(SID).mediaDispatch.status).toBe('dispatched');
  });

  it('REFUSES a duration-verified completion just the same — a timer proves no comprehension', async () => {
    await playGated();
    const result = await completion.execute({ sessionId: SID, verified: 'duration' });
    expect(result).toMatchObject({ status: 'checkpoints_outstanding', released: false });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
  });

  it('refuses the correlated-by-dispatch-id route too — there is no side door', async () => {
    const dispatched = await playGated();
    const result = await completion.execute({ learnerId: 'kid1', dispatchId: dispatched.dispatchId });
    expect(result).toMatchObject({ status: 'checkpoints_outstanding', released: false, sessionId: SID });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
  });

  it('still refuses when only SOME are cleared, and names how many are left', async () => {
    await playGated();
    await clearCheckpoint('cp-120', { attempts: 2 });
    // The clear survived `createEvent`'s field whitelist intact.
    expect(sessions.derive(SID).clearedCheckpoints).toEqual([
      { checkpointId: 'cp-120', attempts: 2, at: clock.iso() },
    ]);
    const result = await completion.execute({ sessionId: SID });
    expect(result.status).toBe('checkpoints_outstanding');
    expect(result.message).toContain('One');
    expect(result.outstanding).toBe(1);
    // Where the screen must send the playhead back to.
    expect(result.seekCeiling).toBe(300);
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched', 'checkpoint_cleared']);
  });

  it('COMPLETES once every checkpoint is cleared', async () => {
    await playGated();
    await clearCheckpoint('cp-120');
    await clearCheckpoint('cp-300', { attempts: 3 });
    const result = await completion.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'completed', released: true });
    expect(result.nextAction).toMatchObject({ kind: 'issue_document' });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched', 'checkpoint_cleared', 'checkpoint_cleared', 'media_completed']);
  });

  it('a cleared id the unit does not author does not stand in for a real one', async () => {
    await playGated();
    await clearCheckpoint('cp-120');
    await clearCheckpoint('cp-999');
    expect(await completion.execute({ sessionId: SID })).toMatchObject({ status: 'checkpoints_outstanding', outstanding: 1 });
  });

  it('a unit with NO checkpoints completes exactly as it always did', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    const result = await completion.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'completed', released: true });
    expect(result.outstanding).toBeUndefined();
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched', 'media_completed']);
  });

  it('completes when the unit can no longer be resolved — a stuck refusal has no exit for the child', async () => {
    await playGated();
    curriculum.getUnit = async () => null;
    const result = await completion.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'completed', released: true });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched', 'media_completed']);
  });

  it('lets a curriculum read that THREW surface, rather than completing off a blip', async () => {
    await playGated();
    curriculum.getUnit = async () => { throw new Error('catalog offline'); };
    await expect(completion.execute({ sessionId: SID })).rejects.toThrow('catalog offline');
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
  });

  it('a stalled gated lesson is still refused by STATE, cleared checkpoints or not', async () => {
    await playGated();
    await clearCheckpoint('cp-120');
    await clearCheckpoint('cp-300');
    clock.advanceHours(6);
    await completion.checkStalled({ sessionId: SID });
    expect(await completion.execute({ sessionId: SID })).toMatchObject({ status: 'not_playing' });
  });
});

describe('the stall window on a GATED lesson', () => {
  const perCheckpoint = RecordMediaCompletion.CHECKPOINT_GRACE_SEC;

  it('does not write off a lesson that is merely being answered', async () => {
    build({ checkpoints: CHECKPOINTS });
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    // Past the ungated deadline — which is where an attentive child actually is.
    clock.advanceMs((MEDIA_SEC + GRACE_SEC) * 1000 + 1000);
    expect(await completion.checkStalled({ sessionId: SID })).toMatchObject({ stalled: false, reason: 'still_within_window' });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
  });

  it('still stalls once even the per-checkpoint allowance has run out', async () => {
    build({ checkpoints: CHECKPOINTS });
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceMs((MEDIA_SEC + GRACE_SEC + CHECKPOINTS.length * perCheckpoint) * 1000 + 1000);
    expect(await completion.checkStalled({ sessionId: SID })).toMatchObject({ stalled: true });
  });

  it('leaves an ungated lesson\'s window exactly where it was', async () => {
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    clock.advanceMs((MEDIA_SEC + GRACE_SEC) * 1000 + 1000);
    expect(await completion.checkStalled({ sessionId: SID })).toMatchObject({ stalled: true });
  });
});

describe('DispatchMedia hands the screen its checkpoints', () => {
  it('returns ids and positions with the dispatch', async () => {
    build({ checkpoints: CHECKPOINTS });
    await openSession();
    const result = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(result.status).toBe('dispatched');
    expect(result.checkpoints).toEqual([{ id: 'cp-120', at: 120 }, { id: 'cp-300', at: 300 }]);
  });

  it('NEVER hands out the questions or the answers', async () => {
    build({ checkpoints: CHECKPOINTS });
    await openSession();
    const result = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(result.checkpoints.every((cp) => Object.keys(cp).sort().join(',') === 'at,id')).toBe(true);
    const wire = JSON.stringify(result);
    ['u1-q1', 'u1-q2', 'u1-q3'].forEach((itemId) => expect(wire).not.toContain(itemId));
  });

  it('hands the list back on a mid-play re-scan, so a reloaded screen re-arms its gate', async () => {
    build({ checkpoints: CHECKPOINTS });
    await openSession();
    await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    const again = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(again.status).toBe('already_playing');
    expect(again.checkpoints).toEqual([{ id: 'cp-120', at: 120 }, { id: 'cp-300', at: 300 }]);
  });

  it('a unit with no checkpoints answers null, and is otherwise identical', async () => {
    await openSession();
    const plain = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    expect(plain.checkpoints).toBe(null);

    build({ checkpoints: CHECKPOINTS });
    await openSession();
    const gated = await dispatch.execute({ sessionId: SID, target: 'living-room-tv' });
    const { checkpoints: _a, dispatchId: _b, ...restPlain } = plain;
    const { checkpoints: _c, dispatchId: _d, ...restGated } = gated;
    expect(restPlain).toEqual(restGated);
  });

  it('carries the key on every refusal too, so one shape reaches the screen', async () => {
    build({ checkpoints: CHECKPOINTS });
    await openSession();
    expect(await dispatch.execute({ sessionId: SID, target: 'office-tv' })).toMatchObject({ status: 'unavailable', checkpoints: null });
    expect(await dispatch.execute({ sessionId: 'nope' })).toMatchObject({ status: 'unavailable', checkpoints: null });
  });
});
