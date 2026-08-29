/** Public login context without exposing household/config persistence to HTTP. */
export class AuthPublicContextService {
  constructor({ defaultHouseholdId, readHousehold, listUserProfiles } = {}) {
    this.defaultHouseholdId = defaultHouseholdId;
    this.readHousehold = readHousehold;
    this.listUserProfiles = listUserProfiles;
  }

  get({ householdId = null, needsSetup = false } = {}) {
    const resolvedHouseholdId = householdId || this.defaultHouseholdId();
    const household = this.readHousehold();
    const users = this.listUserProfiles();
    let setupAdmin = null;
    if (needsSetup && users.size > 0) {
      for (const [username, profile] of users) {
        if ((profile.roles || []).includes('sysadmin')) {
          setupAdmin = username;
          break;
        }
      }
    }
    return {
      householdId: resolvedHouseholdId,
      householdName: household?.name || 'DaylightStation',
      setupAdmin,
    };
  }
}

export default AuthPublicContextService;
