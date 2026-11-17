import {it,expect} from 'vitest';
import {createParticipantBrowserRegistry} from './participantBrowserRegistry.js';
it('resolves only the exact consumer version and registered output schema',()=>{
 const adapter=()=>null;
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:adapter}]);
 expect(registry.resolve({consumer:{id:'neutral',version:1},output:{schema:'neutral/v1'}})).toBe(adapter);
 expect(registry.resolve({consumer:{id:'neutral',version:2},output:{schema:'neutral/v1'}})).toBeNull();
 expect(registry.resolve({consumer:{id:'neutral',version:1},output:{schema:'other/v1'}})).toBeNull();
});
it('resolves passthrough only through the inspected consumer registration',()=>{
 const pass=()=>null;
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:()=>null,passthrough:pass}]);
 expect(registry.resolvePassthrough({id:'neutral',version:1})).toBe(pass);
 expect(registry.resolvePassthrough({id:'neutral',version:2})).toBeNull();
});
it('registers the Party Games adapter for the exact production result', async()=>{
 const {participantBrowserRegistry}=await import('./participantBrowserRegistry.js');
 expect(participantBrowserRegistry.resolve({consumer:{id:'party-games',version:1},output:{schema:'party-games-launch-result/v1'}})).toBeTypeOf('function');
 expect(participantBrowserRegistry.resolvePassthrough({id:'party-games',version:1})).toBeTypeOf('function');
});
it('resolves preview renderers only for the exact consumer and preview schema',()=>{
 const preview=()=>null;const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:()=>null,previewSchema:'neutral-preview/v1',preview}]);
 expect(registry.resolvePreview({consumer:{id:'neutral',version:1},consumer_summary:{schema:'neutral-preview/v1',data:{}}})).toBe(preview);
 expect(registry.resolvePreview({consumer:{id:'neutral',version:2},consumer_summary:{schema:'neutral-preview/v1',data:{}}})).toBeNull();
 expect(registry.resolvePreview({consumer:{id:'neutral',version:1},consumer_summary:{schema:'other/v1',data:{}}})).toBeNull();
});
it('accepts only complete Party Games preview data for fresh review', async()=>{
 const {participantBrowserRegistry:registry}=await import('./participantBrowserRegistry.js');
 const options={consumer:{id:'party-games',version:1},consumer_summary:{schema:'party-games-preview/v2',data:{participants:[{name:'Guest',avatar:null,clue_mode:'reader'}]}}};
 expect(registry.resolvePreview(options)).toBeTypeOf('function');
 expect(registry.resolvePreview({...options,consumer_summary:{...options.consumer_summary,data:{participants:[{name:'Guest'}]}}})).toBeNull();
 expect(registry.resolvePreview({...options,consumer_summary:{...options.consumer_summary,schema:'party-games-preview/v1'}})).toBeNull();
});
