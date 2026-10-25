import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TeamSetup from "./TeamSetup.jsx";

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

it('preselects household members for casual individual setup', () => {
 render(<TeamSetup config={config} setupKind="individuals" selectAll onConfirm={() => {}} />);
 expect(screen.getByRole('button', {name:'Start with 2 players'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'A'}));
 expect(screen.getByRole('button',{name:'Start with 1 players'})).toBeEnabled();
});


it('offers anonymous teams without household roster and starts with focus on Start', () => {
 const onConfirm=vi.fn();
 render(<TeamSetup config={config} anonymousTeams={[{name:'Blue Team',color:'#3273dc'},{name:'Gold Team',color:'#e6b325'}]} onConfirm={onConfirm} />);
 expect(screen.queryAllByRole('button',{name:/Guest|\+ A|\+ B/})).toHaveLength(0);
 expect(screen.getByRole('button',{name:'Start with 2 teams'})).toHaveFocus();
 fireEvent.click(screen.getByRole('button',{name:'+ Team'}));
 fireEvent.click(screen.getByRole('button',{name:'Start with 3 teams'}));
 expect(onConfirm).toHaveBeenCalledWith([
  expect.objectContaining({name:'Blue Team',members:[],slot:'slot_1'}),
  expect.objectContaining({name:'Gold Team',members:[],slot:'slot_2'}),
  expect.objectContaining({name:'Team 3',members:[],slot:'slot_3'}),
 ]);
 fireEvent.click(screen.getAllByRole('button',{name:'Remove team'})[2]);
 expect(screen.queryByRole('button',{name:'Remove team'})).not.toBeInTheDocument();
});
