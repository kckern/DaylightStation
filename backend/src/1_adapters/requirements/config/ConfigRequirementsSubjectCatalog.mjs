/** Translate the existing household configuration vocabulary into SubjectRefs. */
export class ConfigRequirementsSubjectCatalog {
  #configService;
  constructor({ configService }) {
    if (!configService) throw new Error('ConfigRequirementsSubjectCatalog requires configService');
    this.#configService = configService;
  }

  async load(householdId) {
    const learners = (this.#configService.getHouseholdUsers(householdId) ?? []).map(value => ({
      kind: 'learner',
      id: typeof value === 'string' ? value : value.id ?? value.username ?? value.name,
    })).filter(value => value.id);
    const deviceValues = this.#configService.getHouseholdDevices(householdId)?.devices ?? {};
    const devices = Object.keys(deviceValues).map(id => ({ kind: 'device', id }));
    const rooms = [...new Set(Object.values(deviceValues).map(value => value.room ?? value.location).filter(Boolean))]
      .map(id => ({ kind: 'room', id }));
    return [{ kind: 'household', id: householdId }, ...learners, ...devices, ...rooms];
  }
}

export default ConfigRequirementsSubjectCatalog;
