/** Explicit-subject-first user fallback policy. */
export class DefaultPrincipalResolver {
  constructor({ headOfHousehold, defaultUsername, fallback = 'default' } = {}) {
    this.headOfHousehold = headOfHousehold;
    this.defaultUsername = defaultUsername;
    this.fallback = fallback;
  }

  resolve(explicit = null) {
    return explicit || this.headOfHousehold?.() || this.defaultUsername?.() || this.fallback;
  }
}

export default DefaultPrincipalResolver;
