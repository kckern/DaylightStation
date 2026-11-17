import { describe, it, expect } from 'vitest';
import { ParticipantConsumerRegistry } from './ParticipantConsumerRegistry.mjs';
const matcher = {action:'display',kind:'content',source:'test',capability:'display'};
const consumer = (overrides = {}) => ({id:'test-display',version:1,targets:[matcher],describe:()=>({participantRequirement:'optional',minParticipants:0,maxParticipants:10,selectorSupport:['all','explicit'],settingsSchema:'display/v1',editorKey:'test'}),prepareSetup:async () => ({}),begin:async () => ({}),remapParticipantKeys:({settings,keyMap})=>({...settings,key:keyMap[settings.key]}),...overrides});
const target = {kind:'content',source:'test',capabilities:{display:{participantConsumer:{id:'test-display',version:1}}}};
describe('participant consumer registry', () => {
  it('requires action-specific independently declared capability', () => {
    const registry = new ParticipantConsumerRegistry(); registry.register({consumer:consumer()});
    expect(registry.resolve({action:'display',target}).id).toBe('test-display');
    expect(registry.resolve({action:'play',target})).toBeNull();
    expect(registry.resolve({action:'display',target:{...target,capabilities:{}}})).toBeNull();
    expect(() => registry.resolve({action:'display',target:{...target,capabilities:{display:{participantConsumer:{id:'wrong',version:1}}}}})).toThrow();
    expect(registry.get({id:'test-display',version:2})).toBeNull();
    expect(registry.describe({action:'display',target}).participantRequirement).toBe('optional');
    expect(registry.remapActivitySettings({consumer:{id:'test-display',version:1},settings:{key:'a'},participantKeyMap:{a:'b'},itemUidMap:{}})).toEqual({key:'b'});
  });
  it('rejects overlapping matchers and incomplete resume pairs', () => {
    const registry = new ParticipantConsumerRegistry(); registry.register({consumer:consumer()});
    expect(() => registry.register({consumer:consumer({id:'other'})})).toThrow();
    expect(() => registry.register({consumer:consumer({id:'other',targets:[{...matcher,capability:'other'}]})})).toThrow();
    expect(() => new ParticipantConsumerRegistry().register({consumer:consumer({findResumable:async()=>[]})})).toThrow();
  });
});

it('fails closed on explicit unknown or mismatched declarations but leaves sibling actions unbound', () => {
  const registry = new ParticipantConsumerRegistry();
  registry.register({consumer:consumer()});
  registry.register({consumer:consumer({id:'app-consumer',targets:[{action:'open',kind:'app',appId:'known'}]})});
  const app = {kind:'app',appId:'known',participantConsumer:{id:'app-consumer',version:1}};
  expect(registry.resolve({action:'play',target:app})).toBeNull();
  expect(() => registry.resolve({action:'open',target:{kind:'app',appId:'missing',participantConsumer:{id:'missing',version:1}}})).toThrow();
  expect(() => registry.resolve({action:'open',target:{...app,appId:'wrong'}})).toThrow();
  expect(() => registry.resolve({action:'display',target:{kind:'content',source:'other',capabilities:{display:{participantConsumer:{id:'missing',version:1}}}}})).toThrow();
  expect(() => registry.resolve({action:'display',target:{...target,capabilities:{...target.capabilities,slides:{action:'display',participantConsumer:{id:'missing',version:1}}}}})).toThrow();
  expect(() => registry.resolve({action:'display',target:{kind:'content',source:'other',capabilities:{slides:{action:'display',participantConsumer:{id:'missing',version:1}}}}})).toThrow();
  expect(() => registry.resolve({action:'display',target:{...target,capabilities:{display:{action:'play',participantConsumer:{id:'test-display',version:1}}}}})).toThrow();
  expect(registry.resolve({action:'play',target})).toBeNull();
});

it('retains an older version without registering its matchers for new launches',()=>{
 const registry=new ParticipantConsumerRegistry();
 const make=version=>({id:'versioned',version,targets:[{action:'open',kind:'app',appId:'versioned'}],describe:()=>({}),prepareSetup:async()=>({}),begin:async()=>({})});
 const old=make(1),current=make(2);
 registry.register({consumer:old,retainedOnly:true}); registry.register({consumer:current});
 const target={kind:'app',appId:'versioned',participantConsumer:{id:'versioned',version:2}};
 expect(registry.resolve({action:'open',target})).toBe(current); expect(registry.get({id:'versioned',version:1})).toBe(old);
});

it('finds a retained direct access factory only for the exact version and matcher',()=>{
 const registry=new ParticipantConsumerRegistry(); const factory=()=>{};
 const consumer={id:'old',version:1,targets:[{action:'open',kind:'app',appId:'thing'}],describe:()=>({}),prepareSetup:async()=>({}),begin:async()=>({})};
 registry.register({consumer,authorizeDirectAccess:factory,retainedOnly:true});
 const target={kind:'app',appId:'thing',participantConsumer:{id:'old',version:1}};
 expect(registry.retainedDirectAccess({action:'open',target})).toBe(factory);
 expect(registry.retainedDirectAccess({action:'play',target})).toBeNull();
 expect(registry.retainedDirectAccess({action:'open',target:{...target,appId:'forged'}})).toBeNull();
});

it('requires a direct store authority for a consumer providing direct defaults',()=>{
 const defaulted=consumer({resolveDefaultContext:async()=>null});
 expect(()=>new ParticipantConsumerRegistry().register({consumer:defaulted})).toThrow();
 expect(()=>new ParticipantConsumerRegistry().register({consumer:defaulted,authorizeDirectAccess:async()=>({store:{},scope_key:'scope'})})).not.toThrow();
});
