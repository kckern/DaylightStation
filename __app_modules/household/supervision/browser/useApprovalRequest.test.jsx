import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {act,renderHook} from '@testing-library/react';
import {useApprovalRequest} from './useApprovalRequest.js';
import {readRequestContextHeaders} from '../../../../frontend/src/lib/requestContextHeaders.mjs';
const context={deviceId:'portal',learnerId:'user_5',activityId:'school:workspace'};
let status,api,calls;
const settle=()=>act(async()=>{for(let i=0;i<10;i++)await Promise.resolve();});
beforeEach(()=>{vi.useFakeTimers();sessionStorage.clear();status='pending';calls=[];api=vi.fn(async(path,body,method)=>{calls.push({path,body,method});if(path.endsWith('/consume'))return {sessionId:'server-session',expiresAt:700000};if(path.endsWith('/end'))return {ended:true};return {id:'request-1',...context,status,expiresAt:220000};});});
afterEach(()=>{vi.useRealTimers();sessionStorage.clear();});
describe('server owned request lifecycle',()=>{
 it('pending_duplicate_clicks_send_one_request and never grants from a push',async()=>{
  let resolve;api=vi.fn(()=>new Promise(r=>{resolve=r;}));const {result}=renderHook(()=>useApprovalRequest({context,api}));
  act(()=>{void result.current.requestPermission();void result.current.requestPermission();});expect(api).toHaveBeenCalledTimes(1);expect(result.current.session).toBeNull();
  await act(async()=>resolve({id:'request-1',...context,status:'pending'}));expect(result.current.status).toBe('pending');expect(result.current.session).toBeNull();
 });
 it('approved requires explicit consume and never opens content without a separate permit',async()=>{
  const {result}=renderHook(()=>useApprovalRequest({context,api}));await act(async()=>result.current.requestPermission());status='approved';await act(async()=>vi.advanceTimersByTimeAsync(1000));
  expect(result.current.status).toBe('approved');expect(result.current.session).toBeNull();expect(calls.some(call=>call.path.endsWith('/consume'))).toBe(false);
  await act(async()=>result.current.startSession());expect(result.current.session).toMatchObject({requestId:'request-1',sessionId:'server-session'});expect(readRequestContextHeaders()['X-Supervision-Session']).toBe('server-session');
 });
 it('refresh restores only metadata and revalidates authoritative terminal status',async()=>{
  const first=renderHook(()=>useApprovalRequest({context,api}));await act(async()=>first.result.current.requestPermission());first.unmount();status='denied';
  const second=renderHook(()=>useApprovalRequest({context,api}));expect(second.result.current.session).toBeNull();await settle();expect(second.result.current.status).toBe('denied');expect(second.result.current.session).toBeNull();
 });
 it('profile or activity change ends old session and discards delayed old responses',async()=>{
  status='approved';const {result,rerender}=renderHook(({value})=>useApprovalRequest({context:value,api}),{initialProps:{value:context}});await act(async()=>result.current.requestPermission());await act(async()=>result.current.startSession());
  rerender({value:{...context,learnerId:'sibling'}});await settle();expect(result.current.session).toBeNull();expect(readRequestContextHeaders()['X-Supervision-Session']).toBeUndefined();expect(calls.some(call=>call.path.endsWith('/end') && call.body.learnerId==='user_5')).toBe(true);
 });
 it('cancel, expiry and connection failure cannot start protected activity',async()=>{
  const {result}=renderHook(()=>useApprovalRequest({context,api}));await act(async()=>result.current.requestPermission());status='cancelled';await act(async()=>result.current.cancelRequest());expect(result.current.status).toBe('cancelled');
  await act(async()=>result.current.startSession());expect(result.current.session).toBeNull();
 });
});
it('a delayed request response after a profile switch is cancelled rather than adopted',async()=>{
 let resolve;api=vi.fn(async(path)=>path.endsWith('/requests')?new Promise(r=>{resolve=r;}):{ended:true});
 const {result,rerender}=renderHook(({value})=>useApprovalRequest({context:value,api}),{initialProps:{value:context}});
 act(()=>void result.current.requestPermission());rerender({value:{...context,learnerId:'sibling'}});await settle();await act(async()=>resolve({id:'late-request',...context,status:'pending'}));
 expect(result.current.request).toBeNull();expect(result.current.session).toBeNull();expect(api).toHaveBeenCalledWith('api/v1/supervision/requests/late-request/end',context,'POST');
});
