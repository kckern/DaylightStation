import { it, expect } from 'vitest';
import { normalizeFoodOperationResult } from './healthOperationResults.js';
it('matches one-to-many and IDs-only results without guessing row versions', () => {
 const op={id:'op',date:'2026-10-25',targetIds:['a']};
 expect(normalizeFoodOperationResult(op,{committed:true,entryIds:['a','b']})).toMatchObject({operationId:'op',resultIds:['a','b'],readRequired:true});
 expect(normalizeFoodOperationResult(op,{data:{uuid:'a',version:3,date:op.date},versions:{a:3}})).toMatchObject({rows:[{uuid:'a',version:3}],versions:{a:3},readRequired:false});
 expect(normalizeFoodOperationResult(op,{committed:false,clarification:{question:'Which?'}}).outcome).toBe('clarification');
 expect(normalizeFoodOperationResult(op,{committed:false,quarantined:true}).outcome).not.toBe('committed');
 expect(normalizeFoodOperationResult(op,{committed:true,items:[{uuid:'b',version:1,date:'2026-10-24'}]}).affectedDates).toContain('2026-10-24');
});

it('never treats a model revision proposal as a committed food write',()=>{
 expect(normalizeFoodOperationResult({id:'revise'},{proposal:{name:'Soup'},pinned:[]}).outcome).toBe('proposal');
});
