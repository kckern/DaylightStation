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
import moment from 'moment-timezone';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create calendar API router
 *
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for reading shared data
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createCalendarRouter(config) {
  const { userDataService, configService, logger = console } = config;
  const router = express.Router();

  /**
   * Get household ID
   */
  const getHouseholdId = (req) =>
    req.query.household || configService.getDefaultHouseholdId?.() || 'default';

  /**
   * Get timezone for household
   */
  const getTimezone = (householdId) =>
    configService.getHouseholdTimezone?.(householdId) || 'UTC';

  /**
   * Load calendar events from common storage
   */
  const loadCalendarEvents = (householdId) => {
    try {
      // Try reading from common/calendar in household directory
      const events = userDataService.readHouseholdSharedData?.(householdId, 'calendar');
      if (events && Array.isArray(events)) {
        return events;
      }

      // Fallback: try reading from common/calendar.yml
      const fallback = userDataService.readHouseholdAppData?.(householdId, 'common', 'calendar');
      if (fallback && Array.isArray(fallback)) {
        return fallback;
      }

      return [];
    } catch (error) {
      logger.warn?.('calendar.load.error', { householdId, error: error.message });
      return [];
    }
  };

  /**
   * Format raw event for API response
   */
  const formatEvent = (event, timezone) => {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    const isAllDay = !!(event.start?.date && !event.start?.dateTime);

    return {
      id: event.id,
      summary: event.summary || 'Untitled Event',
      description: event.description || null,
      location: event.location || null,
      start: start,
      end: end,
      allDay: isAllDay,
      date: moment(start).tz(timezone).format('YYYY-MM-DD'),
      time: isAllDay ? null : moment(start).tz(timezone).format('h:mm A'),
      endTime: isAllDay ? null : moment(end).tz(timezone).format('h:mm A'),
      calendar: event.organizer?.displayName || event.creator?.displayName || null
    };
  };

  /**
   * Filter events by date range
   */
  const filterEventsByDateRange = (events, startDate, endDate, timezone) => {
    return events.filter(event => {
      const eventDate = moment(event.start?.dateTime || event.start?.date).tz(timezone);
      return eventDate.isSameOrAfter(startDate, 'day') && eventDate.isSameOrBefore(endDate, 'day');
    });
  };

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
    const householdId = getHouseholdId(req);
    const timezone = getTimezone(householdId);
    const days = parseInt(req.query.days, 10) || 14;

    const events = loadCalendarEvents(householdId);
    const now = moment().tz(timezone);
    const endDate = moment().tz(timezone).add(days, 'days');

    const upcomingEvents = filterEventsByDateRange(events, now, endDate, timezone)
      .map(e => formatEvent(e, timezone))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    // Return array directly for legacy parity with /data/events
    res.json(upcomingEvents);
  }));

  /**
   * GET /api/calendar/events/today - Get today's events
   */
  router.get('/events/today', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const timezone = getTimezone(householdId);

    const events = loadCalendarEvents(householdId);
    const today = moment().tz(timezone).startOf('day');

    const todayEvents = filterEventsByDateRange(events, today, today, timezone)
      .map(e => formatEvent(e, timezone))
      .sort((a, b) => {
        // All-day events first, then by time
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return new Date(a.start) - new Date(b.start);
      });

    res.json({
      status: 'success',
      date: today.format('YYYY-MM-DD'),
      count: todayEvents.length,
      events: todayEvents,
      _household: householdId
    });
  }));

  /**
   * GET /api/calendar/events/:date - Get events for specific date
   */
  router.get('/events/:date', asyncHandler(async (req, res) => {
    const householdId = getHouseholdId(req);
    const timezone = getTimezone(householdId);
    const { date } = req.params;

    // Validate date format
    const targetDate = moment(date, 'YYYY-MM-DD', true);
    if (!targetDate.isValid()) {
      return res.status(400).json({
        status: 'error',
        error: 'Invalid date format. Use YYYY-MM-DD.'
      });
    }

    const events = loadCalendarEvents(householdId);
    const dateEvents = filterEventsByDateRange(events, targetDate, targetDate, timezone)
      .map(e => formatEvent(e, timezone))
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return new Date(a.start) - new Date(b.start);
      });

    res.json({
      status: 'success',
      date: date,
      count: dateEvents.length,
      events: dateEvents,
      _household: householdId
    });
  }));

  return router;
}

export default createCalendarRouter;
