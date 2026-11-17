import { it, expect } from 'vitest';
import { validateParticipantLaunchRef, validateActivitySetup } from './participant-launch.mjs';
it('validates typed source references and single action envelopes', () => {
  expect(validateParticipantLaunchRef({schema:'participant-launch-ref/v1',provider:'agenda',ref:'agl_abc'}).ref).toBe('agl_abc');
  expect(() => validateParticipantLaunchRef({provider:'agenda',ref:'agl_abc'})).toThrow();
  const setup = {schema:'agenda-activity-setup/v1',action:'display',participants:{mode:'plan'},consumer:{id:'test-display',version:1},settings:{schema:'test/v1'}};
  expect(validateActivitySetup(setup)).toEqual(setup);
  expect(() => validateActivitySetup({...setup,action:['display','play']})).toThrow();
});
it('bounds opaque handles separately from short provider identifiers',()=>{
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'.repeat(2048)};
 expect(validateParticipantLaunchRef(ref)).toEqual(ref);
 expect(()=>validateParticipantLaunchRef({...ref,ref:'x'.repeat(2049)})).toThrow();
 expect(()=>validateParticipantLaunchRef({...ref,ref:' x'})).toThrow();
 expect(()=>validateParticipantLaunchRef({...ref,provider:'p'.repeat(257)})).toThrow();
});
