import {describe,it,expect} from 'vitest';
import {resolveWorkPolicy} from './WorkConfig.mjs';
const base=()=>({work:{enabled:true,providers:{personal:{type:'todoist',accountId:'personal',authScope:'user',operations:['read']}},domains:{personal:{provider:'personal',containerId:'sample-list',role:'tasks',autoComplete:'linked_explicit'},project:{provider:'personal',containerId:'sample-project',role:'projects',autoComplete:'never'}},users:{sample:{}}}});
const resolve=(configuration,username='sample')=>resolveWorkPolicy({configuration,username,timezone:'America/Los_Angeles'});
describe('work configuration boundaries',()=>{
 it('is inert and read-only when never configured',()=>{
  const p=resolve({});expect(p.enabled).toBe(false);expect(p.writer.write).toBe(false);expect(p.limits.backfillMaxDays).toBe(90);expect(p.limits.modelCallsPerLocalDay).toBe(4);
 });
 it('lets one account serve tasks and projects without inventing another provider',()=>{
  const p=resolve(base());expect(p.enabled).toBe(true);expect(p.domains.personal.provider).toBe('personal');expect(p.domains.project.provider).toBe('personal');expect(Object.keys(p.providers)).toEqual(['personal']);
 });
 it('requires explicit user enrollment and cannot read another user override',()=>{
  const c=base();c.work.users.other={providers:{other:{type:'clickup',accountId:'other-account',authScope:'household',operations:['read']}},domains:{project:{provider:'other',containerId:'other-list',role:'projects',autoComplete:'never'}}};
  expect(resolve(c,'unknown')).toMatchObject({enabled:false,reason:'unknown_work_user'});
  expect(resolve(c).providers.personal.accountId).toBe('personal');expect(resolve(c).providers.other).toBeUndefined();
  expect(Object.keys(resolve(c,'other').providers)).toEqual(['other']);
 });
 it('copies configuration and issues a stable user-scoped revision',()=>{
  const c=base(),p=resolve(c),again=resolve(c);expect(p.revision).toBe(again.revision);
  p.domains.personal.containerId='changed';expect(c.work.domains.personal.containerId).toBe('sample-list');
  c.work.users.sample.providerWrites=true;expect(resolve(c).revision).not.toBe(again.revision);
 });
 it.each([
  c=>{c.work.providers.personal.api_key='not-a-secret';},
  c=>{c.work.domains.personal.containerId='../other';},
  c=>{c.work.providers.personal.type='uninstalled';},
  c=>{c.work.domains.personal.provider='missing';},
  c=>{c.work.domains.personal.autoComplete='everything';},
  c=>{c.work.backfillMaxDays=91;},
  c=>{c.work.modelCallsPerLocalDay=5;},
  c=>{c.work.users.sample.users={other:{}};},
  c=>{c.work.write=true;},
 ])('fails closed for unsafe, unknown or unbounded policy',change=>{
  const c=base();change(c);expect(resolve(c)).toMatchObject({enabled:false,reason:'invalid_work_config'});
 });
 it('rejects an absent/invalid timezone rather than using process timezone',()=>expect(resolveWorkPolicy({configuration:base(),username:'sample',timezone:'bad/timezone'})).toMatchObject({enabled:false,reason:'invalid_work_timezone'}));
 it('keeps an explicitly disabled config inert even if obsolete provider fields exist',()=>expect(resolve({work:{enabled:false,providers:{retired:{type:'unknown'}}}}).enabled).toBe(false));
});
it.each([
 {reviewWindows:[{days:[1],start:'22:00',end:'07:00'}]},
 {housekeepingDomains:['missing']},
 {maxProactiveUnitsPerDay:3},
 {reviewWindows:[{days:[8],start:'07:00',end:'08:00'}]},
])('disables only malformed attention while retaining manual read access: %j',attention=>{
 const c=base();c.work.proactive=true;c.work.attention=attention;
 const p=resolve(c);expect(p.enabled).toBe(true);expect(p.proactive).toBe(false);expect(p.diagnostics).toContain('invalid_attention_policy');
});
it('rejects multiple harvested accounts of one provider for the same user instead of silently sharing one snapshot',()=>{
 const c=base();c.work.providers.second={...c.work.providers.personal,accountId:'second-account'};
 expect(resolve(c)).toMatchObject({enabled:false,reason:'ambiguous_provider_account'});
});
it('accepts an enrolled dotted username supported by the existing KB user namespace',()=>{
 const c=base();c.work.users['sample.user']={};expect(resolve(c,'sample.user').enabled).toBe(true);
});
