import { Router } from 'express';
import { createLogger } from '../../../0_system/logging/logger.mjs';

export default function createPlanRouter(config) {
  const { lifePlanStore, goalStateService, beliefEvaluator, cadenceService, ceremonyService, feedbackService, retroService } = config;
  const router = Router();
  const logger = createLogger({ source: 'backend', app: 'life', context: { router: 'plan' } });

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
