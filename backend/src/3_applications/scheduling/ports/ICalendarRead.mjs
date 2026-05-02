/**
 * ICalendarRead
 *   getEvents({ rangeFrom: ISO, rangeTo: ISO, limit?: number, calendars?: string[] }):
 *     Promise<Array<{ id, title, startIso, endIso, calendar, location? }>>
 */
export function isCalendarRead(obj) {
  return !!obj && typeof obj.getEvents === 'function';
}

export function assertCalendarRead(obj) {
  if (!isCalendarRead(obj)) throw new Error('Object does not implement ICalendarRead');
}

export default { isCalendarRead, assertCalendarRead };
