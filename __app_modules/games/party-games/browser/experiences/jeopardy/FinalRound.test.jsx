import React from 'react';
import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import FinalRound from './FinalRound.jsx';
it.each(['final-category','final-wager','final-clue','final-judging'])('presents %s without gameplay controls',phase=>{render(<FinalRound state={{phase,set:{final:{category:'Final category',clue:'Question',answer:'Answer'},rounds:[{categories:[{clues:[{value:100}]}]}]},finalWagers:{},finalJudged:{}}} teams={[{id:'a',name:'Blue'}]} scores={{a:0}}/>);expect(screen.queryAllByRole('button')).toHaveLength(0);expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);expect(document.querySelector('.jp-final')).toHaveTextContent(/Final|Question|Blue/);});

it.each([false, true])('reference_visible_before_and_after_reveal: %s', revealed => {
  const clue = { value: 100, clue: 'Read this question', answer: 'The answer', scripture_reference: 'Jeremiah 1:5–10' };
  const state = { phase: revealed ? 'final-judging' : 'final-clue', revealed, active: { clue }, roundIndex: 0, set: { open_book: true, rounds: [{ mode: 'turns' }], final: clue } };
  render(<FinalRound state={state} teams={[]} />);
  const reference = screen.getByTestId('scripture-reference');
  expect(reference).toHaveTextContent('Look up: Jeremiah 1:5–10');
  expect(screen.getByText('Read this question').compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  if (revealed) expect(reference.compareDocumentPosition(screen.getByText('The answer')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  else expect(screen.queryByText('The answer')).toBeNull();
});
it('legacy null reference is absent', () => {
  const clue = { clue: 'Legacy question', answer: 'Answer', scripture_reference: null };
  render(<FinalRound state={{ phase: 'final-clue', active: { clue }, roundIndex: 0, set: { open_book: true, rounds: [{}], final: clue } }} teams={[]} />);
  expect(screen.queryByTestId('scripture-reference')).toBeNull();
});
