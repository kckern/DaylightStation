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
 * @returns {import('express').Router}
 */
export function createSchoolSelfServiceRouter({ resolveAccessCode, runSelfServiceAction } = {}) {
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

  return router;
}

export default createSchoolSelfServiceRouter;
