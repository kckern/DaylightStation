import {it,expect} from 'vitest';
import {presentEnforcement} from './enforcementPresentation.js';
const ackAt1000={deviceId:'portal',capability:'portal-keys',commandRevision:2,blocked:true,acknowledged:true,lastContactAt:1000};
it('expires a nominally acknowledged control after 5000 ms',()=>{expect(presentEnforcement(ackAt1000,6001).state).toBe('unverified');});
it('distinguishes a fresh native ACK from physical verification',()=>{
 expect(presentEnforcement(ackAt1000,6000).state).toBe('acknowledged');
 expect(presentEnforcement({...ackAt1000,detail:{verified:true}},1001).state).toBe('verified');
 expect(presentEnforcement({...ackAt1000,detail:{verified:false}},1001).state).toBe('unverified');
});
it('rejects missing and future contact timestamps',()=>{for(const lastContactAt of [null,undefined,2000])expect(presentEnforcement({...ackAt1000,lastContactAt},1000).state).toBe('unverified');});
it('shows requested only while a current command is awaiting its first acknowledgement',()=>{
 expect(presentEnforcement({...ackAt1000,acknowledged:false,lastContactAt:null,requestedAt:1000},1001).state).toBe('requested');
 expect(presentEnforcement({...ackAt1000,acknowledged:false,lastContactAt:null,requestedAt:1000},6001).state).toBe('unverified');
});
