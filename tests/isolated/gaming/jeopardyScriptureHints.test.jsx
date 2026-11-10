import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,act} from '@testing-library/react';
import {createDurableJeopardyFixture} from '../../_lib/createDurableJeopardyFixture.mjs';
import ClueScreen from '../../../__app_modules/games/party-games/browser/experiences/jeopardy/ClueScreen.jsx';
import FinalRound from '../../../__app_modules/games/party-games/browser/experiences/jeopardy/FinalRound.jsx';
import {JeopardyHost} from '../../../__app_modules/games/party-games/browser/surfaces/hostPresenterRegistry.jsx';
const fixtures=[];afterEach(()=>{cleanup();vi.useRealTimers();for(const f of fixtures.splice(0))f.dispose();});
const teams=[{id:'blue',name:'Blue Team'},{id:'gold',name:'Gold Team'}];
it.each(['ordinary','daily-double','final'])('loaded scripture hints precede public answers on TV and are available to the host: %s',async kind=>{
 const fixture=await createDurableJeopardyFixture();fixtures.push(fixture);
 const session=await fixture.application.createSession({definitionId:'jeopardy:test',seats:teams,viewer:{role:'host'}});
 const set=session.state.set,round=set.rounds[0];let clue=round.categories[0].clues[1];
 if(kind==='daily-double')clue=round.categories.flatMap(c=>c.clues).find(c=>c.daily_double);
 if(kind==='final')clue=set.final;
 // Presenter fixtures use the real newly compiled content; full transitions
 // and persistent scoring are exercised by the authority/browser gates.
 const state={...session.state,phase:kind==='final'?'final-clue':'clue',active:{cat:0,row:1,clue},revealed:false,isDailyDouble:kind==='daily-double',wager:300,answeringTeamId:kind==='daily-double'?'blue':null};
 const timeout=vi.fn();vi.useFakeTimers();
 const tv=render(kind==='final'?<FinalRound state={state} teams={teams}/>:<ClueScreen state={state} onTimeout={timeout}/>);
 expect(screen.getByTestId('scripture-reference')).toHaveTextContent(clue.scripture_reference);expect(screen.queryByText(clue.answer)).toBeNull();
 await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(timeout).not.toHaveBeenCalled();tv.unmount();
 const props={state,set,teams,scores:state.scores,send:()=>{},setWagerDraft:()=>{},wagerDraft:300};
 const phone=render(<JeopardyHost {...props}/>);expect(screen.getByText(`Scripture: ${clue.scripture_reference}`)).toBeVisible();
 if(kind==='daily-double'){phone.rerender(<JeopardyHost {...props} state={{...state,phase:'wager'}}/>);expect(screen.queryByText(`Scripture: ${clue.scripture_reference}`)).toBeNull();}
});
