import React,{useLayoutEffect} from 'react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,waitFor,fireEvent} from '@testing-library/react';
import {SupervisionHost} from './SupervisionHost.jsx';
afterEach(()=>localStorage.clear());
describe('all-route supervision host',()=>{
 it('only an explicit unconfigured response opens the existing app',async()=>{
  const api=async()=>({enabled:false});render(<SupervisionHost activityId="school:workspace" api={api} subscribe={()=>()=>{}}><p>Bank balance</p></SupervisionHost>);
  await waitFor(()=>expect(screen.getByText('Bank balance')).toBeTruthy());
 });
 it('parent controls remain usable while all child route content is unmounted',async()=>{
  const api=vi.fn(async path=>path.endsWith('/bootstrap')?{enabled:true,deviceId:'portal'}:{allowed:false,reason:'SUPERVISION_BLOCKED',epoch:1});
  render(<SupervisionHost activityId="school:workspace" api={api} subscribe={()=>()=>{}}><p>Bank balance</p></SupervisionHost>);
  await waitFor(()=>expect(screen.getByText('Paused by a parent')).toBeTruthy());expect(screen.queryByText('Bank balance')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Parent controls'}));expect(screen.getByLabelText('Parent username')).toBeTruthy();
 });
});
it('opening parent controls removes child hotkey and activity handlers while a password is entered',async()=>{
 const api=async path=>path.endsWith('/bootstrap')?{enabled:true,deviceId:'portal'}:{allowed:true,epoch:0,issuedAt:100000,expiresAt:105000};
 render(<SupervisionHost activityId="school:workspace" api={api} subscribe={()=>()=>{}}><p>Bank balance</p></SupervisionHost>);
 await waitFor(()=>expect(screen.getByText('Bank balance')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Parent controls'}));expect(screen.queryByText('Bank balance')).toBeNull();
});

it('a route change cannot mount a new activity using the previous route permit',async()=>{
 let waiting=false,mounts=0;
 const api=async path=>path.endsWith('/bootstrap')?{enabled:true,deviceId:'portal'}:waiting?new Promise(()=>{}):{allowed:true,epoch:0,issuedAt:100000,expiresAt:105000};
 const subscribe=()=>()=>{};function Activity(){useLayoutEffect(()=>{mounts++;},[]);return <p>Activity</p>;}
 const {rerender}=render(<SupervisionHost activityId="school:workspace" api={api} subscribe={subscribe}><Activity key="school"/></SupervisionHost>);
 await waitFor(()=>expect(screen.getByText('Activity')).toBeTruthy());expect(mounts).toBe(1);waiting=true;
 rerender(<SupervisionHost activityId="arcade:other" api={api} subscribe={subscribe}><Activity key="other"/></SupervisionHost>);
 expect(mounts).toBe(1);
});

it('normal route navigation proceeds after a fresh permit without forcing a return home',async()=>{
 const api=async path=>path.endsWith('/bootstrap')?{enabled:true,deviceId:'portal'}:{allowed:true,epoch:0,issuedAt:100000,expiresAt:105000};const subscribe=()=>()=>{};
 const {rerender}=render(<SupervisionHost activityId="school:workspace" api={api} subscribe={subscribe}><p>School</p></SupervisionHost>);await waitFor(()=>expect(screen.getByText('School')).toBeTruthy());
 rerender(<SupervisionHost activityId="piano:practice" api={api} subscribe={subscribe}><p>Piano</p></SupervisionHost>);
 await waitFor(()=>expect(screen.getByText('Piano')).toBeTruthy());expect(screen.queryByRole('button',{name:'Return to menu'})).toBeNull();
});
it('acknowledges Stop only after child lifecycle teardown has committed',async()=>{
 let mounted=false;const acks=[];
 function Child(){useLayoutEffect(()=>{mounted=true;return()=>{mounted=false;};},[]);return <p>Reward</p>;}
 const api=vi.fn(async(path,body)=>{if(path.endsWith('/consumer-ack')){acks.push({body,mounted});return {acknowledged:true};}if(path.endsWith('/bootstrap'))return {enabled:true,deviceId:'portal',active:true,epoch:1,commandRevision:2};return {allowed:false,epoch:1,reason:'SUPERVISION_BLOCKED'};});
 render(<SupervisionHost api={api} subscribe={()=>()=>{}}><Child/></SupervisionHost>);
 await waitFor(()=>expect(acks).toHaveLength(1));expect(acks[0]).toMatchObject({mounted:false,body:{protocol:2,blocked:true,commandRevision:2}});
});
it('parent controls expose physical power uncertainty while keeping child content stopped',async()=>{
 const api=async path=>path.endsWith('/bootstrap')?{enabled:true,deviceId:'portal'}:path.endsWith('/status')?{consumers:[{capability:'ha-stop',acknowledged:true,blocked:true,detail:{verified:false}}]}:{allowed:false,reason:'SUPERVISION_BLOCKED',epoch:1};
 render(<SupervisionHost api={api} subscribe={()=>()=>{}}><p>Reward</p></SupervisionHost>);fireEvent.click(screen.getByRole('button',{name:'Parent controls'}));await waitFor(()=>expect(screen.getByText('Garage power: power off unverified')).toBeTruthy());expect(screen.queryByText('Reward')).toBeNull();
});
it('parent diagnostics require a fresh password command and are cleared when controls close',async()=>{
 const api=vi.fn(async(path)=>path.endsWith('/bootstrap')?{enabled:true,deviceId:'portal'}:path.endsWith('/parent-diagnostics')?{mode:{required:true,known:false},requests:[{id:'private-request',status:'pending'}],enforcement:{errors:['NATIVE_LEASE_CREDENTIAL_REQUIRED']}}:{allowed:false,reason:'SUPERVISION_BLOCKED',epoch:1});
 render(<SupervisionHost api={api} subscribe={()=>()=>{}}><p>Protected</p></SupervisionHost>);fireEvent.click(screen.getByRole('button',{name:'Parent controls'}));fireEvent.change(screen.getByLabelText('Parent username'),{target:{value:'parent'}});fireEvent.change(screen.getByLabelText('Parent password'),{target:{value:'password'}});fireEvent.change(screen.getByLabelText('Parent action'),{target:{value:'diagnostics'}});fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 await waitFor(()=>expect(screen.getByText('Source unavailable or stale')).toBeTruthy());expect(screen.getByLabelText('Parent password').value).toBe('');expect(api).toHaveBeenCalledWith('api/v1/supervision/parent-diagnostics',{username:'parent',password:'password'},'POST');fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(screen.queryByText('Source unavailable or stale')).toBeNull();
});
