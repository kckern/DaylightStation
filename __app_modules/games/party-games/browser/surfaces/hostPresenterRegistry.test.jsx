import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import {JeopardyHost} from './hostPresenterRegistry.jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { PARTY_GAMES_HOST_REGISTRY } from "./hostPresenterRegistry.js";

afterEach(cleanup);

describe('Party Games host presenter registry', () => {
  it('registers every mounted Party Games experience by experience identity', () => {
    expect(Object.keys(PARTY_GAMES_HOST_REGISTRY).sort()).toEqual(['activity-party', 'charades', 'dice', 'jeopardy', 'selector']);
    expect(Object.values(PARTY_GAMES_HOST_REGISTRY).every((presenter) => typeof presenter === 'function')).toBe(true);
  });
});

it('shows the actual Daily Double gain and loss independently of ordinary penalties',()=>{
 const set={rounds:[{mode:'hosted',penalize_wrong:false,daily_double_penalize_wrong:true,categories:[{name:'One',clues:[{value:300}]}]}]};
 const state={phase:'wager',roundIndex:0,answeringTeamId:'blue',isDailyDouble:true,teamIds:['blue'],scores:{blue:0},set};
 const props={state,set,teams:[{id:'blue',name:'Blue Team'}],scores:state.scores,send:()=>{},wagerDraft:300,setWagerDraft:()=>{}};
 const view=render(<JeopardyHost {...props}/>);
 expect(screen.getByText('Right: +300 · Wrong: −300')).toBeVisible();
 expect(screen.queryByText(/no points lost/)).toBeNull();
 view.rerender(<JeopardyHost {...props} wagerDraft={100}/>);
 expect(screen.getByText('Right: +100 · Wrong: −100')).toBeVisible();cleanup();
});
