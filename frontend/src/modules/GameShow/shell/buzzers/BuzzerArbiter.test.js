import { describe, it, expect } from 'vitest';
import { BuzzerArbiter } from './BuzzerArbiter.js';

const TEAMS = [
  { id: 'team_1', name: 'Kids', slot: 'slot_1', members: [] },
  { id: 'team_2', name: 'Parents', slot: 'slot_2', members: [] },
];

describe('BuzzerArbiter', () => {
  it('first armed buzz locks its team; later buzzes are ignored', () => {
    const a = new BuzzerArbiter(TEAMS);
    a.arm(['team_1', 'team_2']);
    expect(a.handleBuzz('slot_2')).toBe('team_2');
    expect(a.lockedTeamId).toBe('team_2');
    expect(a.handleBuzz('slot_1')).toBe(null); // already locked
  });

  it('buzzes are ignored when not armed, from unbound slots, and from un-armed teams', () => {
    const a = new BuzzerArbiter(TEAMS);
    expect(a.handleBuzz('slot_1')).toBe(null);       // not armed
    a.arm(['team_2']);
    expect(a.handleBuzz('slot_1')).toBe(null);       // team_1 not in armed set
    expect(a.handleBuzz('slot_9')).toBe(null);       // unbound slot
    expect(a.handleBuzz('slot_2')).toBe('team_2');
  });

  it('disarm clears lock; re-arm excludes a team (wrong-answer lockout)', () => {
    const a = new BuzzerArbiter(TEAMS);
    a.arm(['team_1', 'team_2']);
    a.handleBuzz('slot_1');
    a.disarm();
    expect(a.lockedTeamId).toBe(null);
    a.arm(['team_2']); // team_1 answered wrong — re-arm the rest
    expect(a.handleBuzz('slot_1')).toBe(null);
    expect(a.handleBuzz('slot_2')).toBe('team_2');
  });

  it('bind mode: next press binds the slot to the team and ends bind mode', () => {
    const a = new BuzzerArbiter([{ id: 'team_1', name: 'Kids', slot: null, members: [] }]);
    a.startBind('team_1');
    expect(a.handleBindPress('slot_3')).toBe(true);
    expect(a.bindings()).toEqual({ slot_3: 'team_1' });
    expect(a.handleBindPress('slot_4')).toBe(false); // bind mode over
    a.arm(['team_1']);
    expect(a.handleBuzz('slot_3')).toBe('team_1');
  });

  it('re-binding a team removes its old slot; snapshot/restore round-trips', () => {
    const a = new BuzzerArbiter(TEAMS);
    a.startBind('team_1');
    a.handleBindPress('slot_5');
    expect(a.bindings()).toEqual({ slot_5: 'team_1', slot_2: 'team_2' });
    const b = new BuzzerArbiter(TEAMS);
    b.restore(a.snapshot());
    expect(b.bindings()).toEqual({ slot_5: 'team_1', slot_2: 'team_2' });
  });
});
