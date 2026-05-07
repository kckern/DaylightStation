export class PersonalConstantsService {
  #dataService;
  #healthStore;
  constructor({ dataService, healthStore }) {
    if (!dataService) throw new Error('PersonalConstantsService: dataService required');
    if (!healthStore) throw new Error('PersonalConstantsService: healthStore required');
    this.#dataService = dataService;
    this.#healthStore = healthStore;
  }

  async get(userId) {
    if (!userId) throw new Error('PersonalConstantsService: userId required');

    const profile = await this.#dataService.user.read('profile/health', userId);
    if (!profile) {
      throw new Error(`PersonalConstantsService: profile/health.yml not found for ${userId}`);
    }

    const weight = (await this.#healthStore.loadWeightData(userId)) ?? {};
    const dates = Object.keys(weight).sort();
    const latestDate = dates.at(-1);
    const weight_lbs = latestDate ? weight[latestDate].lbs : null;

    return {
      height_cm: profile.height_cm,
      age: profile.age,
      sex: profile.sex,
      weight_lbs,
      weight_kg: weight_lbs ? +(weight_lbs * 0.453592).toFixed(2) : null,
      activity_pal: profile.activity_pal ?? 1.55,
      scale_bias_lbs: profile.scale_bias_lbs ?? 0,
      bmr_formula: 'mifflin-st-jeor',
      calorie_per_lb_fat: 3500,
    };
  }
}

export default PersonalConstantsService;
