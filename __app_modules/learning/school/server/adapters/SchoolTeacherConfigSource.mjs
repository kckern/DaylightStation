/** Projects the teacher authorization fields from the legacy school config. */
export class SchoolTeacherConfigSource {
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdAppConfig) {
      throw new Error('SchoolTeacherConfigSource requires configService');
    }
    this.configService = configService;
  }

  teachers = () => this.#schoolConfig().teachers;

  #schoolConfig() {
    return this.configService.getHouseholdAppConfig(null, 'school') || {};
  }
}
