import {it,expect} from 'vitest';
import {addSundayFitnessPolicy} from '../../../../scripts/migrate-fitness-sunday-policy.mjs';
import {INSTALLED_STATE_GATES_POLICY} from '../../../../__backend/src/5_composition/modules/installedStateGatesPolicy.mjs';
it('preserves custom claims/gates/entitlements and increments authored revision',()=>{
 const original=structuredClone(INSTALLED_STATE_GATES_POLICY);delete original.gates['fitness.games-outside-sunday'];delete original.entitlements['fitness.games-unsupervised'];original.policy_revision=47;original.claim_types['custom.fact']={anything:'preserve'};original.entitlements['custom.capability']={gate:'school.day-complete',failure_posture:'fail_closed'};
 const result=addSundayFitnessPolicy(original);expect(result.policy_revision).toBe(48);expect(result.claim_types).toEqual(original.claim_types);expect(result.entitlements['custom.capability']).toEqual(original.entitlements['custom.capability']);expect(original.gates['fitness.games-outside-sunday']).toBeUndefined();expect(addSundayFitnessPolicy(result)).toEqual(result);
});
it('rejects conflicting names rather than silently overwriting household policy',()=>{const raw=structuredClone(INSTALLED_STATE_GATES_POLICY);raw.gates['fitness.games-outside-sunday']={different:true};expect(()=>addSundayFitnessPolicy(raw)).toThrow(/conflict/i);});
it('writes only a new structurally validated candidate, never overwrites the live input or an existing destination',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),yaml=(await import('js-yaml')).default;
 const {prepareSundayPolicy}=await import('../../../../scripts/migrate-fitness-sunday-policy.mjs');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sunday-policy-'));
 try{const inputPath=path.join(directory,'source.yml'),outputPath=path.join(directory,'candidate.yml'),raw=structuredClone(INSTALLED_STATE_GATES_POLICY);delete raw.gates['fitness.games-outside-sunday'];delete raw.entitlements['fitness.games-unsupervised'];raw.policy_revision=42;
  const text=yaml.dump(raw);await fs.writeFile(inputPath,text);const validationContext={timezone:'America/Los_Angeles',subjects:[],publisherIds:Object.keys(raw.publishers)};
  expect((await prepareSundayPolicy({inputPath,outputPath,validationContext})).policy_revision).toBe(43);expect(await fs.readFile(inputPath,'utf8')).toBe(text);
  await expect(prepareSundayPolicy({inputPath,outputPath,validationContext})).rejects.toMatchObject({code:'EEXIST'});await expect(prepareSundayPolicy({inputPath,outputPath:inputPath,validationContext})).rejects.toMatchObject({code:'EEXIST'});expect(await fs.readFile(inputPath,'utf8')).toBe(text);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
