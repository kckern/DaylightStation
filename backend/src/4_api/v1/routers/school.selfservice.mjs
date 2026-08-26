/**
 * /api/v1/school/self-service — the school-room wall panel's keypad
 * (self-service access codes design, §4).
 *
 * A child types six digits and this answers with a launch card (`/resolve`),
 * then presses one of its buttons and this makes something happen (`/act`).
 *
 * TWO RULES, both inherited from the paper path they replace:
 *
 *  - **It never dead-ends.** An unknown, expired or revoked code is not an
 *    error — it is a card that says "Try again." So `/resolve` answers 200
 *    with `{ ok: false, sentence }` and `/act` answers 200 with
 *    `{ outcome: 'refused', sentence }`, never 4xx and never a thrown 500. A
 *    keypad showing an HTTP status to a seven-year-old is the failure this
 *    subsystem exists to avoid, and both use cases are written to not throw.
 *  - **`/resolve` never writes; `/act` is where writing is allowed.**
 *    `ResolveAccessCode` reads the plan and reduces the session, opening
 *    nothing — so a child typing a sibling's code cannot write `created`
 *    events into that sibling's history. `RunSelfServiceAction` opens the
 *    session for real, because by then a button has actually been pressed.
 *    That split is the point of there being two routes rather than one.
 *
 * Both carry `Cache-Control: no-store`: the body holds a secret-ish code, so
 * `/resolve` is a POST for the same reason a login is, not because it mutates.
 *
 * Thin like every other router here: read the body, call one use case, return
 * what came back. `4_api` may not import `#domains/*` (`api-no-domains`), and
 * this file imports nothing but express — every word a child reads is decided
 * in the layers below.
 *
 * @module api/v1/routers/school.selfservice
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * @param {object} deps
 * @param {{execute: (args: {code: string}) => Promise<object>}} deps.resolveAccessCode
 * @param {{execute: (args: {code: string, action: string}) => Promise<object>}} [deps.runSelfServiceAction]
 * @param {{getCoursePoster?: (courseId: string) => Promise<Buffer|null>}} [deps.curriculum]
 * @returns {import('express').Router}
 */
export function createSchoolSelfServiceRouter({
  resolveAccessCode,
  runSelfServiceAction,
  recordLessonCompanionProgress = null,
  readPrinterHealth = null,
  curriculum = null,
} = {}) {
  const router = express.Router();

  // Registered only when the use case is actually injected, so a deployment
  // without it 404s rather than half-answering — the same rule the lifecycle
  // router follows for every one of its routes.
  if (resolveAccessCode) {
    router.post('/resolve', asyncHandler(async (req, res) => {
      const { code } = req.body || {};
      const card = await resolveAccessCode.execute({ code });
      res.set('Cache-Control', 'no-store').json(card);
    }));
  }

  // The same card, opened from a link instead of six digits — a grown-up
  // looking at what a learner's panel would draw, without minting anything.
  //
  // A SEPARATE ROUTE, NOT A FLAG ON `/resolve`. A `?preview=1` on the live
  // route would put "is this real?" inside the one request path a child's code
  // travels, where a caller's typo or a stray query string becomes a question
  // about whether a session opens. The split is the same one `/resolve` and
  // `/act` already draw, for the same reason: the guarantee lives in which
  // door you came through.
  //
  // A GET, because it is neither a secret nor a mutation: the segment names a
  // learner and a subject and grants nothing. `no-store` all the same — a
  // cached preview of a plan that has since moved on is a lie about a child's
  // day.
  //
  // Never a 4xx for a bad link: an unreadable payload is a 200 carrying a
  // sentence, exactly as an unknown code is. The panel has one way of saying
  // "that didn't work", and it is words.
  if (resolveAccessCode?.preview) {
    router.get('/preview/:link', asyncHandler(async (req, res) => {
      const card = await resolveAccessCode.preview({ link: req.params.link });
      res.set('Cache-Control', 'no-store').json(card);
    }));
  }

  // Learner-safe artwork for the contextual card. This is intentionally not
  // under `/teacher`: it exposes only the published course cover, never
  // curriculum answers, assignments or history.
  //
  // NO POSTER MEANS 404, NEVER A SUBSTITUTE. This route used to answer a
  // missing cover with a generated hue-gradient carrying the raw course id as
  // its headline. It arrived as HTTP 200, so the panel's `onError` never fired
  // and a child stood in front of a machine-made slab that claimed to be their
  // lesson's artwork. A 404 is the honest answer: the panel draws its own
  // calm placeholder, and a course whose art lives elsewhere (Plex) is
  // resolved by the panel against the image proxy every other surface uses.
  if (curriculum) {
    router.get('/curriculum/:courseId/poster.jpg', asyncHandler(async (req, res) => {
      const bytes = await curriculum.getCoursePoster?.(req.params.courseId);
      if (!bytes) return res.status(404).end();
      return res.set('Cache-Control', 'private, max-age=3600')
        .set('Content-Type', 'image/jpeg')
        .set('X-Content-Type-Options', 'nosniff')
        .send(bytes);
    }));
  }

  if (runSelfServiceAction) {
    // `action` is the `kind` of one of the buttons `/resolve` just handed
    // back. The use case recomputes the card and refuses anything that is not
    // on it — so this router does no validation of its own; a bad `action` is
    // a sentence, not a 400.
    router.post('/act', asyncHandler(async (req, res) => {
      const { code, action } = req.body || {};
      const result = await runSelfServiceAction.execute({ code, action });
      res.set('Cache-Control', 'no-store').json(result);
    }));
  }
  // Is the printer able to print at all? Polled by the panel only while it is
  // asking a child "Did it print?", so it can stop asking and name a jam or an
  // empty tray instead of making a seven-year-old adjudicate one.
  //
  // A GET, and the ONLY route here that is neither a code nor a secret: it
  // says nothing about any child, any lesson or any code — just what the
  // hardware in the kitchen is doing. `no-store` all the same, because a
  // cached "it's fine" is worse than no answer at the moment a tray runs out.
  //
  // Never a 4xx/5xx: `ReadPrinterHealth` catches its own faults and answers
  // `healthy: null` for "cannot tell". The panel's rule is that only an
  // explicit `healthy: false` changes what a child sees, so an unknown here
  // costs nothing and an error status would only tempt a caller to treat
  // "the status check is broken" as "the printer is broken".
  if (readPrinterHealth) {
    router.get('/printer-status', asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await readPrinterHealth.execute());
    }));
  }
  if (recordLessonCompanionProgress) {
    router.post('/companions/:id/progress', asyncHandler(async (req, res) => {
      const result = await recordLessonCompanionProgress.execute({ id: req.params.id, ...(req.body || {}) });
      res.set('Cache-Control', 'no-store').json(result);
    }));
  }

  return router;
}

export default createSchoolSelfServiceRouter;
