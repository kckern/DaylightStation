import React from 'react';
import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import BuzzerStatus from './BuzzerStatus.jsx';
afterEach(cleanup);
const teams=[{id:'gold',name:'Gold Team'}];
const state={teamIds:['gold'],set:{rounds:[{mode:'hosted'}]},buzzerSetup:{epoch:'tv',seenAt:Date.now(),teams:{gold:{slot:'gamepad:1:Pad',tested:true,connected:true}}}};
it('does not advertise ready from an unexpired lease when local hardware is stale',()=>{
 render(<BuzzerStatus state={state} teams={teams} hardware={{fresh:false,slots:['gamepad:1:Pad']}}/>);
 expect(screen.queryByText(/All teams ready/)).toBeNull();expect(screen.getByText(/Wake the TV/)).toBeVisible();expect(screen.queryByText(/Ready ✓/)).toBeNull();
});
it('shows the missing team a reconnect cue before its disconnect acknowledgement arrives',()=>{
 render(<BuzzerStatus state={state} teams={teams} hardware={{fresh:true,slots:[]}}/>);
 expect(screen.getByText('Gold Team — reconnect and press again')).toBeVisible();expect(screen.queryByText(/Ready ✓/)).toBeNull();
});
