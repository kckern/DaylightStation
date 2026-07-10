import { Router } from 'express';
import { createLogger } from '#system/logging/logger.mjs';

export default function createPlanRouter(config) {
  const { lifePlanStore, goalStateService, beliefEvaluator, cadenceService, ceremonyService, feedbackService, retroService, planAuthoringService } = config;
  const router = Router();
  const logger = createLogger({ source: 'backend', app: 'life', context: { router: 'plan' } });

  // Resolved by the parent life router's identity middleware; the query
  // fallback keeps directly-mounted sub-routers (tests) working.
  const getUsername = (req) => req.lifeUsername || req.query.username || 'default';

  // GET / — full plan
  router.get('/', async (req, res, next) => {
    try {
      const plan = lifePlanStore.load(getUsername(req));
      res.json(plan?.toJSON() || {});
    } catch (error) { next(error); }
  });

  // POST / — plan genesis (409 if one already exists)
  router.post('/', (req, res, next) => {
    try {
      if (!planAuthoringService) return res.status(501).json({ error: 'Plan authoring service not configured' });
      const username = getUsername(req);
      if (lifePlanStore.load(username)) return res.status(409).json({ error: 'Plan already exists' });
      planAuthoringService.createPlan(username);
      logger.info('life.plan.created', { username });
      res.status(201).json({ ok: true });
    } catch (error) { next(error); }
  });

  // POST /goals — author a new goal (creates the plan if missing)
  router.post('/goals', (req, res, next) => {
    try {
      if (!planAuthoringService) return res.status(501).json({ error: 'Plan authoring service not configured' });
      const { name, why, milestone } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const username = getUsername(req);
      const goal = planAuthoringService.addGoal(username, { name, why, milestone });
      logger.info('life.goal.created', { username, goalId: goal.id });
      res.status(201).json(goal);
    } catch (error) { next(error); }
  });

  // POST /values — author a new value (creates the plan if missing)
  router.post('/values', (req, res, next) => {
    try {
      if (!planAuthoringService) return res.status(501).json({ error: 'Plan authoring service not configured' });
      const { name, description } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name is required' });
      const username = getUsername(req);
      const value = planAuthoringService.addValue(username, { name, description });
      logger.info('life.value.created', { username, valueId: value.id });
      res.status(201).json(value);
    } catch (error) { next(error); }
  });

  // POST /beliefs — author a new belief (creates the plan if missing)
  router.post('/beliefs', (req, res, next) => {
    try {
      if (!planAuthoringService) return res.status(501).json({ error: 'Plan authoring service not configured' });
      const { if_hypothesis, then_outcome } = req.body || {};
      if (!if_hypothesis || !then_outcome) {
        return res.status(400).json({ error: 'if_hypothesis and then_outcome are required' });
      }
      const username = getUsername(req);
      const belief = planAuthoringService.addBelief(username, { if_hypothesis, then_outcome });
      logger.info('life.belief.created', { username, beliefId: belief.id });
      res.status(201).json(belief);
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
        logger.info('life.plan.section-updated', { username, section });
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
      const prevState = goal.state;
      goalStateService.transition(goal, newState, reason);
      lifePlanStore.save(username, plan);
      logger.info('life.goal.transitioned', { username, goalId: req.params.goalId, from: prevState, to: newState, reason });
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
      logger.info('life.belief.evidence-added', { username, beliefId: req.params.id });
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

  // GET /ceremony/:type — get ceremony content
  router.get('/ceremony/:type', async (req, res, next) => {
    try {
      if (!ceremonyService) return res.status(501).json({ error: 'Ceremony service not configured' });
      const content = ceremonyService.getCeremonyContent(req.params.type, getUsername(req));
      if (!content) return res.status(400).json({ error: `Unknown ceremony type: ${req.params.type}` });
      res.json(content);
    } catch (error) { next(error); }
  });

  // POST /ceremony/:type/complete — record ceremony completion
  router.post('/ceremony/:type/complete', async (req, res, next) => {
    try {
      if (!ceremonyService) return res.status(501).json({ error: 'Ceremony service not configured' });
      const ok = ceremonyService.completeCeremony(req.params.type, getUsername(req), req.body);
      if (!ok) return res.status(400).json({ error: `Unknown ceremony type: ${req.params.type}` });
      logger.info('life.ceremony.completed', { username: getUsername(req), type: req.params.type });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  // POST /feedback — record observation
  router.post('/feedback', async (req, res, next) => {
    try {
      if (!feedbackService) return res.status(501).json({ error: 'Feedback service not configured' });
      feedbackService.recordObservation(getUsername(req), req.body);
      logger.info('life.feedback.recorded', { username: getUsername(req) });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  // GET /feedback — get feedback entries
  router.get('/feedback', async (req, res, next) => {
    try {
      if (!feedbackService) return res.status(501).json({ error: 'Feedback service not configured' });
      const period = req.query.start && req.query.end
        ? { start: req.query.start, end: req.query.end }
        : null;
      const entries = feedbackService.getFeedback(getUsername(req), period);
      res.json({ feedback: entries });
    } catch (error) { next(error); }
  });

  // GET /retro — generate retrospective
  router.get('/retro', async (req, res, next) => {
    try {
      if (!retroService) return res.status(501).json({ error: 'Retro service not configured' });
      const period = req.query.start && req.query.end
        ? { start: req.query.start, end: req.query.end }
        : null;
      const retro = retroService.generateRetro(getUsername(req), period);
      res.json(retro);
    } catch (error) { next(error); }
  });

  return router;
}
