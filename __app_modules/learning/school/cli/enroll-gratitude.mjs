import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs,isDeepStrictEqual} from 'node:util';
import yaml from 'js-yaml';
import {YamlAssignmentStore} from '../server/adapters/persistence/YamlAssignmentStore.mjs';
import {SetAssignments} from '../server/application/usecases/SetAssignments.mjs';
import {GrownUpGate} from '../server/application/GrownUpGate.mjs';
import {createSchoolProgramEnrollmentValidators} from '../server/application/SchoolProgramEnrollmentValidators.mjs';
import {preserveExistingEnrollments} from './lib/preserve-existing-enrollments.mjs';

export async function enrollGratitudeLearners({learnerIds,assignedBy,assignments,setAssignments,apply=false}){
  const results=[];
  for(const learnerId of learnerIds){
    const existing=await assignments.get(learnerId);if(!existing)throw new Error(`No existing assignment for ${learnerId}`);
    if(existing.programs?.some(p=>p.programId==='gratitude')){results.push({learnerId,changed:false,assignment:existing});continue;}
    const program={programId:'gratitude',corpusId:null,subject:'scripture',title:'Gratitude',schedule:{daysOfWeek:[1,2,3,4,5]}};
    let proposed;
    const guarded={get:id=>assignments.get(id),put:async record=>{
      if(!isDeepStrictEqual(await assignments.get(learnerId),existing))throw new Error('Assignments changed since validation');
      proposed=record;if(apply)await assignments.put(record);return record;
    }};
    const useCase=setAssignments(existing,{assignments:guarded});
    await useCase.execute({learnerId,assignedBy,courses:existing.courses,units:existing.units,programs:[...(existing.programs??[]),program],baseUpdatedAt:existing.updatedAt});
    results.push({learnerId,changed:true,assignment:proposed});
  }
  return results;
}
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{base:{type:'string'},learners:{type:'string'},'assigned-by':{type:'string'},apply:{type:'boolean',default:false}}});
  const base=values.base??process.env.DAYLIGHT_BASE_PATH;
  if(!base||!values.learners||!values['assigned-by'])throw new Error('Usage: enroll-gratitude --base <content-base> --learners <id,id> --assigned-by <adult> [--apply]');
  const actor=values['assigned-by'];if(!/^[a-z0-9][a-z0-9_-]*$/i.test(actor))throw new Error('Invalid adult ID');
  const profile=yaml.load(fs.readFileSync(path.join(base,'data/users',actor,'profile.yml'),'utf8'));
  const configService={getHouseholdPath:p=>path.join(base,'data/household',p)};
  const logger={info(){},warn:event=>process.stderr.write(JSON.stringify({event})+'\n')};
  const assignments=new YamlAssignmentStore({configService,logger});
  const setAssignments=(existing,{assignments:guarded})=>new SetAssignments({assignments:guarded,grownUps:new GrownUpGate({roster:[{id:actor,birthyear:profile.birthyear}],logger}),programValidators:preserveExistingEnrollments(createSchoolProgramEnrollmentValidators({}),existing.programs),logger});
  const results=await enrollGratitudeLearners({learnerIds:values.learners.split(','),assignedBy:actor,assignments,setAssignments,apply:values.apply});
  process.stdout.write(JSON.stringify({apply:values.apply,results},null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
