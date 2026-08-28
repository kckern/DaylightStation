/**
 * reading.mjs — the living-room reading session's HTTP door.
 *
 * Three routes, all called by ONE caller: the `school-reading` screen widget on
 * the living-room TV. Everything else about a session arrives over the trigger
 * path and leaves over the event bus; these are the three things the screen
 * knows that the backend cannot work out for itself.
 *
 *   POST /playing  the story actually started rolling
 *   POST /read     the story finished — write the evidence
 *   GET  /summary  what to put in front of the child at the prompt
 *
 * WHY `POST /playing` EXISTS AT ALL. The interceptor moves a session to
 * `confirm` on a pick, and the state machine's mid-story branch (D5) keys on
 * `reading` — but nothing in the backend can see the first frame. Without this
 * route `state` never leaves `confirm`, D5 never fires in the field, and EVERY
 * book tapped during a story is claimed as if it were a fresh prompt, in
 * browsing mode too. It reports PLAYBACK START, not countdown expiry: those
 * differ by however long the content takes to load, and the gap between them is
 * exactly when a stray tap misbehaves.
 *
 * ATTRIBUTION IS CARRIED, NEVER RE-DERIVED. Both POSTs take `learnerId` from
 * the body — the screen's own snapshot of who the session belonged to when the
 * book was PICKED. Reading it back off the session here would credit a story to
 * whoever wandered past the reader while it played (D4), which is the one
 * mistake this feature can make that nobody would ever notice.
 *
 * NOTHING HERE IS A GATE. A child at the TV has no code to type and no grown-up
 * to fetch; these routes are as open as the trigger that reaches them, and the
 * evidence they write is a book title, not a grade.
 *
 * Layer: API (4_api/v1/routers). Mounted at /api/v1/school/reading.
 *
 * @module api/v1/routers/reading
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/** How many of yesterday's books the prompt names. A preschooler remembers a few. */
const YESTERDAY_LIMIT = 4;

/** The study day before this one. Keys are plain `YYYY-MM-DD`, so this is safe. */
function dayBefore(studyDay) {
  const midnight = Date.parse(`${studyDay}T00:00:00.000Z`);
  if (!Number.isFinite(midnight)) return null;
  return new Date(midnight - 86_400_000).toISOString().slice(0, 10);
}

const trimmed = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * A 400 without importing a domain class.
 *
 * The `api-no-domains` rule forbids `4_api` from importing the domain layer,
 * and `errorHandler.mjs` states the alternative in its own comment: routers
 * that cannot import domain classes "stamp `err.status` by NAME at their
 * boundary". `getHttpStatusByName` reads `status` first and `name` second, so
 * this maps to 400 either way — the status and body are identical to what
 * throwing the domain `ValidationError` produced.
 */
function badRequest(message) {
  const err = new Error(message);
  err.name = 'ValidationError';
  err.status = 400;
  return err;
}

/**
 * @param {object} deps
 * @param {{execute: (input: object) => Promise<object>}} deps.recordStoryRead
 * @param {import('#apps/school/ReadingSessionService.mjs').ReadingSessionService} deps.sessions
 * @param {{status: Function, studyDay: Function}} [deps.storyTime] - the
 *   story-time launcher. Absent means the summary answers "unknown" rather
 *   than failing: a child must still be able to pick a book.
 * @param {{listForDay: Function}} [deps.readingLog] - read ONLY, for yesterday.
 * @param {(id: string) => ({name?: string}|null)} [deps.resolveLearner] - the
 *   display name for the prompt. Absent means the screen falls back to the id.
 */
export function createReadingRouter({
  recordStoryRead, sessions, storyTime = null, readingLog = null,
  resolveLearner = null, logger = console,
} = {}) {
  if (!recordStoryRead) throw new Error('createReadingRouter requires recordStoryRead');
  if (!sessions) throw new Error('createReadingRouter requires a sessions store');
  const router = express.Router();

  // WebSocket delivery is intentionally best-effort. A screen that wakes or
  // reloads after an event obtains the authoritative room state here instead
  // of remaining visually idle until the next card tap.
  router.get('/session', asyncHandler(async (req, res) => {
    const location = trimmed(req.query?.location);
    if (!location) throw badRequest('location is required');
    return res.json(sessions.snapshot(location));
  }));
  router.post('/session/ack', asyncHandler(async (req, res) => {
    const location = trimmed(req.body?.location);
    const sessionId = trimmed(req.body?.sessionId);
    if (!location || !sessionId) throw badRequest('location and sessionId are required');
    const session = sessions.acknowledge(location, sessionId);
    return res.json({ ok: Boolean(session), session });
  }));
  // Operator-facing, bounded timeline. It answers questions such as "when did
  // this prompt arrive?" without scraping a kiosk screenshot or correlating
  // several services' logs by hand.
  router.get('/events', asyncHandler(async (req, res) => {
    const location = trimmed(req.query?.location);
    if (!location) throw badRequest('location is required');
    const limit = Number(req.query?.limit);
    const session = sessions.snapshot(location);
    const current = session.session;
    const now = Date.now();
    const isoAge = (value) => {
      const at = Date.parse(value);
      return Number.isFinite(at) ? Math.max(0, now - at) : null;
    };
    return res.json({
      ...session,
      ageMs: current ? isoAge(current.openedAt) : null,
      ackAgeMs: current?.acknowledgedAt ? isoAge(current.acknowledgedAt) : null,
      progressAgeMs: current?.progress?.at ? isoAge(current.progress.at) : null,
      events: sessions.observations(location, { limit }),
    });
  }));
  router.post('/progress', asyncHandler(async (req, res) => {
    const location = trimmed(req.body?.location);
    const sessionId = trimmed(req.body?.sessionId);
    const pickId = trimmed(req.body?.pickId);
    const session = location ? sessions.current(location) : null;
    if (!session || session.sessionId !== sessionId || session.pick?.pickId !== pickId) {
      return res.status(409).json({ ok: false, reason: 'session-or-pick-mismatch' });
    }
    const positionSec = Number(req.body?.positionSec);
    const durationSec = Number(req.body?.durationSec);
    const updated = sessions.update(location, {
      progress: {
        positionSec: Number.isFinite(positionSec) ? positionSec : null,
        durationSec: Number.isFinite(durationSec) ? durationSec : null,
        paused: req.body?.paused === true,
        at: new Date().toISOString(),
      },
    });
    return res.json({ ok: true, session: updated });
  }));
  router.get('/read-status', asyncHandler(async (req, res) => {
    const learnerId = trimmed(req.query?.learnerId);
    const studyDay = trimmed(req.query?.studyDay);
    const pickId = trimmed(req.query?.pickId);
    if (!learnerId || !studyDay || !pickId) throw badRequest('learnerId, studyDay, and pickId are required');
    const read = await readingLog?.findByPickId?.(learnerId, studyDay, pickId) ?? null;
    return res.json({ recorded: Boolean(read), read });
  }));

  /**
   * The story is on screen. `pickId` and `learnerId` are the screen's pick-time
   * snapshot, parked on the session as `playing` so anything reading the
   * session can see WHOSE story is running without inferring it from who is
   * standing there now.
   */
  router.post('/playing', asyncHandler(async (req, res) => {
    const location = trimmed(req.body?.location);
    if (!location) throw badRequest('location is required to report playback');
    const learnerId = trimmed(req.body?.learnerId);
    const contentId = trimmed(req.body?.contentId);
    const pickId = trimmed(req.body?.pickId);
    const current = sessions.current(location);
    const serverPick = current?.pick ?? null;
    if (serverPick?.pickId && serverPick.pickId !== pickId) {
      return res.status(409).json({ ok: false, reason: 'pick-mismatch' });
    }
    const attributedLearnerId = serverPick?.learnerId ?? learnerId;
    const attributedContentId = serverPick?.contentId ?? contentId;

    const updated = sessions.update(location, {
      state: 'reading',
      playing: { learnerId: attributedLearnerId, contentId: attributedContentId, pickId, at: new Date().toISOString() },
    });
    if (!updated) {
      // The session timed out, or a grown-up closed it, while the content
      // loaded. Not an error at anybody: the story is playing regardless, and
      // saying so plainly beats a 404 the screen would have to decode.
      logger.info?.('school.reading.playing-no-session', { location, learnerId, contentId });
      return res.json({ ok: false, reason: 'no-session', state: null });
    }
    // THE LAST CHANCE TO NOTICE, and it is ten minutes before the damage lands.
    // The screen sends the learner it froze at pick time; the session knows who
    // is actually at the reader. When the screen's copy is missing or disagrees,
    // the completion POST that follows is already doomed — but the story has
    // only just started, so this line arrives while there is still time to look.
    // On 2026-08-28 the screen sent null here and nothing remarked on it.
    //
    // ONLY THE MISSING CASE IS A FAULT. A screen learner that merely DIFFERS
    // from the session's is D4 working as designed: a sibling tapped their card
    // mid-story, the session swapped, and the running story keeps the
    // attribution it was picked with. Warning about that would put a scary line
    // in the store for correct behaviour — so it is logged at info, and only
    // the null case, which really does lose the read, is a warning.
    if (!attributedLearnerId) {
      logger.warn?.('school.reading.playing-unattributed', {
        location, contentId, pickId,
        sessionLearnerId: updated.learnerId,
        consequence: 'the completion POST will be rejected and the read lost',
      });
    } else if (attributedLearnerId !== updated.learnerId) {
      logger.info?.('school.reading.playing-learner-differs', {
        location, contentId, pickId,
        screenLearnerId: learnerId,
        sessionLearnerId: updated.learnerId,
        note: 'D4: the story keeps the learner it was picked with; the session has since swapped',
      });
    }
    logger.info?.('school.reading.playback-started', {
      location, learnerId: attributedLearnerId, contentId: attributedContentId, pickId, attributable: Boolean(attributedLearnerId),
    });
    return res.json({ ok: true, state: updated.state, learnerId: updated.learnerId });
  }));

  /**
   * The story finished. `pickId` is the idempotency key — the same one twice is
   * ONE read, because `doneToday` is `rows.length >= target` and a duplicate row
   * is a duplicate book (a player that fires `ended` twice, a screen that
   * remounted mid-story, a retried POST).
   */
  router.post('/read', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const location = trimmed(body.location);
    const current = location ? sessions.current(location) : null;
    const serverPick = location ? sessions.current(location)?.pick ?? null : null;
    const requestPickId = trimmed(body.pickId);
    const requestSessionId = trimmed(body.sessionId);
    if (requestSessionId && (!current || current.sessionId !== requestSessionId || !serverPick)) {
      return res.status(409).json({ recorded: false, reason: 'session-or-pick-expired' });
    }
    if (serverPick?.pickId && serverPick.pickId !== requestPickId) {
      return res.status(409).json({ recorded: false, reason: 'pick-mismatch' });
    }
    let read;
    try {
      read = await recordStoryRead.execute({
        learnerId: serverPick?.learnerId ?? body.learnerId,
        contentId: serverPick?.contentId ?? trimmed(body.contentId),
        title: trimmed(body.title),
        tagUid: trimmed(body.tagUid),
        location: trimmed(body.location),
        pickId: serverPick?.pickId ?? requestPickId,
        studyDay: serverPick?.studyDay ?? null,
      });
    } catch (err) {
      // A REJECTED READ IS THE WORST FAILURE THIS FEATURE HAS, and it was
      // invisible from the backend: `RecordStoryRead` throws before it logs
      // anything, so a story that played to its end and was refused left no
      // trace here at all. Only the screen said so (`record-failed`), and only
      // if the screen was still alive to say it.
      //
      // The learner is echoed RAW, not trimmed — a null or a stray object is
      // exactly the shape worth seeing, and on 2026-08-28 it was null, frozen
      // there by a screen that had missed its own `session-open`.
      logger.error?.('school.reading.read-rejected', {
        location,
        learnerId: body.learnerId ?? null,
        contentId: trimmed(body.contentId),
        pickId: trimmed(body.pickId),
        error: err?.message ?? String(err),
        consequence: 'the story played and the obligation did not move',
      });
      throw err;
    }

    // `READING --ended--> PROMPT` (§5). The evidence is written FIRST and this
    // is a courtesy on top of it — but not an optional one, because it is the
    // transition two other rules stand on. A session left at `reading` after
    // the story ended refuses the next book with "finish this one first" while
    // nothing is playing (D5), and never expires, because the idle sweep
    // exempts `reading` on purpose (D6) — so the TV that D8 stopped from
    // powering itself off stays on all night.
    //
    // The LEARNER is untouched. `update` cannot patch it, and it must not: the
    // read that was just written carries the screen's pick-time snapshot, and
    // whoever the session belongs to now is a different question (D4).
    if (location) sessions.update(location, { state: 'prompt', pick: null, playing: null });

    return res.json({ recorded: true, read });
  }));

  /**
   * The prompt's contents. Every part of this degrades on its own: a broken
   * obligation still answers, an unreadable log still answers, and the child
   * still gets to pick a book. The one thing that must never happen here is a
   * failure that leaves the TV blank in front of a four-year-old.
   */
  router.get('/summary', asyncHandler(async (req, res) => {
    const learnerId = trimmed(req.query?.learnerId);
    if (!learnerId) throw badRequest('learnerId is required');

    let status = null;
    try {
      status = (await storyTime?.status?.({ userId: learnerId })) ?? null;
    } catch (err) {
      logger.warn?.('school.reading.summary-status-failed', { learnerId, error: err.message });
    }

    let yesterday = [];
    const studyDay = (() => {
      try { return storyTime?.studyDay?.() ?? null; } catch { return null; }
    })();
    const previous = studyDay ? dayBefore(studyDay) : null;
    if (previous && readingLog?.listForDay) {
      try {
        const rows = await readingLog.listForDay(learnerId, previous);
        yesterday = (Array.isArray(rows) ? rows : []).slice(0, YESTERDAY_LIMIT)
          .map((row) => ({ title: row?.title ?? null, contentId: row?.contentId ?? null }));
      } catch (err) {
        // A memory, not the prompt. Losing it is worth a log line and nothing else.
        logger.warn?.('school.reading.summary-yesterday-failed', { learnerId, day: previous, error: err.message });
      }
    }

    let displayName = null;
    try { displayName = trimmed(resolveLearner?.(learnerId)?.name); } catch { displayName = null; }

    return res.json({
      learnerId,
      displayName,
      // `null` where the launcher could not say — never a 0 that reads as
      // "you have read nothing today" when the truth is "nobody knows".
      enrolled: status?.enrolled ?? null,
      error: status ? status.error === true : true,
      count: status?.count ?? null,
      target: status?.target ?? null,
      progressLabel: status?.progressLabel ?? null,
      doneToday: status?.doneToday ?? null,
      studyDay,
      yesterday,
    });
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createReadingRouter;
