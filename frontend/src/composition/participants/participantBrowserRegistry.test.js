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
