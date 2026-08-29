// backend/src/5_composition/modules/calendarApi.mjs
// Composition wiring for Calendar API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createCalendarRouter } from '#api/v1/routers/calendar.mjs';
import { HouseholdContextService } from '#apps/common/context/HouseholdContextService.mjs';
import { CalendarReadContext } from '#apps/calendar/CalendarReadContext.mjs';
import { DataServiceCalendarEventSource } from '#adapters/calendar/DataServiceCalendarEventSource.mjs';

/**
 * Create calendar API router
 * @param {Object} config
 * @param {Object} config.dataService - Hierarchical persistence capability
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createCalendarApiRouter(config) {
  const { dataService, configService, logger = console } = config;
  const householdContext = new HouseholdContextService({
    defaultHouseholdId: () => configService.getDefaultHouseholdId?.(),
    getTimezone: (householdId) => configService.getHouseholdTimezone?.(householdId),
  });
  const calendarReadContext = new CalendarReadContext({
    householdContext,
    logger,
    eventSource: new DataServiceCalendarEventSource({ dataService }),
  });
  return createCalendarRouter({
    calendarReadContext,
  });
}
