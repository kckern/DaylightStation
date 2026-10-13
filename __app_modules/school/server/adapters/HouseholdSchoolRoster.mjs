/** Adapts the legacy user service to the live roster views School consumes. */
export class HouseholdSchoolRoster {
  constructor({ userService } = {}) {
    this.userService = userService;
  }

  list = () => this.userService?.getHouseholdRoster?.() ?? [];

  displayName = (id) => this.list().find((member) => member.id === id)?.name ?? null;
}
