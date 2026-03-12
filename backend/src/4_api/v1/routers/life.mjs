import { Router } from 'express';
import createPlanRouter from './life/plan.mjs';

export default function createLifeRouter(config) {
  const router = Router();

  router.use('/plan', createPlanRouter(config));

  return router;
}
