import {describe,it,expect} from 'vitest';
import {routeWork} from './workPolicy.mjs';
import {resolveWorkPolicy} from '../adapters/WorkConfig.mjs';
const config=()=>({work:{enabled:true,write:true,writer_env:'sample-env',writer_host:'sample-host',providerWrites:true,providers:{personal:{type:'todoist',accountId:'personal',authScope:'user',operations:['read','complete']},delivery:{type:'clickup',accountId:'delivery',authScope:'household',operations:['read','transition']}},domains:{personal:{provider:'personal',containerId:'sample-inbox',role:'tasks',autoComplete:'linked_explicit'},software:{provider:'delivery',containerId:'sample-board',role:'projects',autoComplete:'never',transitions:{code_checked_in:'review',accepted:'done'}}},users:{sample:{}}}});
const policy=c=>resolveWorkPolicy({configuration:c,username:'sample',timezone:'America/Los_Angeles'});
describe('work operation routing',()=>{
 it('resolves a domain to the configured provider type/account/destination',()=>expect(routeWork({policy:policy(config()),domainId:'personal',operation:'complete'})).toEqual({provider:'todoist',accountId:'personal',containerId:'sample-inbox'}));
 it('does not choose a first destination for an unknown domain',()=>expect(routeWork({policy:policy(config()),domainId:'missing',operation:'complete'})).toEqual({denied:'unconfigured_domain'}));
 it('denies a command excluded by provider permissions',()=>{const c=config();c.work.providers.personal.operations=['read'];expect(routeWork({policy:policy(c),domainId:'personal',operation:'complete'})).toEqual({denied:'operation_not_allowed'});});
 it('does not confuse native workflow transition with generic completion',()=>{const p=policy(config());expect(routeWork({policy:p,domainId:'software',operation:'transition'}).containerId).toBe('sample-board');expect(routeWork({policy:p,domainId:'software',operation:'complete'})).toEqual({denied:'operation_not_allowed'});});
 it.each(['write','providerWrites'])('cannot grant external commands with %s off',field=>{const c=config();c.work[field]=false;expect(routeWork({policy:policy(c),domainId:'personal',operation:'complete'})).toMatchObject({denied:'provider_writes_disabled'});expect(routeWork({policy:policy(c),domainId:'personal',operation:'read'}).provider).toBe('todoist');});
 it('does not treat inherited object properties as configured routes',()=>expect(routeWork({policy:policy(config()),domainId:'toString',operation:'read'})).toEqual({denied:'unconfigured_domain'}));
});
