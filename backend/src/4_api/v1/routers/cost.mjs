/**
 * Cost API Router
 *
 * Endpoints for cost tracking and budget management:
 * - GET /api/v1/cost/dashboard - Get cost dashboard summary
 * - GET /api/v1/cost/spend/category - Get spend breakdown by category
 * - GET /api/v1/cost/spend/user - Get spend breakdown by user
 * - GET /api/v1/cost/spend/resource - Get spend breakdown by resource
 * - GET /api/v1/cost/entries - Get paginated cost entries
 * - GET /api/v1/cost/budgets - Get budget statuses
 *
 * @module api/v1/routers/cost
 */

import { Router } from 'express';

/**
 * Create cost API router
 *
 * @param {Object} config - Router configuration
 * @param {Object} config.reportingService - CostReportingService instance (required)
 * @param {Object} [config.budgetService] - CostBudgetService instance (optional)
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {Router} Express router
 *
 * @example
 * const router = createCostRouter({
 *   reportingService,
 *   budgetService,
 *   logger
 * });
 */
export default function createCostRouter(config) {
  const { reportingService, budgetService, logger = console } = config;

  if (!reportingService) {
    throw new Error('reportingService is required');
  }

  const router = Router();

  /**
   * GET /api/v1/cost/dashboard
   * Get cost dashboard summary for a period
   */
  router.get('/dashboard', async (req, res, next) => {
    try {
      const { household = 'default', period } = req.query;
      const { start, end } = parsePeriod(period);

      const dashboard = await reportingService.getDashboard(household, { start, end });
      res.json(dashboard);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cost/spend/category
   * Get spend breakdown by category
   */
  router.get('/spend/category', async (req, res, next) => {
    try {
      const { household = 'default', period, depth = '2' } = req.query;
      const { start, end } = parsePeriod(period);

      const breakdown = await reportingService.getSpendByCategory(
        household,
        { start, end },
        parseInt(depth, 10)
      );
      res.json(breakdown);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cost/spend/user
   * Get spend breakdown by user
   */
  router.get('/spend/user', async (req, res, next) => {
    try {
      const { household = 'default', period } = req.query;
      const { start, end } = parsePeriod(period);

      const breakdown = await reportingService.getSpendByUser(household, { start, end });
      res.json(breakdown);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cost/spend/resource
   * Get spend breakdown by resource
   */
  router.get('/spend/resource', async (req, res, next) => {
    try {
      const { household = 'default', period } = req.query;
      const { start, end } = parsePeriod(period);

      const breakdown = await reportingService.getSpendByResource(household, { start, end });
      res.json(breakdown);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cost/entries
   * Get paginated cost entries with optional filters
   */
  router.get('/entries', async (req, res, next) => {
    try {
      const {
        household = 'default',
        period,
        category,
        userId,
        page = '1',
        limit = '50'
      } = req.query;
      const { start, end } = parsePeriod(period);

      const filter = {
        householdId: household,
        start,
        end
      };
      if (category) {
        filter.category = category;
      }
      if (userId) {
        filter.userId = userId;
      }

      const result = await reportingService.getEntries(filter, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cost/budgets
   * Get all budget statuses for a household
   */
  router.get('/budgets', async (req, res, next) => {
    try {
      const { household = 'default' } = req.query;

      if (!budgetService) {
        return res.json({ budgets: [], message: 'Budget service not configured' });
      }

      const statuses = await budgetService.evaluateBudgets(household);
      res.json({ budgets: statuses });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Get the current month as YYYY-MM string
 *
 * @private
 * @returns {string} Current month in YYYY-MM format
 */
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Parse period string into start and end dates
 *
 * Supports formats:
 * - undefined/null: defaults to current month
 * - 'YYYY-MM': full month
 * - 'YYYY-MM-DD..YYYY-MM-DD': custom date range
 *
 * @private
 * @param {string} [period] - Period string
 * @returns {{ start: Date, end: Date }} Period boundaries
 */
function parsePeriod(period) {
  if (!period) {
    const [year, month] = getCurrentMonth().split('-');
    return {
      start: new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1),
      end: new Date(parseInt(year, 10), parseInt(month, 10), 0, 23, 59, 59, 999)
    };
  }

  if (period.includes('..')) {
    const [startStr, endStr] = period.split('..');
    return {
      start: new Date(startStr),
      end: new Date(endStr)
    };
  }

  // Assume YYYY-MM format
  const [year, month] = period.split('-');
  return {
    start: new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1),
    end: new Date(parseInt(year, 10), parseInt(month, 10), 0, 23, 59, 59, 999)
  };
}
