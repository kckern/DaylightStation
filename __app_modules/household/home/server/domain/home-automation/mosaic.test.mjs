import { describe, it, expect } from 'vitest';
import { MosaicPolicy, arrangeMosaic, mergeShadows } from './MosaicPolicy.mjs';

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
  it('rejects a room listed in two merges, at the second listing', () => {
    expect(() => MosaicPolicy.fromConfig({ merge_rooms: [{ id: 'a', rooms: ['den', 'yard'] }, { id: 'b', rooms: ['porch', 'yard'] }] }))
      .toThrow(expect.objectContaining({ name: 'ValidationError', field: 'mosaic.merge_rooms[1].rooms', value: 'yard' }));
  });
  it('rejects a merge id that is also a room some merge lists', () => {
    expect(() => MosaicPolicy.fromConfig({ merge_rooms: [{ id: 'den', rooms: ['den', 'office'] }] }))
      .toThrow(expect.objectContaining({ name: 'ValidationError', field: 'mosaic.merge_rooms[0].id', value: 'den' }));
    expect(() => MosaicPolicy.fromConfig({ merge_rooms: [{ id: 'up', rooms: ['a'] }, { id: 'down', rooms: ['up'] }] }))
      .toThrow(expect.objectContaining({ field: 'mosaic.merge_rooms[0].id', value: 'up' }));
  });
  it('a merge named like a real room never takes that room\'s squares: both groups draw, apart', () => {
    const policy = MosaicPolicy.fromConfig({ merge_rooms: [{ id: 'outside', label: 'Porch & yard', rooms: ['front_porch', 'yard'] }] });
    const shed = room('outside', 'Outside');
    const { byRoom } = arrangeMosaic([...entities, e('light.shed', 'light', shed)], policy, { types });
    const outside = byRoom.filter((g) => g.label === 'Outside' || g.label === 'Porch & yard');
    expect(outside.map((g) => [g.label, g.entityIds])).toEqual([
      ['Outside', ['light.shed']],
      ['Porch & yard', ['light.porch', 'binary_sensor.yard_motion']],
    ]);
    expect(new Set(byRoom.map((g) => g.id)).size).toBe(byRoom.length);
    // No collision: a merge keeps its own id.
    expect(arrangeMosaic(entities, policy, { types }).byRoom.some((g) => g.id === 'outside')).toBe(true);
  });
  it('mergeShadows names each merge whose id is a real room', () => {
    const policy = MosaicPolicy.fromConfig({ merge_rooms: [{ id: 'outside', rooms: ['yard'] }, { id: 'up', rooms: ['attic'] }] });
    expect(mergeShadows(policy, ['den', 'outside'])).toEqual([{ mergeId: 'outside', roomId: 'outside' }]);
    expect(mergeShadows(policy, ['den'])).toEqual([]);
  });
  it('rejects a duplicate merge id', () => {
    expect(() => MosaicPolicy.fromConfig({ merge_rooms: [{ id: 'a', rooms: ['x'] }, { id: 'a', rooms: ['y'] }] }))
      .toThrow(expect.objectContaining({ field: 'mosaic.merge_rooms[1].id' }));
  });
  it('rejects an unknown type in type_groups or type_order', () => {
    expect(() => MosaicPolicy.fromConfig({ type_groups: ['robots'] })).toThrow(expect.objectContaining({ field: 'mosaic.type_groups', value: 'robots' }));
    expect(() => MosaicPolicy.fromConfig({ type_order: 'light' })).toThrow(expect.objectContaining({ field: 'mosaic.type_order' }));
  });
  it('type_order puts listed types first, the rest after in default order', () => {
    const { byType } = arrangeMosaic(entities, MosaicPolicy.fromConfig({ type_order: ['switch', 'battery'] }), { types });
    expect(byType.map((g) => g.id)).toEqual(['switch', 'battery', 'light', 'power', 'presence']);
  });
  it('hides by full entity id as well as by object id glob', () => {
    const { byType } = arrangeMosaic(entities, MosaicPolicy.fromConfig({ hide: ['light.den', 'yard_*'] }), { types });
    const ids = byType.flatMap((g) => g.entityIds);
    expect(ids).not.toContain('light.den');
    expect(ids).not.toContain('binary_sensor.yard_motion');
    expect(ids).toContain('light.porch');
  });
  it('an own-type group with no entities draws no group', () => {
    const { byRoom } = arrangeMosaic(entities, MosaicPolicy.fromConfig({ type_groups: ['climate'] }), { types });
    expect(byRoom.some((g) => g.id === 'type:climate')).toBe(false);
  });
});
