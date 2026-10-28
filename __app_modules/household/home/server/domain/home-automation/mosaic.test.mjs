import { describe, it, expect } from 'vitest';
import { MosaicPolicy, arrangeMosaic } from './MosaicPolicy.mjs';

const room = (id, name) => ({ id, name });
const e = (id, type, r = null, name = id) => ({ id, name, type, room: r });
const porch = room('front_porch', 'Front Porch'); const yard = room('yard', 'Yard'); const den = room('den', 'Den');
const entities = [
  e('light.porch', 'light', porch), e('binary_sensor.yard_motion', 'presence', yard), e('light.den', 'light', den),
  e('sensor.den_remote_battery', 'battery', den), e('sensor.kitchen_meter_energy_this_month', 'power', null), e('switch.flag', 'switch', null),
];
const types = [{ id: 'light', label: 'Lights' }, { id: 'presence', label: 'Motion & presence' }, { id: 'battery', label: 'Batteries' }, { id: 'power', label: 'Power' }, { id: 'switch', label: 'Switches' }];

describe('arrangeMosaic', () => {
  const policy = MosaicPolicy.fromConfig({
    hide: ['*_energy_this_month'], room_order: ['den'], type_groups: ['battery'],
    merge_rooms: [{ id: 'outside', label: 'Front porch & yard', rooms: ['front_porch', 'yard'] }],
  });
  it('groups by room with merges, own-type groups after rooms, Elsewhere last, hidden dropped', () => {
    const { byRoom } = arrangeMosaic(entities, policy, { types });
    expect(byRoom.map((g) => [g.id, g.label, g.entityIds])).toEqual([
      ['den', 'Den', ['light.den']],
      ['outside', 'Front porch & yard', ['light.porch', 'binary_sensor.yard_motion']],
      ['type:battery', 'Batteries', ['sensor.den_remote_battery']],
      ['_elsewhere', 'Elsewhere', ['switch.flag']],
    ]);
  });
  it('groups by type in type order', () => {
    const { byType } = arrangeMosaic(entities, policy, { types });
    expect(byType.map((g) => g.id)).toEqual(['light', 'presence', 'battery', 'switch']);
    expect(byType[0].entityIds).toEqual(['light.den', 'light.porch']);
  });
  it('defaults: HA rooms alphabetical, nothing hidden', () => {
    const { byRoom } = arrangeMosaic(entities, MosaicPolicy.fromConfig(), { types });
    expect(byRoom.map((g) => g.label)).toEqual(['Den', 'Front Porch', 'Yard', 'Elsewhere']);
  });
  it('rejects a merge without rooms', () => {
    expect(() => MosaicPolicy.fromConfig({ merge_rooms: [{ id: 'x', label: 'X' }] }))
      .toThrow(expect.objectContaining({ field: 'mosaic.merge_rooms[0].rooms' }));
  });
});
