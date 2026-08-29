/** Household lookup policy shared by HTTP composition without exposing ConfigService. */
export class HouseholdContextService {
  constructor({ defaultHouseholdId, householdExists, getHousehold, getTimezone } = {}) {
    this.defaultHouseholdId = defaultHouseholdId;
    this.householdExists = householdExists;
    this.getHousehold = getHousehold;
    this.getTimezone = getTimezone;
  }

  resolve(explicit = null, fallback = 'default') {
    return explicit || this.defaultHouseholdId?.() || fallback;
  }

  exists(householdId) { return this.householdExists?.(householdId) ?? false; }
  household(householdId) { return this.getHousehold?.(householdId); }
  timezone(householdId) { return this.getTimezone?.(householdId) || 'UTC'; }
}

export default HouseholdContextService;
