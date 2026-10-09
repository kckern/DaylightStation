/** Resolves the feed owner without exposing household configuration to HTTP. */
export class FeedPrincipalResolver {
  constructor({ defaultUsername = () => null } = {}) {
    this.defaultUsername = defaultUsername;
  }

  resolve(authenticatedUsername = null) {
    return authenticatedUsername || this.defaultUsername?.() || 'default';
  }
}

export default FeedPrincipalResolver;
