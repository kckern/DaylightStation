import React from 'react';
import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import FinalRound from './FinalRound.jsx';
it.each(['final-category','final-wager','final-clue','final-judging'])('presents %s without gameplay controls',phase=>{render(<FinalRound state={{phase,set:{final:{category:'Final category',clue:'Question',answer:'Answer'},rounds:[{categories:[{clues:[{value:100}]}]}]},finalWagers:{},finalJudged:{}}} teams={[{id:'a',name:'Blue'}]} scores={{a:0}}/>);expect(screen.queryAllByRole('button')).toHaveLength(0);expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);expect(document.querySelector('.jp-final')).toHaveTextContent(/Final|Question|Blue/);});
