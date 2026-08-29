/** Projects the teacher authorization fields from the legacy school config. */
export class SchoolTeacherConfigSource {
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdAppConfig) {
      throw new Error('SchoolTeacherConfigSource requires configService');
    }
    this.configService = configService;
  }

  teachers = () => this.#schoolConfig().teachers;

  pin = () => {
    const value = this.#schoolConfig().teacher?.pin;
    return value != null ? String(value) : null;
  };

  #schoolConfig() {
    return this.configService.getHouseholdAppConfig(null, 'school') || {};
  }
}
