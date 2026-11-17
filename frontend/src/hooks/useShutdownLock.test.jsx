import {it,expect,vi,afterEach} from 'vitest';
import {renderHook,waitFor,cleanup} from '@testing-library/react';
vi.mock('../services/WebSocketService.js',()=>({wsService:{subscribe:()=>()=>{}}}));
import {useShutdownLock} from './useShutdownLock.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
it('retains enforcement diagnostics while preserving the finite cached blackout lock',async()=>{
 const lockedUntil=new Date(Date.now()+60000).toISOString(),enforcement={incidentReportingError:'INCIDENT_REPORTING_UNAVAILABLE',consumers:[{deviceId:'portal',acknowledged:false}]};
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({locked:true,lockedUntil,enforcement})})));
 const {result}=renderHook(()=>useShutdownLock('school:portal'));await waitFor(()=>expect(result.current.locked).toBe(true));expect(result.current.enforcement).toEqual(enforcement);
 expect(JSON.parse(localStorage.getItem('daylight.shutdown.school:portal'))).toEqual({locked:true,lockedUntil});
});
