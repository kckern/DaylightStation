/**
 * Home Dashboard Router (v1)
 * @module api/v1/routers/home-dashboard
 *
 * Thin Express router for the unified home-dashboard endpoints.
 * Delegates all behaviour to explicitly injected application use cases.
 */

import { Router } from 'express';

import { asyncHandler } from '#system/http/middleware/index.mjs';
import {
  homeDashboardConfigHandler,
  homeDashboardStateHandler,
  homeDashboardHistoryHandler,
  homeDashboardToggleHandler,
  homeDashboardSceneHandler,
} from '#api/v1/handlers/home-dashboard/index.mjs';

/**
 * Create the home-dashboard Express router.
 *
 * @param {Object} deps
 * @param {Object} deps.operations - Dashboard application use cases
 * @param {Object} [deps.logger] - Logger
 * @returns {import('express').Router}
 */
export function createHomeDashboardRouter({ operations } = {}) {
  if (!operations) {
    throw new Error('createHomeDashboardRouter: operations required');
  }

  const router = Router();

  router.get('/config', asyncHandler(homeDashboardConfigHandler({ operation: operations.getConfig })));
  router.get('/state', asyncHandler(homeDashboardStateHandler({ operation: operations.getState })));
  router.get('/history', asyncHandler(homeDashboardHistoryHandler({ operation: operations.getHistory })));
  router.post('/toggle', asyncHandler(homeDashboardToggleHandler({ operation: operations.toggleEntity })));
  router.post('/scene/:sceneId', asyncHandler(homeDashboardSceneHandler({ operation: operations.activateScene })));

  return router;
}

export default createHomeDashboardRouter;
