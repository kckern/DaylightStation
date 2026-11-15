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
