import { HmacProgramDayGrantIssuer } from './HmacProgramDayGrantIssuer.mjs';
export class HmacSchoolDebriefGrantIssuer extends HmacProgramDayGrantIssuer {
 constructor(options={}) { super({...options,context:'school.debrief.launch-grant/v1',purpose:'school-debrief'}); }
}
export default HmacSchoolDebriefGrantIssuer;
