import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,act,cleanup} from '@testing-library/react';
import {ParentControls} from './ParentControls.jsx';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('shows the failed device beside stopped devices',async()=>{
 const api=async()=>({consumers:[{deviceId:'portal',capability:'portal-keys',acknowledged:false,error:'CAPABILITY_UNAVAILABLE'},{deviceId:'garage',capability:'ha-stop',blocked:true,acknowledged:true,lastContactAt:Date.now(),detail:{verified:true}}]});
 render(<ParentControls api={api}/>);await act(async()=>fireEvent.click(screen.getByText('Parent controls')));
 expect(screen.getByText(/portal.*unverified/i)).toBeTruthy();expect(screen.getByText(/garage.*stopped/i)).toBeTruthy();
});
it('ages an unchanged acknowledgement on the existing two-second refresh',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);
 const api=async()=>({consumers:[{deviceId:'portal',capability:'portal-keys',blocked:true,acknowledged:true,lastContactAt:1000}]});
 render(<ParentControls api={api}/>);await act(async()=>fireEvent.click(screen.getByText('Parent controls')));
 expect(screen.getByText(/portal.*acknowledged/i)).toBeTruthy();await act(async()=>vi.advanceTimersByTimeAsync(6000));
 expect(screen.getByText(/portal.*unverified/i)).toBeTruthy();
});
it('keeps undelivered and accepted-but-unconfirmed parent alerts visible',async()=>{
 const api=async()=>({consumers:[],incidents:[{incidentId:'failed',deviceId:'portal',capability:'portal-keys',status:'delivery-pending',alert:{status:'failed'},recovery:{status:'pending'}},{incidentId:'accepted',deviceId:'garage',capability:'ha-stop',status:'accepted',alert:{status:'accepted'},recovery:{status:'pending'}}]});
 render(<ParentControls api={api}/>);await act(async()=>fireEvent.click(screen.getByText('Parent controls')));
 expect(screen.getByText(/portal.*alert.*failed.*retry pending/i)).toBeTruthy();
 expect(screen.getByText(/garage.*alert.*accepted.*phone delivery unknown/i)).toBeTruthy();
});
