import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Board from "./Board.jsx";

const round = { name: 'Round One', categories: [{ name: 'History', clues: [{ value: 100 }] }] };

describe('Jeopardy Board', () => {
  it('defaults a missing round multiplier to one and exposes semantic clue controls', () => {
    const onSelect = vi.fn();
    render(<div className="party-games"><Board round={round} used={{}} roundIndex={0} cursor={{ cat: 0, row: 0 }} onSelect={onSelect} /></div>);
    const clue = screen.getByRole('gridcell', { name: 'History for $100' });
    expect(clue).toHaveTextContent('$100');
    fireEvent.click(clue);
    expect(onSelect).toHaveBeenCalledWith(0, 0);
  });

  it('keeps used clues unavailable and clearly labeled', () => {
    render(<div className="party-games"><Board round={round} used={{ '0:0:0': true }} roundIndex={0} cursor={{ cat: 0, row: 0 }} /></div>);
    expect(screen.getByRole('gridcell', { name: 'History for $100, used' })).toBeDisabled();
  });
});

it('marks little-kid picture questions visibly and accessibly',()=>{
 render(<Board round={{...round,categories:[{name:'Pictures',clues:[{value:100,little_kids:true}]}]}} used={{}} roundIndex={0} cursor={{cat:0,row:0}}/>);
 expect(screen.getByRole('gridcell',{name:/Little kids/})).toHaveTextContent("Little kids");
});

it('keeps DOM focus on the same question that Enter will select',()=>{
 const round={name:'Round',categories:[{name:'A',clues:[{value:100}]},{name:'B',clues:[{value:100}]}]};
 const view=render(<Board round={round} used={{}} roundIndex={0} cursor={{cat:0,row:0}}/>);
 expect(screen.getByRole('gridcell',{name:'A for $100'})).toHaveFocus();
 view.rerender(<Board round={round} used={{}} roundIndex={0} cursor={{cat:1,row:0}}/>);
 expect(screen.getByRole('gridcell',{name:'B for $100'})).toHaveFocus();
 expect(document.activeElement).toHaveClass('is-cursor');
});
