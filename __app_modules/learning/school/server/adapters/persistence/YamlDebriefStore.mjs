import { YamlProgramDayStore } from './YamlProgramDayStore.mjs';
export class YamlDebriefStore extends YamlProgramDayStore {
 constructor({configService,...options}={}) { super({...options,rootDir:configService.getHouseholdPath('school/records/debriefs'),corruptPolicy:'restart',logPrefix:'school.debrief'}); }
}
export default YamlDebriefStore;
