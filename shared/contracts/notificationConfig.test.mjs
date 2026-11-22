import { describe, expect, it } from 'vitest';
import { is24HourClockTime } from './notificationConfig.mjs';

describe('is24HourClockTime', () => {
  it.each(['00:00', '09:05', '20:00', '23:59'])('accepts %s', value => {
    expect(is24HourClockTime(value)).toBe(true);
  });

  it.each(['', '9:05', '24:00', '25:00', '12:60', '12:00 AM', null])('rejects %s', value => {
    expect(is24HourClockTime(value)).toBe(false);
  });
});
