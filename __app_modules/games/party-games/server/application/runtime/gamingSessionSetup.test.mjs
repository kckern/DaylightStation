import { it, expect } from 'vitest';
import { prepareGamingSessionSetup } from './gamingSessionSetup.mjs';
it('persists the new Jeopardy flow version in fresh setup',()=>{
 const request={seats:[{id:'blue'}],setup:{teams:[{id:'blue'}],jeopardy_flow_version:1}};
 expect(prepareGamingSessionSetup({manifest:{id:'jeopardy',setup:{kind:'teams'}},request}).setup.jeopardy_flow_version).toBe(2);
 expect(request.setup.jeopardy_flow_version).toBe(1);
});
it('does not add a Jeopardy version to unrelated experiences',()=>{
 expect(prepareGamingSessionSetup({manifest:{id:'other'},request:{}}).setup).toEqual({});
});
