import React,{useEffect} from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {act,render,screen,fireEvent} from '@testing-library/react';
import {SupervisionHost} from './SupervisionHost.jsx';
import {registerActivityStop} from './activityLifecycle.js';
let approved,required,stopped,event,api,alive,stops;
const subscribe=handler=>{event=handler;return()=>{};};
const settle=()=>act(async()=>{for(let i=0;i<25;i++)await Promise.resolve();});
function Protected(){useEffect(()=>{alive++;return()=>{alive--;};},[]);return <div data-testid="protected">Selected school workspace</div>;}
beforeEach(()=>{vi.useFakeTimers();localStorage.clear();sessionStorage.clear();approved=false;required=true;stopped=false;alive=0;stops=[];api=vi.fn(async(path,body)=>{
 if(path.includes('/bootstrap'))return {enabled:true,deviceId:'portal',epoch:0,commandRevision:1};
 if(path.includes('/catalog'))return {activities:[{id:'school:workspace',label:'School workspace',path:'/school'}],learners:[{id:'user_5',label:'User_5'}],currentActivityId:path.includes('piano')?'piano:chess':'school:workspace'};
 if(path.includes('/access'))return {allowed:!stopped && (!required || path.includes('server-session')),reason:stopped?'SUPERVISION_BLOCKED':'SUPERVISION_APPROVAL_REQUIRED',epoch:0,issuedAt:100000,expiresAt:105000};
 if(path.endsWith('/consume'))return {sessionId:'server-session',expiresAt:700000};
 if(path.includes('/requests'))return {id:'request-1',learnerId:'user_5',deviceId:'portal',activityId:'school:workspace',status:approved?'approved':'pending'};
 return {acknowledged:true};
});});
afterEach(()=>{vi.useRealTimers();localStorage.clear();sessionStorage.clear();});
it('approved_session_mounts_only_its_activity after consume and canonical permit; a deep link cannot carry it',async()=>{
 const {rerender}=render(<SupervisionHost routePath="/school" api={api} subscribe={subscribe}><Protected/></SupervisionHost>);await settle();expect(alive).toBe(0);expect(screen.queryByTestId('protected')).toBeNull();expect(screen.getByRole('button',{name:'Parent controls'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Learner'),{target:{value:'user_5'}});await settle();fireEvent.click(screen.getByRole('button',{name:'Request permission'}));await settle();approved=true;await act(async()=>vi.advanceTimersByTimeAsync(1000));await settle();expect(alive).toBe(0);
 fireEvent.click(screen.getByRole('button',{name:'Start activity'}));await settle();expect(alive).toBe(1);
 rerender(<SupervisionHost routePath="/piano/games/chess" api={api} subscribe={subscribe}><Protected/></SupervisionHost>);expect(alive).toBe(0);await settle();expect(alive).toBe(0);
});
it('mode_transition_stops_web_audio_and_native_work before showing the shell; Stop has no request button',async()=>{
 required=false;const unregister=registerActivityStop(context=>stops.push(context));render(<SupervisionHost routePath="/school" api={api} subscribe={subscribe}><Protected/></SupervisionHost>);await settle();expect(alive).toBe(1);
 required=true;act(()=>event({topic:'supervision.changed'}));await settle();expect(alive).toBe(0);expect(stops.length).toBeGreaterThan(0);expect(screen.getByRole('button',{name:'Request permission'})).toBeTruthy();
 stopped=true;act(()=>event({topic:'supervision.changed'}));await settle();expect(screen.queryByRole('button',{name:'Request permission'})).toBeNull();expect(screen.getByText('Paused by a parent')).toBeTruthy();unregister();
});
