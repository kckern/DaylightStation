import React from 'react';
import {act,render,screen} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import ClueScreen from './ClueScreen.jsx';
it('shows a little-kid cue and names the answering team without claiming a buzz',()=>{
 const round={mode:'turns'};
 render(<ClueScreen state={{phase:'clue',answeringTeamId:'team_1',active:{clue:{value:100,clue:'What is this?',answer:'A baby',little_kids:true}},set:{rounds:[round]},roundIndex:0}} lockedTeam={{id:'team_1',name:'Blue Team',color:'#3273dc',members:[]}}/>);
 expect(screen.getByText("Little kids’ turn")).toBeVisible();
 expect(screen.getByText('Blue Team answers')).toBeVisible();
 expect(screen.queryByText('Show answer')).toBeNull();
});

it.each([true,false])('open-book=%s preserves countdown contract',open_book=>{vi.useFakeTimers();const expire=vi.fn();const view=render(<ClueScreen timerSeconds={25} onTimeout={expire} state={{phase:'clue',active:{clue:{value:100,clue:'Question',answer:'Answer'}},set:{open_book,rounds:[{mode:'hosted'}]},roundIndex:0}}/>);act(()=>vi.advanceTimersByTime(60000));expect(expire).toHaveBeenCalledTimes(open_book?0:1);expect(screen.queryByText('Answer')).toBeNull();view.unmount();vi.useRealTimers();});
