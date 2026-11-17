import Ajv from 'ajv';
import moment from 'moment-timezone';
import {createHash} from 'node:crypto';
import {WORK_OPERATIONS} from '../domain/workModel.mjs';
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$'};
const map=additionalProperties=>({type:'object',propertyNames:{pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'},additionalProperties});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const provider=object({type:{enum:['todoist','clickup']},accountId:id,authScope:{enum:['user','household']},operations:{type:'array',minItems:1,uniqueItems:true,items:{enum:WORK_OPERATIONS}}},['type','accountId','authScope','operations']);
const domain=object({provider:id,containerId:id,creationParentId:id,role:{enum:['tasks','projects']},autoComplete:{enum:['linked_explicit','never']},transitions:map({type:'string',minLength:1,maxLength:128}),assigneeIds:{type:'array',uniqueItems:true,items:id}},['provider','containerId','role','autoComplete']);
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const attention=object({maxProactiveUnitsPerDay:integer(1,2),maxHousekeepingPer7Days:integer(0,1),itemCooldownDays:integer(30,365),ignoredOffersBeforeQuiet:integer(1,2),ignoredOfferHours:integer(36,168),quietDays:integer(30,365),staleRelevanceDays:integer(30,365),offerExpiryHours:integer(1,24),reviewWindows:{type:'array',items:object({days:{type:'array',minItems:1,uniqueItems:true,items:integer(1,7)},start:{type:'string',pattern:'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'},end:{type:'string',pattern:'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'}},['days','start','end'])},housekeepingDomains:{type:'array',uniqueItems:true,items:id},rankerEnabled:{type:'boolean'}});
const properties={enabled:{type:'boolean'},catchUp:{type:'boolean'},write:{type:'boolean'},writer_env:{type:['string','null'],minLength:1,maxLength:128},writer_host:{type:['string','null'],minLength:1,maxLength:255},operator_uid:{type:['integer','null'],minimum:0},providerWrites:{type:'boolean'},importWrites:{type:'boolean'},proactive:{type:'boolean'},pollMinutes:integer(1,1440),snapshotMaxAgeHours:{type:'number',minimum:1,maximum:168},modelCallsPerLocalDay:integer(1,4),backfillMaxDays:integer(1,90),providers:map(provider),domains:map(domain),attention};
const ajv=new Ajv({allErrors:false,ownProperties:true});
const validate=ajv.compile(object(properties));
const validateAttention=ajv.compile(attention);
const defaults={enabled:false,catchUp:false,write:false,writer_env:null,writer_host:null,operator_uid:null,providerWrites:false,importWrites:false,proactive:false,pollMinutes:15,snapshotMaxAgeHours:24,modelCallsPerLocalDay:4,backfillMaxDays:90,providers:{},domains:{},attention:{maxProactiveUnitsPerDay:2,maxHousekeepingPer7Days:1,itemCooldownDays:30,ignoredOffersBeforeQuiet:2,ignoredOfferHours:36,quietDays:30,staleRelevanceDays:30,offerExpiryHours:24,reviewWindows:[],housekeepingDomains:[],rankerEnabled:false}};
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const revision=(value,username,timezone)=>createHash('sha256').update(canonical({value,username,timezone})).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function policy(value,username,timezone,reason=null){return {enabled:value.enabled,catchUp:value.catchUp,username,timezone,revision:revision(value,username,timezone),reason,diagnostics:reason?[reason]:[],providers:value.providers,domains:value.domains,providerWrites:value.providerWrites,importWrites:value.importWrites,proactive:value.proactive,attention:value.attention,limits:{pollMinutes:value.pollMinutes,snapshotMaxAgeHours:value.snapshotMaxAgeHours,modelCallsPerLocalDay:value.modelCallsPerLocalDay,backfillMaxDays:value.backfillMaxDays},writer:{write:value.write,writer_env:value.writer_env,writer_host:value.writer_host,operatorUid:value.operator_uid}};}
/** Explicit enrollment; per-user maps replace base maps so hidden routes cannot survive. */
export function resolveWorkPolicy({configuration={},username,timezone}){
 const inert=reason=>policy(structuredClone(defaults),username,timezone,reason);
 try{
  const base=configuration?.work;
  if(!base||base.enabled!==true)return inert('disabled');
  if(typeof username!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username)||!plain(base.users)||!Object.hasOwn(base.users,username))return inert('unknown_work_user');
  if(!moment.tz.zone(timezone))return inert('invalid_work_timezone');
  const {users,...shared}=base,override=users[username];
  if(!plain(override)||Object.hasOwn(override,'users'))return inert('invalid_work_config');
  const merged=structuredClone({...defaults,...shared,...override,attention:{...defaults.attention,...shared.attention,...override.attention}});
  const rawAttention=structuredClone(merged.attention);
  const invalidAttention=!validateAttention(rawAttention)||rawAttention.housekeepingDomains.some(id=>!Object.hasOwn(merged.domains??{},id))||rawAttention.reviewWindows.some(w=>w.start>=w.end);
  if(invalidAttention){merged.attention=structuredClone(defaults.attention);merged.proactive=false;}
  if(!validate(merged)||merged.write&&(!merged.writer_env||!merged.writer_host))return inert('invalid_work_config');
  const accounts=new Map();
  for(const p of Object.values(merged.providers)){if(accounts.has(p.type)&&accounts.get(p.type)!==JSON.stringify([p.accountId,p.authScope]))return inert('ambiguous_provider_account');accounts.set(p.type,JSON.stringify([p.accountId,p.authScope]));}
  for(const d of Object.values(merged.domains)){
   if(!Object.hasOwn(merged.providers,d.provider))return inert('invalid_work_config');
   if(merged.providers[d.provider].type==='clickup'&&d.creationParentId===d.containerId)return inert('ambiguous_work_container_kind');
  }
  const result=policy(merged,username,timezone,invalidAttention?'invalid_attention_policy':null);
  if(invalidAttention)result.revision=revision({merged,rawAttention},username,timezone);
  return result;
 }catch{return inert('invalid_work_config');}
}
