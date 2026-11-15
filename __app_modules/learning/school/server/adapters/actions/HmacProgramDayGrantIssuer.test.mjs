import { it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { HmacProgramDayGrantIssuer } from './HmacProgramDayGrantIssuer.mjs';
import { HmacSchoolDebriefGrantIssuer } from './HmacSchoolDebriefGrantIssuer.mjs';
it('preserves old Debrief tokens and isolates program purposes',()=>{
  const key='x'.repeat(32);
  const issuer=new HmacSchoolDebriefGrantIssuer({key,clock:()=>100});
  const payload={purpose:'school-debrief',learnerId:'child',days:['2026-11-16'],exp:200};
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const derived=createHmac('sha256',Buffer.from(key)).update('school.debrief.launch-grant/v1').digest();
  const token=body+'.'+createHmac('sha256',derived).update(body).digest('base64url');
  expect(issuer.verify(token,{learnerId:'child',day:'2026-11-16'}).ok).toBe(true);
  const gratitude=new HmacProgramDayGrantIssuer({key,context:'school.gratitude.launch-grant/v1',purpose:'school-gratitude',clock:()=>100});
  expect(gratitude.verify(token).ok).toBe(false);
  expect(issuer.verify(token,{learnerId:'other'}).ok).toBe(false);
});
