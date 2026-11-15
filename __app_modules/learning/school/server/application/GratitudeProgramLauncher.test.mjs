import { it,expect } from 'vitest';
import { GratitudeProgramLauncher } from './GratitudeProgramLauncher.mjs';
it('projects one daily obligation and learner-bound launch target',async()=>{
  const store={read:async()=>({status:'missing',events:[]}),listDays:async()=>[]};
  const launcher=new GratitudeProgramLauncher({store,assignments:{get:async()=>({programs:[{programId:'gratitude',subject:'scripture'}]})},grants:{issue:({learnerId,days})=>`${learnerId}:${days[0]}`},clock:()=>new Date('2026-11-16T18:00:00Z'),timezone:'America/Los_Angeles'});
  expect(await launcher.status({userId:'child'})).toMatchObject({doneToday:false,subject:'scripture',obligationProgress:{completed:0,total:1}});
  expect(await launcher.issueLaunchTarget({userId:'child'})).toMatchObject({kind:'program',program:'gratitude',learnerId:'child',today:'2026-11-16',gratitudeGrant:'child:2026-11-16'});
});
