import { ICalendarEventSource } from '#apps/calendar/ports/ICalendarEventSource.mjs';

/** Owns the current calendar key and its legacy read fallback. */
export class DataServiceCalendarEventSource extends ICalendarEventSource {
  constructor({ dataService }) {
    super();
    if (!dataService?.household?.read) throw new Error('DataServiceCalendarEventSource requires dataService');
    this.dataService = dataService;
  }

  readEvents(householdId) {
    const primary = this.dataService.household.read('calendar/calendar', householdId);
    return Array.isArray(primary)
      ? primary
      : (this.dataService.household.read('apps/calendar', householdId) || []);
  }
}
