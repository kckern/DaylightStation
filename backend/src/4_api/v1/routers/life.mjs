import { Router } from 'express';
import createPlanRouter from './life/plan.mjs';
import createNowRouter from './life/now.mjs';
import createLogRouter from './life/log.mjs';

export default function createLifeRouter(config) {
  const router = Router();

  router.use('/plan', createPlanRouter(config));
  router.use('/now', createNowRouter(config));
  router.use('/log', createLogRouter(config));

  return router;
}
