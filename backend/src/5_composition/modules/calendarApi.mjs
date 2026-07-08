// backend/src/5_composition/modules/calendarApi.mjs
// Composition wiring for Calendar API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createCalendarRouter } from '#api/v1/routers/calendar.mjs';

/**
 * Create calendar API router
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for reading shared data
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createCalendarApiRouter(config) {
  return createCalendarRouter(config);
}
