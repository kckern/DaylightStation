import { Router } from 'express';

export default function createPlanRouter(config) {
  const { lifePlanStore, goalStateService, beliefEvaluator, cadenceService } = config;
  const router = Router();

  const getUsername = (req) => req.query.username || 'default';

  // GET / — full plan
  router.get('/', async (req, res, next) => {
    try {
      const plan = lifePlanStore.load(getUsername(req));
      res.json(plan?.toJSON() || {});
    } catch (error) { next(error); }
  });

  // PATCH /:section — update section
  router.patch('/:section', async (req, res, next) => {
    try {
      const username = getUsername(req);
      const plan = lifePlanStore.load(username);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const section = req.params.section;
      const data = req.body;

      if (plan[section] !== undefined) {
        if (Array.isArray(plan[section])) {
          plan[section] = data;
        } else if (typeof plan[section] === 'object' && plan[section] !== null) {
          Object.assign(plan[section], data);
        } else {
          plan[section] = data;
        }
        lifePlanStore.save(username, plan);
        res.json({ ok: true });
      } else {
        res.status(400).json({ error: `Unknown section: ${section}` });
      }
    } catch (error) { next(error); }
  });

  // GET /goals — all goals, optionally filtered by state
  router.get('/goals', async (req, res, next) => {
    try {
      const plan = lifePlanStore.load(getUsername(req));
      if (!plan) return res.json({ goals: [] });

      const { state } = req.query;
      const goals = state ? plan.getGoalsByState(state) : plan.goals;
      res.json({ goals: goals.map(g => g.toJSON()) });
    } catch (error) { next(error); }
  });

  // GET /goals/:goalId — single goal
  router.get('/goals/:goalId', async (req, res, next) => {
    try {
      const plan = lifePlanStore.load(getUsername(req));
      const goal = plan?.getGoalById(req.params.goalId);
      if (!goal) return res.status(404).json({ error: 'Goal not found' });
      res.json(goal.toJSON());
    } catch (error) { next(error); }
  });

  // POST /goals/:goalId/transition — state transition
  router.post('/goals/:goalId/transition', async (req, res, next) => {
    try {
      const username = getUsername(req);
      const plan = lifePlanStore.load(username);
      const goal = plan?.getGoalById(req.params.goalId);
      if (!goal) return res.status(404).json({ error: 'Goal not found' });

      const { state: newState, reason } = req.body;
      goalStateService.transition(goal, newState, reason);
      lifePlanStore.save(username, plan);
      res.json(goal.toJSON());
    } catch (error) {
      if (error.message?.includes('cannot transition')) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // GET /beliefs — all beliefs
  router.get('/beliefs', async (req, res, next) => {
    try {
      const plan = lifePlanStore.load(getUsername(req));
      if (!plan) return res.json({ beliefs: [] });
      res.json({ beliefs: plan.beliefs.map(b => b.toJSON()) });
    } catch (error) { next(error); }
  });

  // POST /beliefs/:id/evidence — add evidence
  router.post('/beliefs/:id/evidence', async (req, res, next) => {
    try {
      const username = getUsername(req);
      const plan = lifePlanStore.load(username);
      const belief = plan?.getBeliefById(req.params.id);
      if (!belief) return res.status(404).json({ error: 'Belief not found' });

      beliefEvaluator.evaluateEvidence(belief, req.body);
      lifePlanStore.save(username, plan);
      res.json(belief.toJSON());
    } catch (error) { next(error); }
  });

  // GET /cadence — cadence config
  router.get('/cadence', async (req, res, next) => {
    try {
      const plan = lifePlanStore.load(getUsername(req));
      const cadenceConfig = plan?.cadence || {};
      const resolved = cadenceService.resolve(cadenceConfig, new Date());
      res.json({ config: cadenceConfig, current: resolved });
    } catch (error) { next(error); }
  });

  // PATCH /cadence — update cadence
  router.patch('/cadence', async (req, res, next) => {
    try {
      const username = getUsername(req);
      const plan = lifePlanStore.load(username);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      plan.cadence = { ...(plan.cadence || {}), ...req.body };
      lifePlanStore.save(username, plan);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}
