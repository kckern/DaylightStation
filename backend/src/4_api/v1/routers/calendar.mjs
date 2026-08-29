/**
 * Calendar API Router
 *
 * Endpoints:
 * - GET /api/calendar/events - Get upcoming calendar events
 * - GET /api/calendar/events/today - Get today's events
 * - GET /api/calendar/events/:date - Get events for specific date
 *
 * @module api/routers/calendar
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create calendar API router
 *
 * @param {Object} config
 * @param {Object} config.calendarReadContext - Calendar storage and household policy
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createCalendarRouter(config) {
  const { calendarReadContext } = config;
  const router = express.Router();

  // ===========================================================================
  // Events Endpoints
  // ===========================================================================

  /**
   * GET /api/calendar/events - Get upcoming calendar events
   * Query params:
   * - days: Number of days to look ahead (default 14)
   *
   * Returns array directly for legacy parity with /data/events
   */
  router.get('/events', asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days, 10) || 14;
    // Return array directly for legacy parity with /data/events
    res.json(calendarReadContext.upcoming(req.query.household || null, days));
  }));

  /**
   * GET /api/calendar/events/today - Get today's events
   */
  router.get('/events/today', asyncHandler(async (req, res) => {
    const result = calendarReadContext.today(req.query.household || null);

    res.json({
      status: 'success',
      date: result.date,
      count: result.events.length,
      events: result.events,
      _household: result.householdId
    });
  }));

  /**
   * GET /api/calendar/events/:date - Get events for specific date
   */
  router.get('/events/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    const result = calendarReadContext.onDate(req.query.household || null, date);
    if (result.kind === 'invalid_date') {
      return res.status(400).json({
        status: 'error',
        error: 'Invalid date format. Use YYYY-MM-DD.'
      });
    }

    res.json({
      status: 'success',
      date: date,
      count: result.events.length,
      events: result.events,
      _household: result.householdId
    });
  }));

  return router;
}

export default createCalendarRouter;
