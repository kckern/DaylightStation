/**
 * /api/v1/school/self-service — the school-room wall panel's keypad
 * (self-service access codes design, §4).
 *
 * A child types six digits and this answers with a launch card. That is all it
 * does; `/act` (the endpoint that makes something physically happen) is a
 * separate route and is deliberately not here yet.
 *
 * TWO RULES, both inherited from the paper path they replace:
 *
 *  - **It never dead-ends.** An unknown, expired or revoked code is not an
 *    error — it is a card that says "Try again." So `/resolve` answers 200
 *    with `{ ok: false, sentence }`, never 4xx and never a thrown 500. A
 *    keypad showing an HTTP status to a seven-year-old is the failure this
 *    subsystem exists to avoid, and the use case is written to not throw.
 *  - **It never writes.** `ResolveAccessCode` reads the plan and reduces the
 *    session; it opens nothing. This router adds no side effect of its own,
 *    which is why the POST carries `Cache-Control: no-store` rather than any
 *    kind of write semantics — the body carries a secret-ish code, so it is a
 *    POST for the same reason a login is, not because it mutates.
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
 * @returns {import('express').Router}
 */
export function createSchoolSelfServiceRouter({ resolveAccessCode } = {}) {
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

  return router;
}

export default createSchoolSelfServiceRouter;
