import { describe, it, expect } from 'vitest';
import { EntityCatalogPolicy } from './EntityCatalogPolicy.mjs';
import { HomeEntity, stateClassOf } from './HomeEntity.mjs';
import { buildRoomPrefixes, resolveRoom } from './resolveRoom.mjs';

const policy = EntityCatalogPolicy.fromConfig();

describe('EntityCatalogPolicy defaults', () => {
  it('types a switch named for a light as a light, and a plug as power', () => {
    expect(policy.typeOf('switch.study_main_lights')).toBe('light');
    expect(policy.typeOf('switch.master_bedroom_sconces')).toBe('light');
    expect(policy.typeOf('switch.office_tv_plug')).toBe('power');
    expect(policy.typeOf('switch.office_vent')).toBe('switch');
    expect(policy.typeOf('light.kitchen')).toBe('light');
  });

  it('matches light switches by whole word, and keeps camera IR / backlights out', () => {
    expect(policy.typeOf('switch.nightlight_plug')).toBe('power');
    expect(policy.typeOf('switch.living_room_lighting_scene')).toBe('switch');
    expect(policy.typeOf('switch.porch_light')).toBe('light');
    expect(policy.typeOf('switch.kitchen_table_light_switch')).toBe('light');
    expect(policy.typeOf('switch.kitchen_lights_kitchen_lights_switch')).toBe('light');
    for (const id of ['switch.doorbell_ir_lights', 'switch.office_monitor_backlight', 'switch.garage_infrared_lights',
      'light.driveway_camera_status_led', 'light.voice_0985dd_led_ring', 'light.living_room_siren_volume_dimmer']) {
      expect(policy.admits(id)).toBe(false);
      expect(policy.isControllable(id)).toBe(false);
    }
  });

  it('types sensors by device class', () => {
    expect(policy.typeOf('sensor.dryer_power', { deviceClass: 'power' })).toBe('power');
    expect(policy.typeOf('sensor.office_temperature', { deviceClass: 'temperature' })).toBe('climate');
    expect(policy.typeOf('sensor.remote_battery', { deviceClass: 'battery' })).toBe('battery');
    expect(policy.typeOf('binary_sensor.hall_motion', { deviceClass: 'motion' })).toBe('presence');
    expect(policy.typeOf('binary_sensor.front_door', { deviceClass: 'door' })).toBe('openings');
    expect(policy.typeOf('sensor.mystery')).toBe('sensor');
    expect(policy.typeOf('weather.home')).toBe('other');
  });

  it('admits readable sensors and drops diagnostics and unroomed unclassed ones', () => {
    expect(policy.admits('sensor.office_temperature', { deviceClass: 'temperature' })).toBe(true);
    expect(policy.admits('sensor.plug_voltage', { deviceClass: 'voltage' })).toBe(false);
    expect(policy.admits('sensor.mystery')).toBe(false);
    expect(policy.admits('sensor.mystery', { hasRoom: true })).toBe(true);
    expect(policy.admits('binary_sensor.hall_motion', { deviceClass: 'motion' })).toBe(true);
  });

  it('drops excluded noise and domains the dashboard does not show', () => {
    expect(policy.admits('switch.office_presence_sensor_led_state')).toBe(false);
    expect(policy.admits('switch.zigbee2mqtt_bridge_permit_join_2')).toBe(false);
    expect(policy.admits('automation.morning')).toBe(false);
    expect(policy.admits('update.core')).toBe(false);
  });

  it('lets only lights be switched by default — never plugs, sensors or locks', () => {
    expect(policy.isControllable('light.kitchen')).toBe(true);
    expect(policy.isControllable('switch.study_main_lights')).toBe(true);
    expect(policy.isControllable('switch.living_room_shield_plug')).toBe(false);
    expect(policy.isControllable('fan.master_bedroom_ceiling_fan')).toBe(false);
    expect(policy.isControllable('sensor.office_temperature')).toBe(false);
    expect(policy.isControllable('lock.front_door')).toBe(false);
  });
});

describe('EntityCatalogPolicy from household config', () => {
  const custom = EntityCatalogPolicy.fromConfig({
    ha_url: 'https://ha.example/',
    include: ['sensor.mystery'],
    exclude: ['switch.office_*'],
    types: [{ type: 'heaters', domains: ['switch'], match: ['*heater*'] }],
    names: { 'switch.office_tv_plug': 'Office TV' },
  });

  it('strips the trailing slash from the HA link base', () => {
    expect(custom.haUrl).toBe('https://ha.example');
    expect(policy.haUrl).toBeNull();
  });

  it('lets include beat the device-class filter and exclude add to the defaults', () => {
    expect(custom.admits('sensor.mystery')).toBe(true);
    expect(custom.admits('switch.office_tv_plug')).toBe(false);
    expect(custom.admits('switch.zigbee2mqtt_bridge_permit_join_2')).toBe(false);
  });

  it('tries household type rules first and lists their new types after the built-ins', () => {
    expect(custom.typeOf('switch.blanket_heater_plug')).toBe('heaters');
    expect(custom.types.at(-1)).toEqual({ id: 'heaters', label: 'Heaters' });
    expect(custom.types[0].id).toBe('light');
  });

  it('uses household names, and opts entities in to control by type or by id', () => {
    expect(custom.nameFor('switch.office_tv_plug')).toBe('Office TV');
    const opted = EntityCatalogPolicy.fromConfig({
      controllable_types: ['light', 'climate'], controllable: ['switch.office_fan_plug', 'lock.front_door'],
    });
    expect(opted.isControllable('fan.master_bedroom_ceiling_fan')).toBe(true);
    expect(opted.isControllable('switch.office_fan_plug')).toBe(true);
    expect(opted.isControllable('switch.living_room_shield_plug')).toBe(false);
    // A lock has no switch semantics, so naming it cannot make it switchable.
    expect(opted.isControllable('lock.front_door')).toBe(false);
  });

  it('rejects a malformed config instead of guessing', () => {
    expect(() => EntityCatalogPolicy.fromConfig({ exclude: 'switch.*' })).toThrow(/exclude must be a list/);
    expect(() => EntityCatalogPolicy.fromConfig({ types: [{ domains: ['switch'] }] })).toThrow(/needs a type/);
    expect(() => EntityCatalogPolicy.fromConfig({ infer_rooms: 'yes' })).toThrow(/true or false/);
    expect(() => EntityCatalogPolicy.fromConfig({ room_aliases: { bedroom1: 7 } })).toThrow(/map names to text/);
  });

  it('lets a named controllable entity through even when an exclude glob hits it', () => {
    const p = EntityCatalogPolicy.fromConfig({ exclude: ['switch.office_*'], controllable: ['switch.office_fan_plug'] });
    expect(p.isControllable('switch.office_fan_plug')).toBe(true);
    expect(p.isControllable('switch.office_tv_plug')).toBe(false);
  });
});

describe('stateClassOf', () => {
  it.each([
    ['light', 'on', 'on'], ['switch', 'off', 'off'], ['binary_sensor', 'on', 'on'],
    ['cover', 'open', 'on'], ['cover', 'closed', 'off'], ['lock', 'locked', 'off'],
    ['media_player', 'playing', 'on'], ['media_player', 'standby', 'off'],
    ['climate', 'heat', 'on'], ['climate', 'off', 'off'],
    ['sensor', '71.2', 'reading'], ['sensor', 'unavailable', 'unavailable'], ['light', 'unknown', 'unavailable'],
  ])('%s %s → %s', (domain, state, expected) => {
    expect(stateClassOf(domain, state)).toBe(expected);
  });
});

describe('resolveRoom', () => {
  const rooms = [
    { id: 'office', name: 'Office' },
    { id: 'bedroom', name: 'Master Bedroom' },
    { id: 'living_room', name: 'Living Room' },
    { id: 'play_room', name: 'Play Room' },
  ];
  const roomNames = new Map(rooms.map((r) => [r.id, r.name]));
  const prefixes = buildRoomPrefixes(rooms, { toy_room: 'play_room' });
  const ctx = { roomNames, assignments: { 'light.lamp': 'living_room' }, overrides: { 'switch.office_tv_plug': 'living_room' }, prefixes };

  it('prefers the household override, then the provider assignment', () => {
    expect(resolveRoom('switch.office_tv_plug', ctx)).toEqual({ id: 'living_room', name: 'Living Room', source: 'config' });
    expect(resolveRoom('light.lamp', ctx)).toEqual({ id: 'living_room', name: 'Living Room', source: 'provider' });
  });

  it('infers from the longest room prefix, by id, name or alias', () => {
    expect(resolveRoom('switch.office_vent_plug', ctx)).toEqual({ id: 'office', name: 'Office', source: 'inferred' });
    expect(resolveRoom('switch.master_bedroom_sconces', ctx)?.id).toBe('bedroom');
    expect(resolveRoom('switch.toy_room_switch_left', ctx)?.id).toBe('play_room');
  });

  it('matches whole words only and can be switched off', () => {
    expect(resolveRoom('switch.officer_badge', ctx)).toBeNull();
    expect(resolveRoom('switch.office_vent_plug', { ...ctx, prefixes: null })).toBeNull();
  });
});

describe('HomeEntity.fromReading', () => {
  it('classifies and names a normalized reading, keeping its detail', () => {
    const entity = HomeEntity.fromReading(
      { entityId: 'light.kitchen', state: 'on', name: 'Kitchen', deviceClass: null, unit: null, lastChanged: 't1', detail: { brightnessPct: 78 } },
      { policy, room: { id: 'kitchen', name: 'Kitchen', source: 'provider' } },
    );
    expect(entity).toMatchObject({
      id: 'light.kitchen', domain: 'light', name: 'Kitchen', state: 'on', stateClass: 'on', type: 'light',
      room: { id: 'kitchen', source: 'provider' }, controllable: true, detail: { brightnessPct: 78 }, lastChanged: 't1',
    });
    expect(Object.isFrozen(entity.detail)).toBe(true);
  });

  it('is not controllable while unavailable', () => {
    const entity = HomeEntity.fromReading({ entityId: 'switch.office_tv_plug', state: 'unavailable', name: null }, { policy, room: null });
    expect(entity.stateClass).toBe('unavailable');
    expect(entity.controllable).toBe(false);
  });

  it('rejects an id without a domain, a missing type, or a malformed room', () => {
    expect(() => new HomeEntity({ id: 'kitchen', state: 'on', type: 'light' })).toThrow(/domain.object_id/);
    expect(() => new HomeEntity({ id: 'light.kitchen', state: 'on' })).toThrow(/needs a type/);
    expect(() => new HomeEntity({ id: 'light.kitchen', state: 'on', type: 'light', room: { id: 'k' } })).toThrow(/room needs/);
  });
});
