import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TeamSetup from './TeamSetup.jsx';

const config = {
  household_members: [{ id: 'a', name: 'A', avatar: null }, { id: 'b', name: 'B', avatar: null }],
  team_presets: [],
};

describe('TeamSetup mounted setup modes', () => {
  it('creates one seat per selected individual', () => {
    const onConfirm = vi.fn();
    render(<TeamSetup config={config} setupKind="individuals-or-teams" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Individuals' }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start with 2 players' }));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', members: [config.household_members[0]], slot: 'slot_1' }),
      expect.objectContaining({ id: 'b', members: [config.household_members[1]], slot: 'slot_2' }),
    ]);
  });

  it('includes the environment roster in team assignment even without presets', () => {
    render(<TeamSetup config={config} setupKind="teams" onConfirm={() => {}} />);
    expect(screen.getAllByRole('button', { name: /\+ A|\+ B/ })).toHaveLength(4);
  });
});
