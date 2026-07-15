import { describe, it, expect } from 'vitest';
import { teamSetupReducer, initTeamSetup } from './teamSetupReducer.js';

const PRESET = {
  id: 'kids_vs_parents',
  name: 'Kids vs Parents',
  teams: [
    { name: 'Kids', color: '#e6b325', members: [{ id: 'felix', name: 'Felix', avatar: null }] },
    { name: 'Parents', color: '#3273dc', members: [{ id: 'kckern', name: 'KC', avatar: null }] },
  ],
};

describe('teamSetupReducer', () => {
  it('init with no presets yields two empty default teams with slots', () => {
    const s = initTeamSetup({ team_presets: [] });
    expect(s.teams).toHaveLength(2);
    expect(s.teams[0]).toMatchObject({ id: 'team_1', slot: 'slot_1' });
    expect(s.teams[1]).toMatchObject({ id: 'team_2', slot: 'slot_2' });
  });

  it('init with presets loads the first preset', () => {
    const s = initTeamSetup({ team_presets: [PRESET] });
    expect(s.presetId).toBe('kids_vs_parents');
    expect(s.teams[0].name).toBe('Kids');
    expect(s.teams[0].members[0].id).toBe('felix');
  });

  it('LOAD_PRESET replaces teams; ADD/REMOVE/RENAME work and re-slot', () => {
    let s = initTeamSetup({ team_presets: [] });
    s = teamSetupReducer(s, { type: 'LOAD_PRESET', preset: PRESET });
    expect(s.teams).toHaveLength(2);
    s = teamSetupReducer(s, { type: 'ADD_TEAM' });
    expect(s.teams).toHaveLength(3);
    expect(s.teams[2].slot).toBe('slot_3');
    s = teamSetupReducer(s, { type: 'REMOVE_TEAM', teamId: s.teams[0].id });
    expect(s.teams).toHaveLength(2);
    expect(s.teams.map((t) => t.slot)).toEqual(['slot_1', 'slot_2']); // re-slotted
    s = teamSetupReducer(s, { type: 'RENAME_TEAM', teamId: s.teams[0].id, name: 'Champs' });
    expect(s.teams[0].name).toBe('Champs');
  });

  it('ASSIGN_MEMBER moves a member between teams (no duplicates)', () => {
    let s = initTeamSetup({ team_presets: [PRESET] });
    const felix = { id: 'felix', name: 'Felix', avatar: null };
    s = teamSetupReducer(s, { type: 'ASSIGN_MEMBER', teamId: 'team_2', member: felix });
    expect(s.teams[0].members.find((m) => m.id === 'felix')).toBeUndefined();
    expect(s.teams[1].members.some((m) => m.id === 'felix')).toBe(true);
    s = teamSetupReducer(s, { type: 'REMOVE_MEMBER', teamId: 'team_2', memberId: 'felix' });
    expect(s.teams[1].members.some((m) => m.id === 'felix')).toBe(false);
  });

  it('ADD_GUEST adds profile-less members with unique ids', () => {
    let s = initTeamSetup({ team_presets: [] });
    s = teamSetupReducer(s, { type: 'ADD_GUEST', teamId: 'team_1' });
    s = teamSetupReducer(s, { type: 'ADD_GUEST', teamId: 'team_2' });
    expect(s.teams[0].members[0]).toEqual({ id: 'guest_1', name: 'Guest 1', avatar: null });
    expect(s.teams[1].members[0]).toEqual({ id: 'guest_2', name: 'Guest 2', avatar: null });
  });
});
