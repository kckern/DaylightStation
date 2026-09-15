import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PartyGamesResults from './PartyGamesResults.jsx';

const seats = [{ id: 'a', name: 'Alpha', members: [] }, { id: 'b', name: 'Beta', members: [] }];

describe('PartyGamesResults', () => {
  it('announces ties instead of arbitrarily selecting the first seat', () => {
    render(<div className="party-games"><PartyGamesResults seats={seats} result={{ status: 'completed', outcome: { kind: 'completed' }, scores: [{ subject_id: 'a', value: 4 }, { subject_id: 'b', value: 4 }] }} /></div>);
    expect(screen.getByRole('heading', { name: 'It’s a tie' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('supports scoreless utility-game results', () => {
    render(<div className="party-games"><PartyGamesResults result={{ status: 'completed', outcome: { kind: 'completed' }, scores: [] }} /></div>);
    expect(screen.getByRole('heading', { name: 'Game complete' })).toBeInTheDocument();
    expect(screen.getByText('Thanks for playing.')).toBeInTheDocument();
  });
});

it('keeps casual participants unranked even when stale scores are present', () => {
 render(<PartyGamesResults competition={false} seats={[{id:'a',name:'Alice'}]} result={{outcome:{winner_ids:['a']},scores:[{subject_id:'a',value:4}]}} />);
 expect(screen.getByText('Game complete')).toBeInTheDocument(); expect(screen.queryByText(/wins/)).toBeNull(); expect(screen.queryByText('4')).toBeNull();
});
