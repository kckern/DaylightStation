import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {enrollGratitudeLearners} from './enroll-gratitude.mjs';
import {YamlAssignmentStore} from '../server/adapters/persistence/YamlAssignmentStore.mjs';
import {SetAssignments} from '../server/application/usecases/SetAssignments.mjs';
import {GrownUpGate} from '../server/application/GrownUpGate.mjs';
import {createSchoolProgramEnrollmentValidators} from '../server/application/SchoolProgramEnrollmentValidators.mjs';
import {preserveExistingEnrollments} from './lib/preserve-existing-enrollments.mjs';
it('adds Gratitude once while retaining all durable enrollment records',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'gratitude-enroll-'));
  const assignments=new YamlAssignmentStore({configService:{getHouseholdPath:p=>path.join(root,p)},logger:{}});
  const old={learnerId:'child',courses:[{courseId:'existing-course'}],units:['existing-unit'],programs:[{programId:'story-time',corpusId:null,title:'Keep me',subject:'english',target:2}],assignedBy:'adult',updatedAt:'2026-11-15T12:00:00Z'};
  try{
    await assignments.put(old);
    const before=await assignments.get('child');
    const make=(existing,{assignments:guarded})=>new SetAssignments({assignments:guarded,grownUps:new GrownUpGate({roster:[{id:'adult',birthyear:1980}],logger:{}}),programValidators:preserveExistingEnrollments(createSchoolProgramEnrollmentValidators({}),existing.programs),logger:{}});
    await enrollGratitudeLearners({learnerIds:['child'],assignedBy:'adult',assignments,setAssignments:make,apply:false});
    expect((await assignments.get('child')).programs).toHaveLength(1);
    await enrollGratitudeLearners({learnerIds:['child'],assignedBy:'adult',assignments,setAssignments:make,apply:true});
    const changed=await assignments.get('child');
    expect(changed.courses).toEqual(before.courses);expect(changed.units).toEqual(old.units);
    expect(changed.programs[0]).toEqual(old.programs[0]);expect(changed.programs[1]).toMatchObject({programId:'gratitude',subject:'scripture',schedule:{daysOfWeek:[1,2,3,4,5]}});
    expect((await enrollGratitudeLearners({learnerIds:['child'],assignedBy:'adult',assignments,setAssignments:make,apply:true}))[0].changed).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
