/**
 * Home Dashboard Router (v1)
 * @module api/v1/routers/home-dashboard
 *
 * Thin Express router for the unified home-dashboard endpoints.
 * Delegates all behaviour to HomeAutomationContainer use cases.
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
 * @param {Object} deps.container - HomeAutomationContainer instance
 * @param {Object} [deps.logger] - Logger
 * @returns {import('express').Router}
 */
export function createHomeDashboardRouter({ container, logger = console } = {}) {
  if (!container) {
    throw new Error('createHomeDashboardRouter: container required');
  }

  const router = Router();

  router.get('/config', asyncHandler(homeDashboardConfigHandler({ container, logger })));
  router.get('/state', asyncHandler(homeDashboardStateHandler({ container, logger })));
  router.get('/history', asyncHandler(homeDashboardHistoryHandler({ container, logger })));
  router.post('/toggle', asyncHandler(homeDashboardToggleHandler({ container, logger })));
  router.post('/scene/:sceneId', asyncHandler(homeDashboardSceneHandler({ container, logger })));

  return router;
}

export default createHomeDashboardRouter;
