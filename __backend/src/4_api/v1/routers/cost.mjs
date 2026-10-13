import { Router } from 'express';

/** Thin HTTP presenter for cost reporting workflows. */
export default function createCostRouter({ costApiService }) {
  if (!costApiService) throw new Error('costApiService is required');
  const router = Router();
  const route = (operation) => async (req, res, next) => {
    try { res.json(await operation(req.query)); } catch (error) { next(error); }
  };
  const numeric = (query, keys) => ({
    ...query,
    ...Object.fromEntries(keys.map((key) => [key, query[key] == null ? undefined : parseInt(query[key], 10)])),
  });
  router.get('/dashboard', route(query => costApiService.dashboard(query)));
  router.get('/spend/category', route(query => costApiService.spendByCategory(numeric(query, ['depth']))));
  router.get('/spend/user', route(query => costApiService.spendByUser(query)));
  router.get('/spend/resource', route(query => costApiService.spendByResource(query)));
  router.get('/entries', route(query => costApiService.entries(numeric(query, ['page', 'limit']))));
  router.get('/budgets', route(query => costApiService.budgetStatuses(query)));
  return router;
}
