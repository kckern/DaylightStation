import { describe, it, expect } from 'vitest';
import { remoteUses } from './remoteUses.js';

// Made-up fixtures: a handlebar remote mounted so its ring faces the rider.
const REMOTE = {
  id: 'handlebar', kind: 'remote', address: 'AA:BB:CC:00:00:01',
  buttons: { a: 'Key1', b: 'Key2', c: 'Key3', d: 'Key4', e: 'Key5' },
  positions: { up: 'a', down: 'b', left: 'c', right: 'd', center: 'e' },
  toward: { front: 'left', rear: 'right' },
  some_game: { a: 'b' },
};
const NAMES = { flyer: 'Flyer Game', some_game: 'Arcade Box' };
const nameOf = (id) => NAMES[id] || null;

describe('remoteUses', () => {
  it('a module block on the inventory entry, and an equipment direction map, by display name', () => {
    const equipment = [{ id: 'bike', name: 'Bike', flyer: { remote: { up: 'missile', front: 'boost', center: 'laser', rear: 'pause', sideways: 'x' } } }];
    expect(remoteUses({ controller: REMOTE, equipment, nameOf })).toEqual([
      { id: 'inventory:some_game', label: 'Arcade Box:', text: 'plays with this remote.' },
      { id: 'equipment:bike:flyer', label: 'Flyer Game:', text: 'Up: missile, Centre: laser, Front: boost, Rear: pause.' },
    ]);
  });
  it('front/rear only where the remote says which way it faces; unregistered blocks and unplaced remotes say nothing', () => {
    const equipment = [{ id: 'bike', unknown_thing: { remote: { up: 'x' } }, flyer: { remote: { front: 'boost' } } }];
    const noToward = { ...REMOTE, toward: undefined, some_game: undefined };
    expect(remoteUses({ controller: noToward, equipment, nameOf })).toEqual([]);
    expect(remoteUses({ controller: { kind: 'remote', buttons: { a: 'Key1' } }, equipment, nameOf })).toEqual([]);
  });
});
