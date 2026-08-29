/** Semantic Journalist operations for the HTTP surface. */
export class JournalistApiService {
  constructor({ exportJournal = null, initiatePrompt, generateMorningDebrief, sendMorningDebrief,
    principalResolver, resolveConversationId, logger = console } = {}) {
    Object.assign(this, { exportJournal, initiatePrompt, generateMorningDebrief, sendMorningDebrief,
      principalResolver, resolveConversationId, logger });
  }

  canExportJournal() { return Boolean(this.exportJournal); }
  resolveUsername(explicit = null) { return this.principalResolver.resolve(explicit); }
  export(command) { return this.exportJournal.execute(command); }
  trigger(command) { return this.initiatePrompt.execute(command); }

  async morning({ requestedUsername = null, date = null } = {}) {
    const username = this.resolveUsername(requestedUsername);
    const conversationId = this.#conversationId(username);
    const debrief = await this.generateMorningDebrief.execute({ username, date, conversationId });
    if (!conversationId) return { kind: 'conversation_not_found', username };
    const delivery = await this.sendMorningDebrief.execute({ conversationId, debrief });
    return { kind: 'sent', username, date: debrief.date || date, delivery };
  }

  #conversationId(username) {
    if (!username) {
      this.logger.warn?.('journalist.morning.noUsername');
      return null;
    }
    try {
      return this.resolveConversationId(username);
    } catch (error) {
      this.logger.warn?.('journalist.morning.identityResolutionFailed', { username, error: error.message });
      return null;
    }
  }
}

export default JournalistApiService;
