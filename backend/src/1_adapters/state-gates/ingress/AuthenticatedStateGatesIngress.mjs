export class AuthenticatedStateGatesIngress {
  #observe; #retract; #resolvePublisher;
  constructor({ observeAssertion, retractAssertion, resolvePublisher }) {
    this.#observe = observeAssertion;
    this.#retract = retractAssertion;
    this.#resolvePublisher = resolvePublisher;
  }
  async observe(householdId, principal, assertion) {
    const publisherId = await this.#resolvePublisher(principal);
    if (!publisherId) throw Object.assign(new Error('Publisher is not authenticated'), { name: 'AuthorizationError', code: 'PUBLISHER_UNAUTHENTICATED', status: 403 });
    return this.#observe(householdId, { ...assertion, publisherId });
  }
  async retract(householdId, principal, command) {
    const publisherId = await this.#resolvePublisher(principal);
    if (!publisherId) throw Object.assign(new Error('Publisher is not authenticated'), { name: 'AuthorizationError', code: 'PUBLISHER_UNAUTHENTICATED', status: 403 });
    return this.#retract(householdId, { ...command, publisherId });
  }
}
export default AuthenticatedStateGatesIngress;
