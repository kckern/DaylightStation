import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {act,fireEvent,render,screen,cleanup} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import {MemoryRouter} from 'react-router-dom';
import express from 'express';
import request from 'supertest';
import {createAdminHouseholdRouter} from '../../../../../__backend/src/4_api/v1/routers/admin/household.mjs';
import {ShutdownService} from '../../../../../__backend/src/3_applications/shutdown/ShutdownService.mjs';
const api=vi.hoisted(()=>vi.fn());
vi.mock('../../../lib/api.mjs',()=>({DaylightAPI:api}));
import DevicesIndex from './DevicesIndex.jsx';
afterEach(()=>{cleanup();api.mockReset();});
it('renders actual legacy admin diagnostics with consumer evidence and top-level incident failure',async()=>{
 let state=null;const service=new ShutdownService({repo:{read:async()=>({state}),save:async value=>{state=value;}},getPolicy:()=>({targets:['school:portal'],durationSeconds:1800}),notifier:{publishState(){}},portal:{setLockdown:async()=>({ok:false,code:'CAPABILITY_UNAVAILABLE'})},incidentReporter:{observe:async()=>{throw Error('disk unavailable');}},logger:{warn(){}}});
 await service.activate({now:1000});
 const app=express();app.use((req,res,next)=>{req.householdId='home';next();});app.use('/api/v1/admin/household',createAdminHouseholdRouter({householdAdminService:{listDevices:()=>[]},shutdownDiagnostics:{householdId:'home',read:()=>service.diagnostics(6000)}}));
 api.mockImplementation(async path=>{const response=await request(app).get(path);if(response.status!==200)throw Error('Unavailable');return response.body;});
 render(<MantineProvider><MemoryRouter><DevicesIndex/></MemoryRouter></MantineProvider>);
 expect(await screen.findByText(/portal.*Buttons: unverified/i)).toBeTruthy();
 expect(screen.getByText('Incident reporting unavailable')).toBeTruthy();expect(screen.getByText('Timed Stop requested')).toBeTruthy();
 expect(api).toHaveBeenCalledWith('/api/v1/admin/household/shutdown/status');
});

it('refreshes enforcement on foreground return and ignores a superseded diagnostic read', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const pending = [];
  api.mockImplementation(path => path.endsWith('/shutdown/status')
    ? new Promise(resolve => pending.push(resolve))
    : Promise.resolve({ devices: [] }));
  try {
    const view = render(<MantineProvider><MemoryRouter><DevicesIndex /></MemoryRouter></MantineProvider>);
    await act(async () => vi.advanceTimersByTime(4000));
    expect(pending).toHaveLength(0);
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(pending).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]({ mode: 'legacy', locked: true }));
    await act(async () => pending[0]({ mode: 'legacy', locked: false }));
    expect(screen.getByText('Timed Stop requested')).toBeVisible();
    view.unmount();
    await act(async () => vi.advanceTimersByTime(4000));
    expect(pending).toHaveLength(2);
  } finally {
    visibility.mockRestore();
    vi.useRealTimers();
  }
});
