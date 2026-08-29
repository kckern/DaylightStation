/** Current-user weight projection with explicit principal fallback. */
export class LifelogWeightService {
  constructor({ principalResolver, weightHistorySource, loadWeightData } = {}) {
    this.principalResolver = principalResolver;
    this.weightHistorySource = weightHistorySource || (loadWeightData ? { read: loadWeightData } : null);
  }

  read(authenticatedUsername = null) {
    const username = this.principalResolver.resolve(authenticatedUsername);
    return { username, data: this.weightHistorySource?.read(username) };
  }
}

export default LifelogWeightService;
