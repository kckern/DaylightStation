import { describe, it, expect } from 'vitest';
import { HouseSummaryPolicy, summarizeHouse } from './HouseSummary.mjs';

const NOW = Date.parse('2026-10-27T23:00:00Z');
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

const e = (id, over = {}) => ({
  id, domain: id.split('.')[0], name: id, state: 'off', stateClass: 'off', type: 'switch',
  unit: null, deviceClass: null, lastChanged: null, room: null, ...over,
});
const meter = (id, watts, over = {}) => e(id, { type: 'power', stateClass: 'reading', deviceClass: 'power', unit: 'W', state: String(watts), ...over });
const energy = (id, kwh) => e(id, { type: 'power', stateClass: 'reading', deviceClass: 'energy', unit: 'kWh', state: String(kwh) });

const house = [
  meter('sensor.panel_total_power', 505.4),
  meter('sensor.office_power', 302),
  meter('sensor.ups_real_power', 174),
  meter('sensor.furnace_power', 57),
  meter('sensor.dryer_power', 0),
  meter('sensor.heater_power', 0.3, { unit: 'kW' }),
  energy('sensor.panel_total_energy_today', 40.03),
  energy('sensor.panel_total_energy_this_month', 849.98),
  energy('sensor.office_energy_today', 8.7),
  e('light.nightlight', { type: 'light', state: 'on', stateClass: 'on' }),
  e('light.hall', { type: 'light' }),
  e('switch.tv_plug', { type: 'power', state: 'on', stateClass: 'on' }),
  e('switch.shield_plug', { type: 'power', state: 'on', stateClass: 'on' }),
  e('input_boolean.security_auto', { type: 'switch', state: 'on', stateClass: 'on' }),
  e('media_player.tv', { type: 'media', state: 'playing', stateClass: 'on' }),
  e('binary_sensor.garage_door', { type: 'openings', deviceClass: 'door', state: 'on', stateClass: 'on' }),
  e('cover.blinds', { type: 'openings', state: 'closed', stateClass: 'off' }),
  e('binary_sensor.office_presence', { type: 'presence', state: 'on', stateClass: 'on', lastChanged: ago(40) }),
  e('binary_sensor.bedroom_occupancy', { type: 'presence', state: 'on', stateClass: 'on', lastChanged: ago(49 * 60) }),
  e('binary_sensor.hall_presence', { type: 'presence', state: 'on', stateClass: 'on', lastChanged: null }),
  e('binary_sensor.kitchen_motion', { type: 'presence', lastChanged: ago(5) }),
  e('binary_sensor.garage_motion', { type: 'presence', lastChanged: ago(50) }),
  e('binary_sensor.driveway_motion', { type: 'presence', state: 'unavailable', stateClass: 'unavailable' }),
  e('sensor.remote_battery', { type: 'battery', stateClass: 'reading', unit: '%', state: '9' }),
  e('sensor.puck_battery', { type: 'battery', stateClass: 'reading', unit: '%', state: '20' }),
  e('sensor.dial_battery', { type: 'battery', stateClass: 'reading', unit: '%', state: '60' }),
  e('sensor.siren_battery', { type: 'battery', stateClass: 'unavailable', state: 'unavailable' }),
  e('sensor.office_temperature', { type: 'climate', stateClass: 'reading', unit: '°F', state: '79.3' }),
];

describe('HouseSummaryPolicy', () => {
  it('has sensible defaults', () => {
    const p = HouseSummaryPolicy.fromConfig();
    expect(p.lowBatteryPct).toBe(20);
    expect(p.motionWindowMinutes).toBe(15);
    expect(p.motionStaleHours).toBe(24);
    expect(p.onTypes).toEqual(['light', 'power', 'media']);
    expect(p.wholeHouse).toBeNull();
    expect(p.top).toBe(5);
    expect(p.isIgnored('switch.anything')).toBe(false);
    // A rated capacity is not a reading.
    expect(p.isExcludedFromPower('sensor.ups_nominal_real_power')).toBe(true);
    expect(p.isExcludedFromPower('sensor.ups_real_power')).toBe(false);
  });

  it('reads the now and power sections', () => {
    const p = HouseSummaryPolicy.fromConfig({
      now: { low_battery_pct: 30, motion_window_minutes: 5, on_types: ['light'], ignore: ['switch.*_plug'] },
      power: { whole_house: 'sensor.balance_power', energy_today: 'sensor.balance_energy_today', exclude: ['sensor.ups_*'], top: 3 },
    });
    expect(p.lowBatteryPct).toBe(30);
    expect(p.motionWindowMinutes).toBe(5);
    expect(p.onTypes).toEqual(['light']);
    expect(p.isIgnored('switch.tv_plug')).toBe(true);
    expect(p.isIgnored('light.tv_plug_lamp')).toBe(false);
    expect(p.wholeHouse).toBe('sensor.balance_power');
    expect(p.energyToday).toBe('sensor.balance_energy_today');
    expect(p.isExcludedFromPower('sensor.ups_real_power')).toBe(true);
    expect(p.top).toBe(3);
  });

  it.each([
    [{ now: { low_battery_pct: 120 } }, /low_battery_pct/],
    [{ now: { motion_window_minutes: 'soon' } }, /motion_window_minutes/],
    [{ now: { motion_stale_hours: 0 } }, /motion_stale_hours/],
    [{ now: { on_types: 'light' } }, /on_types/],
    [{ now: { ignore: [1] } }, /ignore/],
    [{ power: { whole_house: 'not-an-id' } }, /whole_house/],
    [{ power: { top: 0 } }, /top/],
  ])('rejects %j', (sections, message) => {
    expect(() => HouseSummaryPolicy.fromConfig(sections)).toThrow(message);
  });
});

describe('summarizeHouse', () => {
  const summary = summarizeHouse(house, HouseSummaryPolicy.fromConfig(), { now: NOW });

  it('takes the largest power reading as the whole house and finds its energy siblings', () => {
    expect(summary.power.wholeHouse).toEqual({ entityId: 'sensor.panel_total_power', watts: 505.4 });
    expect(summary.power.energyToday).toEqual({ entityId: 'sensor.panel_total_energy_today', kwh: 40.03 });
    expect(summary.power.energyThisMonth).toEqual({ entityId: 'sensor.panel_total_energy_this_month', kwh: 849.98 });
  });

  it('ranks the other live meters by watts, in watts, and drops the idle ones', () => {
    expect(summary.power.topConsumers).toEqual([
      { entityId: 'sensor.office_power', watts: 302 },
      { entityId: 'sensor.heater_power', watts: 300 },
      { entityId: 'sensor.ups_real_power', watts: 174 },
      { entityId: 'sensor.furnace_power', watts: 57 },
    ]);
  });

  it('reports lights, plugs and media that are on, but not automation flags', () => {
    expect(summary.on).toEqual(['light.nightlight', 'switch.tv_plug', 'switch.shield_plug', 'media_player.tv']);
  });

  it('reports open openings, presence that is on or cleared within the window, low batteries and silence', () => {
    expect(summary.open).toEqual(['binary_sensor.garage_door']);
    expect(summary.motion).toEqual(['binary_sensor.office_presence', 'binary_sensor.hall_presence', 'binary_sensor.kitchen_motion']);
    expect(summary.lowBattery).toEqual([{ entityId: 'sensor.remote_battery', pct: 9 }, { entityId: 'sensor.puck_battery', pct: 20 }]);
    expect(summary.unavailable).toEqual(['binary_sensor.driveway_motion', 'sensor.siren_battery']);
    expect(summary.thresholds).toEqual({ lowBatteryPct: 20, motionWindowMinutes: 15, motionStaleHours: 24 });
  });

  it('a presence sensor "on" for longer than the stale limit is stuck, not motion', () => {
    const summary = summarizeHouse(house, HouseSummaryPolicy.fromConfig(), { now: NOW });
    expect(summary.stuck).toEqual(['binary_sensor.bedroom_occupancy']);
    expect(summary.motion).not.toContain('binary_sensor.bedroom_occupancy');
    // A longer limit from the household makes it motion again.
    const lenient = summarizeHouse(house, HouseSummaryPolicy.fromConfig({ now: { motion_stale_hours: 72 } }), { now: NOW });
    expect(lenient.stuck).toEqual([]);
    expect(lenient.motion).toContain('binary_sensor.bedroom_occupancy');
  });

  it('applies the household policy: named meter, ignored entities, excluded meters, top N', () => {
    const policy = HouseSummaryPolicy.fromConfig({
      now: { ignore: ['switch.*_plug', 'sensor.siren_battery'], low_battery_pct: 10, motion_window_minutes: 60 },
      power: { whole_house: 'sensor.office_power', exclude: ['sensor.ups_*'], top: 2 },
    });
    const s = summarizeHouse(house, policy, { now: NOW });
    expect(s.power.wholeHouse).toEqual({ entityId: 'sensor.office_power', watts: 302 });
    expect(s.power.energyToday).toEqual({ entityId: 'sensor.office_energy_today', kwh: 8.7 });
    expect(s.power.energyThisMonth).toBeNull();
    expect(s.power.topConsumers.map((c) => c.entityId)).toEqual(['sensor.panel_total_power', 'sensor.heater_power']);
    expect(s.on).toEqual(['light.nightlight', 'media_player.tv']);
    expect(s.lowBattery).toEqual([{ entityId: 'sensor.remote_battery', pct: 9 }]);
    expect(s.motion).toEqual(['binary_sensor.office_presence', 'binary_sensor.hall_presence', 'binary_sensor.kitchen_motion', 'binary_sensor.garage_motion']);
    expect(s.unavailable).toEqual(['binary_sensor.driveway_motion']);
  });

  it('refuses to guess the time', () => {
    expect(() => summarizeHouse(house, HouseSummaryPolicy.fromConfig())).toThrow(/current time/);
  });

  it('is honest about a house with no meters', () => {
    const s = summarizeHouse([e('light.hall', { type: 'light' })], HouseSummaryPolicy.fromConfig(), { now: NOW });
    expect(s.power).toEqual({ wholeHouse: null, energyToday: null, energyThisMonth: null, topConsumers: [] });
    expect(s.on).toEqual([]);
  });

  it('ignores a configured whole-house meter that is not in the readings rather than guessing', () => {
    const s = summarizeHouse(house, HouseSummaryPolicy.fromConfig({ power: { whole_house: 'sensor.gone' } }), { now: NOW });
    expect(s.power.wholeHouse).toBeNull();
    expect(s.power.topConsumers[0].entityId).toBe('sensor.panel_total_power');
  });
});
