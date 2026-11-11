import { describe, it, expect } from 'vitest';
import { LiveHouseholdCalendar, resolveLive } from './LiveHouseholdCalendar.mjs';
import { DEFAULT_DAY_OFF_POLICY } from '../domain/dayOffPolicy.mjs';

describe('LiveHouseholdCalendar', () => {
  it('serves the boot values, then whatever replace() installs', () => {
    const live = new LiveHouseholdCalendar({ schedule: null, policy: DEFAULT_DAY_OFF_POLICY });
    expect(live.schedule()).toBeNull();
    expect(live.policy()).toBe(DEFAULT_DAY_OFF_POLICY);
    const schedule = { except: [{ from: '2026-11-20', to: '2026-11-20', tier: 'away' }] };
    live.replace({ schedule, policy: { away: { keep: [] } } });
    expect(live.schedule()).toBe(schedule);
    expect(live.policy()).toEqual({ away: { keep: [] } });
  });
  it('defaults the policy when none is given', () => {
    expect(new LiveHouseholdCalendar().policy()).toBe(DEFAULT_DAY_OFF_POLICY);
  });
  it('resolveLive passes a function through and wraps a value', () => {
    const fn = () => 1;
    expect(resolveLive(fn)).toBe(fn);
    expect(resolveLive(2)()).toBe(2);
    expect(resolveLive(undefined)()).toBeUndefined();
  });
});
