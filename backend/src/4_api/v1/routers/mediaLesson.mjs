/**
 * mediaLesson.mjs — the gated media lesson's HTTP door.
 *
 * Four routes, all called by ONE caller: the `school-lesson` screen widget on
 * the living-room TV (`frontend/src/modules/School/schoolApi.js` →
 * `lessonSession` / `lessonAnswer` / `lessonPosition` / `lessonEnded`). Sibling
 * of `reading.mjs` and built the same way — deps-injected factory, thin routes,
 * every decision in a use case — because the two screens are the same screen.
 *
 *   GET  /:sessionId          the snapshot the widget opens on
 *   POST /:sessionId/answer   grade one question at a checkpoint
 *   POST /:sessionId/position the playhead heartbeat
 *   POST /:sessionId/ended    the media finished — claim the lesson
 *
 * NOTHING HERE IS A GATE ON THE CALLER. Same as `reading.mjs`: a child at the
 * TV has no code to type and no grown-up to fetch. The gate this file serves
 * is a different one — the COMPREHENSION gate — and it lives entirely in
 * `RecordCheckpointAnswer` and `RecordMediaCompletion`. A client cannot open it
 * by asserting anything: an answer is graded server-side against the bank, and
 * a completion is refused while a checkpoint is outstanding no matter what the
 * body says.
 *
 * ATTRIBUTION IS THE PATH'S, NEVER THE BODY'S. Unlike `reading.mjs` — where the
 * screen carries a pick-time learner id because nothing else can know it — the
 * session here already names its learner on its own `created` event. So the
 * `sessionId` in the URL is the ONLY identity this router passes on, and a body
 * that named a different session or learner would be ignored. That is what
 * makes a lesson's grades unforgeable from the room they are earned in.
 *
 * ## STATUS CODES ARE PART OF THE CONTRACT, AND THE DEFAULT IS A REFUSAL
 *
 * Every use-case status is mapped by hand below, and a status this file has
 * never heard of THROWS (→ 500 through `errorHandlerMiddleware`) rather than
 * falling through to 200. That is not stylistic. `schoolLifecycle.mjs`'s
 * `STATUS_BY_OUTCOME` defaults the unlisted to 200, and a completion refused
 * for outstanding checkpoints therefore answered `200 {released:false}` — a
 * client reading only the code would have taken that for a finished lesson,
 * and that client is a TV in front of a child who did not answer the
 * questions. Adding a status to a use case must break this router loudly, not
 * quietly grant it.
 *
 * `410 Gone` is the one the frontend is built around: `schoolApi` passes 410
 * through untouched and `useMediaLessonSession.endBecauseGone` drops the gate
 * and ends the lesson on it, which is what stops a dead session leaving a
 * paused picture nothing can release. So every "that session is not there"
 * answer — `unknown_session` from either use case, and `uncorrelated` from the
 * completion, which with a `sessionId` in hand means exactly the same thing —
 * is a 410 here.
 *
 * ## WHERE THE PLAYHEAD GOES (and what it does NOT do)
 *
 * `POST /position` reports onto the EXISTING `school-playback` bus topic in the
 * `progress` shape both playback adapters already publish (`seconds`,
 * `percent`, `sessionId`) — investigated per the plan's open question 3, and
 * routed through that topic rather than inventing a second channel.
 *
 * Two things it deliberately is NOT, both verified rather than assumed:
 *
 *   1. **It does not refresh any liveness.** The plan described it as doing so;
 *      no such mechanism exists. `RecordMediaCompletion.checkStalled` computes
 *      its deadline purely from the `media_dispatched` event's `at` plus the
 *      media duration plus grace, and reads no liveness state at all — so
 *      there is nothing here to refresh, and building one would mean either a
 *      new durable event (the domain explicitly declined: `sessionEvents.mjs`
 *      says "a future need for the observed playhead gets its own unambiguous
 *      `positionSeconds`") or new in-memory state this router is not allowed
 *      to hold. The gated stall window is instead widened per checkpoint by
 *      `CHECKPOINT_GRACE_SEC`, which is where that problem is actually solved.
 *   2. **Nothing subscribes to `school-playback` yet.** A repo-wide search
 *      finds producers and their tests only. The report is therefore
 *      observability today — which is precisely why it belongs on the topic
 *      that already carries this vocabulary instead of a new one nobody reads
 *      either.
 *
 * It can never fail at the screen. An absent or unusable position answers
 * `{ok: true, reported: false}`, because the hook posts `position: undefined`
 * whenever it does not know one, and a bus that throws is swallowed: a
 * heartbeat that 500s would be logged by the screen as an error every fifteen
 * seconds for a lesson that is going perfectly.
 *
 * Layer: API (4_api/v1/routers). Mounted at /api/v1/school/lesson.
 *
 * @module api/v1/routers/mediaLesson
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * The playback port's own topic. A literal rather than an import because
 * `api-no-adapters` forbids reaching into `1_adapters` from here — it is the
 * default in `ScreenPlaybackAdapter` and `VirtualPlaybackAdapter`, and it is
 * overridable below so a composition that moved it moves this too.
 */
const DEFAULT_TOPIC = 'school-playback';

/** Who is speaking on the topic. The other two are `screen-playback`/`virtual-playback`. */
const SOURCE = 'lesson-screen';

const trimmed = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A playhead, or null. `0` is a real playhead — the first heartbeat of every lesson. */
const seconds = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * `RecordCheckpointAnswer` status → HTTP.
 *
 * `already_cleared` is a 200 on purpose: the checkpoint IS cleared, the reply
 * says `checkpointCleared: true`, and the gate opens off it. The screen resends
 * an answer whose reply it never saw, and answering that with an error would
 * strand a child in front of a question they have already got right.
 */
const ANSWER_STATUS = Object.freeze({
  graded: 200,
  already_cleared: 200,
  invalid_answer: 400,        // a malformed body is a client fault
  unknown_checkpoint: 404,
  unknown_item: 404,
  not_playing: 409,           // well formed; the session is not where it must be
  not_gated: 409,
  unknown_session: 410,
  ungradable: 422,            // the bank or the item is gone — a grown-up's problem
});

/**
 * `RecordMediaCompletion` status → HTTP.
 *
 * `already_completed` is a 200 here where `schoolLifecycle.mjs` makes it a 409,
 * and the difference is the caller. There, a duplicate scan is worth flagging.
 * Here it is a screen retrying its OWN completion POST: the lesson is recorded
 * and released (`released: true`), so an error status would put "I couldn't
 * save that lesson" over a lesson that is saved.
 *
 * `checkpoints_outstanding` is a 409 — the same call `schoolLifecycle.mjs`
 * already made for the same status, for the reason in the header.
 */
const ENDED_STATUS = Object.freeze({
  completed: 200,
  already_completed: 200,
  not_playing: 409,
  checkpoints_outstanding: 409,
  unknown_session: 410,
  // With a sessionId in the path, "I could not correlate this" means the
  // session is not there — which is the 410 the screen ends the lesson on.
  uncorrelated: 410,
});

/**
 * Map a use-case status, or refuse to guess.
 *
 * The throw is the point: an unmapped status reaches `errorHandlerMiddleware`
 * as a 500, which is a refusal. Defaulting to 200 is how a refused completion
 * once read as a finished lesson.
 */
function statusFor(table, status, { route, logger }) {
  const code = table[status];
  if (code) return code;
  logger.error?.('school.lesson.unmapped-status', { route, status });
  throw new Error(`mediaLesson: unmapped ${route} status '${status}'`);
}

/**
 * @param {object} deps
 * @param {{execute: (input: object) => Promise<object>}} deps.readLessonSnapshot
 * @param {{execute: (input: object) => Promise<object>}} deps.recordCheckpointAnswer
 * @param {{execute: (input: object) => Promise<object>}} deps.recordMediaCompletion
 * @param {{broadcast: Function}} [deps.eventBus] - where the playhead is
 *   reported. Absent means the heartbeat still answers and reports nothing:
 *   the lesson does not depend on it.
 * @param {string} [deps.topic] - the playback port's topic
 * @param {(id: string) => ({name?: string}|null)} [deps.resolveLearner] - the
 *   display name for the score placard. Absent (or throwing) means the id,
 *   which is a worse greeting and not a broken lesson.
 * @param {object} [deps.logger]
 */
export function createMediaLessonRouter({
  readLessonSnapshot, recordCheckpointAnswer, recordMediaCompletion,
  eventBus = null, topic = DEFAULT_TOPIC, resolveLearner = null, logger = console,
} = {}) {
  if (!readLessonSnapshot) throw new Error('createMediaLessonRouter requires readLessonSnapshot');
  if (!recordCheckpointAnswer) throw new Error('createMediaLessonRouter requires recordCheckpointAnswer');
  if (!recordMediaCompletion) throw new Error('createMediaLessonRouter requires recordMediaCompletion');
  const router = express.Router();

  /**
   * The snapshot. Shape is settled HERE and the hook is narrowed to it:
   * `learner` is a `{id, name}` OBJECT (never split across `learnerId` /
   * `learnerName`, which can arrive half-populated), and the cleared set is
   * `cleared` — a list of bare checkpoint ids.
   *
   * `checkpoints` carries `{id, at, items}` with items as PUBLIC BODIES
   * (`{id, type, prompt, choices}`) — this is the only call in the feature that
   * sends a question to a browser, and it withholds every answer field. The
   * projection is `ReadLessonSnapshot`'s, not this router's: a router that
   * picked the public keys would be the second place that decision lived.
   *
   * ONE CALL, on purpose. The questions could have been fetched per checkpoint
   * as each gate fired, which would keep an unasked question out of the client.
   * They are not, because that fetch would sit in the BLOCKING path: the gate
   * has already stopped the picture when the checkpoint fires, so a request
   * that fails there leaves a child in front of a frozen frame with no
   * question and no way forward — the exact failure this feature is written to
   * avoid. Everything needed to run the whole lesson arrives before the first
   * frame, and a kiosk that reloads mid-lesson recovers in one round trip.
   * What is withheld from the client is the ANSWERS, which is the part that
   * matters; prompts and choices are already public at
   * `GET /api/v1/school/banks/:bankId`.
   */
  router.get('/:sessionId', asyncHandler(async (req, res) => {
    const sessionId = trimmed(req.params.sessionId);
    const snapshot = await readLessonSnapshot.execute({ sessionId });
    const code = statusFor({ ok: 200, unknown_session: 410 }, snapshot.status, { route: 'snapshot', logger });
    if (code !== 200) return res.status(code).json({ status: snapshot.status, sessionId });

    // Never fatal: the name is chrome, the lesson is not.
    let name = null;
    try { name = trimmed(resolveLearner?.(snapshot.learnerId)?.name); } catch { name = null; }

    return res.json({
      sessionId: snapshot.sessionId,
      learner: { id: snapshot.learnerId, name: name ?? snapshot.learnerId },
      contentId: snapshot.contentId,
      title: snapshot.title,
      checkpoints: snapshot.checkpoints,
      cleared: snapshot.cleared,
      resumePosition: snapshot.resumePosition,
      seekCeiling: snapshot.seekCeiling,
      state: snapshot.state,
      playing: snapshot.playing,
    });
  }));

  /**
   * Grade one answer. The reply is the use case's own — `{status, correct,
   * attempts, checkpointCleared, seekCeiling, message}` — passed through
   * whole, because the overlay renders every one of those fields and this
   * router has no better word for any of them.
   */
  router.post('/:sessionId/answer', asyncHandler(async (req, res) => {
    const body = req.body || {};
    // The session is the PATH's. A `sessionId` in the body is ignored, so a
    // room cannot grade against a session it was not dispatched.
    const result = await recordCheckpointAnswer.execute({
      sessionId: trimmed(req.params.sessionId),
      checkpointId: trimmed(body.checkpointId),
      itemId: trimmed(body.itemId),
      given: body.given,
    });
    return res.status(statusFor(ANSWER_STATUS, result.status, { route: 'answer', logger })).json(result);
  }));

  /**
   * The playhead heartbeat (~15s while playing, plus one at every gate). See
   * the header for why this reports onto `school-playback` and why it holds
   * nothing: it exists so the house can SEE where a lesson is, and it must
   * never be a reason the lesson stops.
   */
  router.post('/:sessionId/position', asyncHandler(async (req, res) => {
    const sessionId = trimmed(req.params.sessionId);
    const position = seconds(req.body?.position);
    if (position === null) {
      // The normal case, not an error: `lessonPosition` posts an absent
      // position rather than fabricating a 0 when it does not know one.
      return res.json({ ok: true, reported: false, reason: 'no-position' });
    }
    try {
      eventBus?.broadcast?.(topic, {
        source: SOURCE,
        type: 'progress',
        sessionId,
        seconds: position,
        // The router does not know the media's duration and will not read the
        // catalog at 15-second intervals to find out. An absent percent is
        // honest; a computed-from-nothing one would not be.
        percent: null,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn?.('school.lesson.position.report-failed', { sessionId, topic, error: err?.message ?? String(err) });
      return res.json({ ok: true, reported: false, reason: 'bus-unavailable' });
    }
    logger.debug?.('school.lesson.position', { sessionId, seconds: position });
    return res.json({ ok: true, reported: Boolean(eventBus?.broadcast) });
  }));

  /**
   * The media element's own `ended`. `verified: 'playhead'` is hardcoded and
   * must stay so: this route is only ever reached by a screen that watched the
   * playhead run out, and a caller is not allowed to claim a stronger
   * confidence than the one its own evidence supports (`duration` belongs to
   * the stall sweep, which infers it from a clock).
   *
   * `remaining` is a COUNT, mapped from the use case's `outstanding` — how many
   * question stops are still owed, `0` on success. The plan called it
   * `remaining`, the use case calls it `outstanding`, and this is the seam
   * where they meet; the name that reaches the screen is `remaining`.
   */
  router.post('/:sessionId/ended', asyncHandler(async (req, res) => {
    const result = await recordMediaCompletion.execute({
      sessionId: trimmed(req.params.sessionId),
      verified: 'playhead',
    });
    const code = statusFor(ENDED_STATUS, result.status, { route: 'ended', logger });
    return res.status(code).json({
      status: result.status,
      sessionId: result.sessionId,
      completed: result.released === true,
      remaining: result.outstanding ?? 0,
      seekCeiling: result.seekCeiling ?? null,
      nextAction: result.nextAction ?? null,
      message: result.message,
    });
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createMediaLessonRouter;
