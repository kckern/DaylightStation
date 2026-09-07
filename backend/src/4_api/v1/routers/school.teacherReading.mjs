/**
 * `/teacher/learners/:learnerId/reading` — the grown-up's reading workspace
 * (teacher reading admin design §5).
 *
 * `learners`, not `students`: every learner-scoped teacher API route already
 * reads `/teacher/learners/:learnerId/…` — timeline, courses, answer sheets,
 * agenda dispatch. The console's own URL keeps saying `students`; the two
 * vocabularies already differ and one more split inside a router would be a
 * second convention to remember.
 *
 * A thin shell, and deliberately so. Every gate, every reason requirement,
 * every stale-save refusal and every note to a child lives in the use case, so
 * a second caller (a CLI, a test, a future surface) cannot reach the shelf
 * through a door with weaker rules. What this file owns is the address, the
 * shape of the request, and `no-store` — a child's record must not sit in a
 * shared browser cache on a household screen.
 *
 * The acting teacher is read off the capability session rather than the body:
 * the cookie is what the console actually holds, and a body that named someone
 * else would be attribution the gate never checked. A literal PIN body still
 * works everywhere, which is what keeps the CLI usable.
 *
 * @module api/v1/routers/school.teacherReading
 */

/** The flat, teacher-facing fields of a reading. Evidence is not among them. */
const READING_FIELDS = ['isbn', 'pageCount', 'progressMode', 'status', 'finishedOn'];
/** What one row of evidence may be corrected to. Its id is not a field. */
const ENTRY_FIELDS = ['on', 'page', 'minutes', 'note'];

const pick = (body, fields) => Object.fromEntries(
  fields.filter((field) => body?.[field] !== undefined).map((field) => [field, body[field]]),
);

/**
 * Mount the reading workspace onto the school router.
 *
 * @param {object} args
 * @param {import('express').Router} args.router - the school router
 * @param {Function} args.wrap - the router's error-mapping wrapper
 * @param {Function} args.capabilityProof - reads the cookie + step-up header
 * @param {object} args.useCases - one per verb; a null one answers 404
 */
export function mountTeacherReadingRoutes({
  router, wrap, capabilityProof, notConfigured,
  teacherGate = null, teacherCapabilitySessions = null,
  getBookShelf = null, getLearnerReadings = null, updateReading = null,
  addReadingEntry = null, updateReadingEntry = null, deleteReadingEntry = null,
  addReadingForLearner = null, moveReading = null, deleteReading = null,
  undoReadingRevision = null,
}) {
  const BASE = '/teacher/learners/:learnerId/reading';

  /**
   * Who is asking, and with what proof.
   *
   * The router-level middleware has already put the capability proof on
   * `req.body.pin` for any body-carrying request; a DELETE that sends no body
   * would miss it, so the proof is read again here rather than assumed.
   */
  const actor = (req) => {
    const proof = capabilityProof(req);
    const session = proof ? teacherCapabilitySessions?.status(proof.capabilityToken) : null;
    const body = req.body ?? {};
    return {
      by: (session?.active ? session.userId : null) ?? body.by ?? body.actorId ?? null,
      pin: body.pin ?? proof ?? null,
    };
  };

  const need = (useCase, what) => {
    if (!useCase) throw notConfigured(what);
    return useCase;
  };

  const base = (req) => ({
    learnerId: req.params.learnerId,
    baseRevisionCount: req.body?.baseRevisionCount,
    reason: req.body?.reason ?? null,
    ...actor(req),
  });

  const send = (res, status, body) => res.status(status).set('Cache-Control', 'no-store').json(body);

  /**
   * The whole workspace, served by the SAME `GetBookShelf` the child's
   * grant-gated panel reads. A second projection of a child's reading year
   * would be a second thing to be wrong about it.
   *
   * The gate is asserted HERE rather than inside, because this use case is
   * shared with the child's own route where a launch grant names the learner.
   * Strictly a read: it opens nothing, mints nothing and appends nothing
   * (invariant 7).
   */
  router.get(BASE, wrap(async (req, res) => {
    need(getBookShelf, 'teacher reading shelf');
    need(teacherGate, 'teacher authorization');
    const { by, pin } = actor(req);
    teacherGate.assert({
      userId: by, pin: pin ?? capabilityProof(req),
      action: 'books.shelf.read', context: { learnerId: req.params.learnerId },
    });
    res.set('Cache-Control', 'no-store').json(await getBookShelf.execute({ learnerId: req.params.learnerId }));
  }));

  /** One reading, every entry, and the full revisions list the editor undoes from. */
  router.get(`${BASE}/:readingId`, wrap(async (req, res) => {
    const result = await need(getLearnerReadings, 'teacher reading detail').execute({
      learnerId: req.params.learnerId, readingId: req.params.readingId, ...actor(req),
    });
    send(res, 200, result);
  }));

  /** Identity and state: ISBN, mode, page count, status, finish day. */
  router.patch(`${BASE}/:readingId`, wrap(async (req, res) => {
    const result = await need(updateReading, 'teacher reading edit').execute({
      ...base(req), readingId: req.params.readingId, patch: pick(req.body, READING_FIELDS),
    });
    send(res, 200, result);
  }));

  /** A day they read that never got logged. */
  router.post(`${BASE}/:readingId/entries`, wrap(async (req, res) => {
    const body = req.body ?? {};
    const result = await need(addReadingEntry, 'teacher reading edit').execute({
      ...base(req), readingId: req.params.readingId,
      on: body.on, page: body.page ?? null, minutes: body.minutes ?? null, note: body.note ?? null,
      idempotencyKey: req.get('Idempotency-Key') ?? body.idempotencyKey ?? null,
    });
    send(res, 201, result);
  }));

  /** A page, minutes, or the day itself. */
  router.patch(`${BASE}/:readingId/entries/:entryId`, wrap(async (req, res) => {
    const result = await need(updateReadingEntry, 'teacher reading edit').execute({
      ...base(req), readingId: req.params.readingId, entryId: req.params.entryId,
      patch: pick(req.body, ENTRY_FIELDS),
    });
    send(res, 200, result);
  }));

  /** One row of evidence. Reason required, and the child is told. */
  router.delete(`${BASE}/:readingId/entries/:entryId`, wrap(async (req, res) => {
    const result = await need(deleteReadingEntry, 'teacher reading edit').execute({
      ...base(req), readingId: req.params.readingId, entryId: req.params.entryId,
    });
    send(res, 200, result);
  }));

  /** Take back one change by appending its inverse (design §4). */
  router.post(`${BASE}/:readingId/undo`, wrap(async (req, res) => {
    const result = await need(undoReadingRevision, 'teacher reading undo').execute({
      ...base(req), readingId: req.params.readingId, revisionId: req.body?.revisionId,
    });
    send(res, 200, result);
  }));

  /**
   * A book opened on the child's behalf. No base revision count — nothing was
   * loaded. `where` is the child's own three doors (`starting`, `partway` with
   * a page, `finished` on a day), answered in one call so a book cannot land
   * on the shelf with half of the answer applied.
   */
  router.post(BASE, wrap(async (req, res) => {
    const body = req.body ?? {};
    const result = await need(addReadingForLearner, 'teacher reading edit').execute({
      learnerId: req.params.learnerId, ...actor(req),
      isbn: body.isbn, progressMode: body.progressMode ?? 'page',
      pageCount: body.pageCount ?? null, openedOn: body.openedOn ?? null,
      where: body.where ?? 'starting', page: body.page ?? null,
      finishedOn: body.finishedOn ?? null,
      reason: body.reason ?? null,
      idempotencyKey: req.get('Idempotency-Key') ?? body.idempotencyKey ?? null,
    });
    send(res, 201, result);
  }));

  /**
   * Move it to the child who actually read it — **step-up**
   * `books.reading.reassign`, scoped to the reading id. The grant arrives in
   * `X-Teacher-Step-Up` and rides into the use case as part of the `pin`
   * proof, so the gate that refuses a missing one is the gate every other
   * caller passes through too.
   */
  router.post(`${BASE}/:readingId/reassign`, wrap(async (req, res) => {
    const result = await need(moveReading, 'teacher reading reassignment').execute({
      ...base(req), readingId: req.params.readingId, toLearnerId: req.body?.toLearnerId,
    });
    send(res, 200, result);
  }));

  /** Destroy the reading — **step-up** `books.reading.delete`, reason required. */
  router.delete(`${BASE}/:readingId`, wrap(async (req, res) => {
    const result = await need(deleteReading, 'teacher reading deletion').execute({
      ...base(req), readingId: req.params.readingId,
    });
    send(res, 200, result);
  }));

  return router;
}

export default mountTeacherReadingRoutes;
