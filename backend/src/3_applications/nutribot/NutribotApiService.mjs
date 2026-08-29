/** Direct-input and report operations without exposing the Nutribot container or identity adapter. */
export class NutribotApiService {
  constructor({ logFoodFromUpc, logFoodFromImage, logFoodFromText, getReport,
    resolveIdentity, defaultMember = null } = {}) {
    Object.assign(this, { logFoodFromUpc, logFoodFromImage, logFoodFromText, getReport,
      resolveIdentity, defaultMember });
  }

  userContext(requestedUser = null) {
    const user = requestedUser || this.defaultMember;
    if (!user) throw new Error('Missing required parameter: user');
    const identity = this.resolveIdentity(user);
    return { userId: identity.username || user, conversationId: identity.conversationIdString };
  }

  logUpc(command) { return this.logFoodFromUpc.execute(command); }
  logImage(command) { return this.logFoodFromImage.execute(command); }
  logText(command) { return this.logFoodFromText.execute(command); }
  report(command) { return this.getReport.execute(command); }
}

export default NutribotApiService;
