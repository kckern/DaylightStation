import React from 'react';
import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import ClueScreen from './ClueScreen.jsx';
it('shows a little-kid cue and names the answering team without claiming a buzz',()=>{
 const round={mode:'turns'};
 render(<ClueScreen state={{phase:'clue',answeringTeamId:'team_1',active:{clue:{value:100,clue:'What is this?',answer:'A baby',little_kids:true}},set:{rounds:[round]},roundIndex:0}} lockedTeam={{id:'team_1',name:'Blue Team',color:'#3273dc',members:[]}}/>);
 expect(screen.getByText("Little kids’ turn")).toBeVisible();
 expect(screen.getByText('Blue Team answers')).toBeVisible();
 expect(screen.getByText('Show answer')).toBeVisible();
});
