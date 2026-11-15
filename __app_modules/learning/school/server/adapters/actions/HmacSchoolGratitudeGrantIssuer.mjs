import { HmacProgramDayGrantIssuer } from './HmacProgramDayGrantIssuer.mjs';
export class HmacSchoolGratitudeGrantIssuer extends HmacProgramDayGrantIssuer {
 constructor(options={}) { super({...options,context:'school.gratitude.launch-grant/v1',purpose:'school-gratitude'}); }
}
export default HmacSchoolGratitudeGrantIssuer;
