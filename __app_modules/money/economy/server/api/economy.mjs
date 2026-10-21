import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Household economy API — per-user wallets, earn/deposit, and metered spend sessions.
 *
 * Thin HTTP layer: input pass-through + delegation to the injected EconomyService
 * (except `source`: deposit stamps `admin`, earn `api`, whatever the body says),
 * which owns policy resolution, ledger writes, and wallet snapshots. Domain errors
 * (ValidationError → 400, EntityNotFoundError → 404) are shaped by
 * errorHandlerMiddleware({ shape: 'string' }).
 *
 * Routes (mounted at /api/v1/economy):
 *   GET  /users/:userId/wallet                          → { userId, balance, balances: {silver, gold, gems}, session }   (`balance` is the silver figure)
 *   POST /users/:userId/deposit                         → { userId, balance }
 *   POST /users/:userId/earn                            → { userId, earned, capped, duplicate, balance }
 *   POST /users/:userId/sessions                        → { userId, sessionId, balance, drainPerSecond }
 *   POST /users/:userId/sessions/:sessionId/settle      → { userId, balance, depleted }   (coins = CUMULATIVE consumed)
 *   POST /users/:userId/sessions/:sessionId/close       → { userId, balance }             (coins = CUMULATIVE consumed)
 *   GET  /users/:userId/bank                            → { studyDay, balances, history, pass: {[privilege]}, offers, weekEndsAt }
 *   POST /users/:userId/passes                {privilege, coin}            → { userId, pass, balances }
 *   POST /users/:userId/passes/:passId/consume {playedMs}                   → { userId, pass, duplicate }
 *   POST /users/:userId/passes/:passId/refund  {playedMs, reason}           → { userId, pass, refunded, duplicate, balances }
 *
 * Passes are `authorization: trust`: no PIN, a kid buys their own; the user
 * only has to exist. Refusals carry their code: PASS_CAP, PASS_NOT_SOLD,
 * PASS_NOT_ACTIVE, PASS_REFUND_CLOSED → 409 (a well-formed ask the current
 * state or catalog refuses); PASS_UNAFFORDABLE → 402 with `{coin, price,
 * balance, shortfall}`; an unknown pass → 404; bad input → 400.
 */
const PASS_STATUS = Object.freeze({
  PASS_CAP: 409, PASS_NOT_SOLD: 409, PASS_NOT_ACTIVE: 409, PASS_REFUND_CLOSED: 409, PASS_UNAFFORDABLE: 402,
});

/** A pass refusal answers with its own status (and the shortfall); anything else goes to the error middleware. */
const passRoute = (fn) => asyncHandler(async (req, res, next) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const status = PASS_STATUS[err?.code];
    if (!status) throw err;
    const details = err.code === 'PASS_UNAFFORDABLE' && err.details ? err.details : {};
    res.status(status).json({ error: err.message, code: err.code, ...details });
  }
});

export function createEconomyRouter({ economyService, bankService = null, logger = console }) {
  if (!economyService) throw new Error('createEconomyRouter requires economyService');
  const router = express.Router();

  router.get('/users/:userId/wallet', asyncHandler(async (req, res) => {
    res.json(await economyService.getBalance(req.params.userId));
  }));

  // `source` is the server's, never the body's: a body naming `payout` or
  // `week-close` must not pass for a ledger entry those jobs wrote.
  router.post('/users/:userId/deposit', asyncHandler(async (req, res) => {
    const { amount, note } = req.body || {};
    res.json(await economyService.deposit(req.params.userId, { amount, note, source: 'admin' }));
  }));

  router.post('/users/:userId/earn', asyncHandler(async (req, res) => {
    const { action, ref, amount } = req.body || {};
    res.json(await economyService.earn(req.params.userId, { action, ref, amount, source: 'api' }));
  }));

  router.post('/users/:userId/sessions', asyncHandler(async (req, res) => {
    res.json(await economyService.openSession(req.params.userId, req.body || {}));
  }));

  router.post('/users/:userId/sessions/:sessionId/settle', asyncHandler(async (req, res) => {
    res.json(await economyService.settleSession(req.params.userId, {
      sessionId: req.params.sessionId,
      coins: req.body?.coins,
    }));
  }));

  router.post('/users/:userId/sessions/:sessionId/close', asyncHandler(async (req, res) => {
    res.json(await economyService.closeSession(req.params.userId, {
      sessionId: req.params.sessionId,
      coins: req.body?.coins ?? 0,
    }));
  }));

  if (bankService) {
    router.get('/users/:userId/bank', asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await bankService.bank(req.params.userId));
    }));
  }

  // Only these fields are read from a body; `source` is always the pass's own.
  router.post('/users/:userId/passes', passRoute((req) => {
    const { privilege, coin } = req.body || {};
    return economyService.buyPass(req.params.userId, { privilege, coin });
  }));

  router.post('/users/:userId/passes/:passId/consume', passRoute((req) => economyService.consumePass(req.params.userId, {
    passId: req.params.passId, playedMs: req.body?.playedMs ?? null,
  })));

  router.post('/users/:userId/passes/:passId/refund', passRoute((req) => economyService.refundPass(req.params.userId, {
    passId: req.params.passId, playedMs: req.body?.playedMs, reason: req.body?.reason ?? null,
  })));

  // Expected errors → { error: "<message>", code }; unexpected 500s → hidden.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createEconomyRouter;
