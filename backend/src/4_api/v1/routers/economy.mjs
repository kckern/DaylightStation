import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Household economy API — per-user wallets, earn/deposit, and metered spend sessions.
 *
 * Thin HTTP layer: input pass-through + delegation to the injected EconomyService,
 * which owns policy resolution, ledger writes, and wallet snapshots. Domain errors
 * (ValidationError → 400, EntityNotFoundError → 404) are shaped by
 * errorHandlerMiddleware({ shape: 'string' }).
 *
 * Routes (mounted at /api/v1/economy):
 *   GET  /users/:userId/wallet                          → { userId, balance, session }
 *   POST /users/:userId/deposit                         → { userId, balance }
 *   POST /users/:userId/earn                            → { userId, earned, capped, duplicate, balance }
 *   POST /users/:userId/sessions                        → { userId, sessionId, balance, drainPerSecond }
 *   POST /users/:userId/sessions/:sessionId/settle      → { userId, balance, depleted }   (coins = CUMULATIVE consumed)
 *   POST /users/:userId/sessions/:sessionId/close       → { userId, balance }             (coins = CUMULATIVE consumed)
 */
export function createEconomyRouter({ economyService, logger = console }) {
  if (!economyService) throw new Error('createEconomyRouter requires economyService');
  const router = express.Router();

  router.get('/users/:userId/wallet', asyncHandler(async (req, res) => {
    res.json(await economyService.getBalance(req.params.userId));
  }));

  router.post('/users/:userId/deposit', asyncHandler(async (req, res) => {
    res.json(await economyService.deposit(req.params.userId, req.body || {}));
  }));

  router.post('/users/:userId/earn', asyncHandler(async (req, res) => {
    res.json(await economyService.earn(req.params.userId, req.body || {}));
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

  // Expected errors → { error: "<message>", code }; unexpected 500s → hidden.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createEconomyRouter;
