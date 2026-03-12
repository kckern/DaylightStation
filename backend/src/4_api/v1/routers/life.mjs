import { Router } from 'express';
import createPlanRouter from './life/plan.mjs';
import createNowRouter from './life/now.mjs';

export default function createLifeRouter(config) {
  const router = Router();

  router.use('/plan', createPlanRouter(config));
  router.use('/now', createNowRouter(config));

  return router;
}
