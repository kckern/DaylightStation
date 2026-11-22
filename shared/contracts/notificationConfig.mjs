/** Whether a value is a valid 24-hour HH:MM time accepted by notification settings. */
export function is24HourClockTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}
