import {describe,it,expect} from 'vitest';
import {KioskSessionAuthority} from '../../../../__app_modules/household/supervision/server/adapters/KioskSessionAuthority.mjs';
const credential='a-device-credential-with-at-least-32-characters';
function fixture(){let now=100000;const authority=new KioskSessionAuthority({householdId:'home',secret:'a-household-signing-secret-with-32-characters',devices:{portal:{credential},garage:{credential:'different-registered-device-credential-32'}},clock:{now:()=>now},makeId:()=> 'session1'});return {authority,advance(ms){now+=ms;}};}
describe('registered kiosk identity',()=>{
 it('rejects device headers, wrong credentials and device hopping',async()=>{
  const {authority}=fixture();await expect(authority.authenticate({headers:{'x-daylight-device':'portal'}})).rejects.toMatchObject({status:403});
  await expect(authority.issue({deviceId:'portal',credential:'incorrect'})).rejects.toMatchObject({status:403});
  const {token}=await authority.issue({deviceId:'portal',credential});const req={headers:{'x-kiosk-session':token}};
  expect(await authority.authenticate(req)).toMatchObject({deviceId:'portal',sessionId:'session1'});
  await expect(authority.resolveContext(req,{targetDeviceId:'garage',activityId:'arcade:test'})).rejects.toMatchObject({status:403});
  expect(await authority.resolveContext(req,{activityId:'school:bank',learnerId:'user_5'})).toMatchObject({deviceId:'portal',activityId:'school:bank',learnerId:'user_5'});
 });
 it('expires signed sessions and refuses tokens from another household',async()=>{
  const h=fixture();const {token}=await h.authority.issue({deviceId:'portal',credential});h.advance(600001);
  await expect(h.authority.authenticate({headers:{'x-kiosk-session':token}})).rejects.toMatchObject({status:403});
  const other=new KioskSessionAuthority({householdId:'other',secret:'a-household-signing-secret-with-32-characters',devices:{portal:{credential}},clock:{now:()=>100000},makeId:()=> 'other'});
  await expect(other.authenticate({headers:{'x-kiosk-session':token}})).rejects.toMatchObject({status:403});
 });
});
it('short-token renewal preserves the authenticated browser binding used by a grant',async()=>{
 let now=100000,id=0;const authority=new KioskSessionAuthority({householdId:'home',secret:'a-household-signing-secret-with-32-characters',devices:{portal:{credential}},clock:{now:()=>now},makeId:()=>`server-browser-${++id}`});
 const cookie=`daylight_kiosk_bootstrap=${authority.provision({deviceId:'portal'})}`,first=await authority.renew({headers:{cookie}});now=701000;const second=await authority.renew({headers:{cookie}});
 expect(second.sessionId).toBe(first.sessionId);expect(await authority.authenticate({headers:{'x-kiosk-session':second.token}})).toMatchObject({deviceId:'portal',sessionId:first.sessionId});
});
