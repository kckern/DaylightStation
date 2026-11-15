import { YamlProgramDayStore } from './YamlProgramDayStore.mjs';
import { validGratitudeEvidence } from '../../domain/gratitudeEvidence.mjs';
export class YamlGratitudeStore extends YamlProgramDayStore {
 constructor({configService,...options}={}) { super({...options,rootDir:configService.getHouseholdPath('school/records/gratitude'),logPrefix:'school.gratitude',strict:true,validateEvents:validGratitudeEvidence}); }
}
